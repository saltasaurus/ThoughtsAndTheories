import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import {
  addEra,
  addMonth,
  createCalendar,
  deleteEra,
  deleteMonth,
  getSeriesCalendar,
  updateCalendar,
  updateEra,
  updateMonth,
} from "@/lib/services/calendar-admin";
import { createSeries } from "@/lib/services/series";
import { getViewer, type Viewer } from "@/lib/visibility";
import { createFixture, createUser, type Fixture } from "@/tests/fixture";

/** A dated timeline entry, written straight to the DB like the fixture does. */
async function makeEntry(
  f: Fixture,
  input: { label: string; eraId: string; year: number; monthOrder?: number; day?: number },
) {
  const precision =
    input.day !== undefined ? "DAY" : input.monthOrder !== undefined ? "MONTH" : "YEAR";
  return prisma.timelineEntry.create({
    data: {
      seriesId: f.seriesId,
      label: input.label,
      revealSectionId: f.sections[0]!.id,
      revealIndex: f.sections[0]!.position,
      eraId: input.eraId,
      year: input.year,
      monthOrder: input.monthOrder ?? null,
      day: input.day ?? null,
      precision,
      absoluteSortKey: 0n, // deliberately wrong — recompute must fix it
    },
    select: { id: true },
  });
}

describe("calendar editor — creation is one-per-series", () => {
  it("creates a calendar for a series that has none, then refuses a second", async () => {
    const owner = await createUser("cal-owner");
    const seriesId = await createSeries(owner.id, { title: "Calendarless" });
    const viewer = await getViewer(owner.id, seriesId);

    expect(await getSeriesCalendar(seriesId)).toBeNull();

    await createCalendar(viewer, {
      name: "Reckoning",
      epochLabel: "Ages",
      daysPerWeek: 5,
      weekdayNames: ["A", "B", "C", "D", "E"],
    });
    const created = await getSeriesCalendar(seriesId);
    expect(created?.name).toBe("Reckoning");
    expect(created?.daysPerWeek).toBe(5);

    // A second calendar would be silently unreachable — every read is findFirst.
    await expect(
      createCalendar(viewer, { name: "Rival", daysPerWeek: 7, weekdayNames: [] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects non-owners", async () => {
    const f = await createFixture();
    for (const userId of [f.editor.id, f.reader.id]) {
      const viewer = await getViewer(userId, f.seriesId);
      await expect(
        createCalendar(viewer, { name: "X", daysPerWeek: 7, weekdayNames: [] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        addEra(viewer, f.calendarId, { name: "X", abbreviation: "X", yearOffset: 0 }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(deleteEra(viewer, f.eras[0]!.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("calendar editor — era offset recompute", () => {
  let f: Fixture;
  let owner: Viewer;

  beforeAll(async () => {
    f = await createFixture();
    owner = await getViewer(f.owner.id, f.seriesId);
  });

  it("recomputes absoluteSortKey for every dated entry when an era offset moves", async () => {
    const era = f.eras[0]!; // First Age, offset 0
    const a = await makeEntry(f, { label: "Founding", eraId: era.id, year: 5 });
    const b = await makeEntry(f, { label: "Siege", eraId: era.id, year: 7, monthOrder: 2 });

    await updateEra(owner, era.id, { yearOffset: 100 });

    const rows = await prisma.timelineEntry.findMany({
      where: { id: { in: [a.id, b.id] } },
      select: { id: true, absoluteSortKey: true },
    });
    const keyOf = (id: string) => rows.find((r) => r.id === id)?.absoluteSortKey;
    expect(keyOf(a.id)).toBe(105n * 1000000n); // (100 + 5) years
    expect(keyOf(b.id)).toBe(107n * 1000000n + 2n * 10000n); // (100 + 7), month 2
  });

  it("renames an era without touching sort keys", async () => {
    const era = f.eras[0]!;
    const before = await prisma.timelineEntry.findMany({
      where: { eraId: era.id },
      select: { id: true, absoluteSortKey: true },
      orderBy: { id: "asc" },
    });
    await updateEra(owner, era.id, { name: "The First Age", abbreviation: "1A" });
    const after = await prisma.timelineEntry.findMany({
      where: { eraId: era.id },
      select: { id: true, absoluteSortKey: true },
      orderBy: { id: "asc" },
    });
    expect(after).toEqual(before);
  });
});

describe("calendar editor — referential integrity", () => {
  let f: Fixture;
  let owner: Viewer;

  beforeAll(async () => {
    f = await createFixture();
    owner = await getViewer(f.owner.id, f.seriesId);
  });

  it("refuses to delete an era that dates a timeline entry (FK-backed)", async () => {
    const era = f.eras[0]!;
    await makeEntry(f, { label: "Anchored", eraId: era.id, year: 3 });
    await expect(deleteEra(owner, era.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.calendarEra.findUnique({ where: { id: era.id } })).not.toBeNull();
  });

  it("deletes an unused era", async () => {
    const id = await addEra(owner, f.calendarId, {
      name: "Third Age",
      abbreviation: "TA",
      yearOffset: 2000,
    });
    await deleteEra(owner, id);
    expect(await prisma.calendarEra.findUnique({ where: { id } })).toBeNull();
  });

  it("refuses to delete a month still used by an entry (app-level monthOrder check)", async () => {
    const era = f.eras[1]!;
    const months = await prisma.calendarMonth.findMany({
      where: { calendarId: f.calendarId },
      orderBy: { order: "asc" },
    });
    const month = months[0]!;
    await makeEntry(f, { label: "Dated", eraId: era.id, year: 9, monthOrder: month.order });
    await expect(deleteMonth(owner, month.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("deletes an unused month without renumbering the survivors", async () => {
    const added = await addMonth(owner, f.calendarId, { name: "Harvestide", dayCount: 28 });
    const before = await prisma.calendarMonth.findMany({
      where: { calendarId: f.calendarId },
      select: { id: true, order: true },
      orderBy: { order: "asc" },
    });
    await deleteMonth(owner, added);
    const after = await prisma.calendarMonth.findMany({
      where: { calendarId: f.calendarId },
      select: { id: true, order: true },
      orderBy: { order: "asc" },
    });
    // survivors keep their exact order values — renumbering would re-point
    // every stored monthOrder at a different month
    expect(after).toEqual(before.filter((m) => m.id !== added));
  });

  it("appends months and renames them in place", async () => {
    const id = await addMonth(owner, f.calendarId, { name: "Yulemoot", dayCount: 30 });
    const all = await prisma.calendarMonth.findMany({
      where: { calendarId: f.calendarId },
      orderBy: { order: "asc" },
    });
    expect(all[all.length - 1]?.id).toBe(id); // appended last
    await updateMonth(owner, id, { name: "Yuletide", dayCount: 31 });
    const updated = await prisma.calendarMonth.findUnique({ where: { id } });
    expect(updated?.name).toBe("Yuletide");
    expect(updated?.dayCount).toBe(31);
    expect(updated?.order).toBe(all[all.length - 1]?.order); // order untouched
  });
});

describe("calendar editor — week config", () => {
  it("rejects a weekday-name count that disagrees with daysPerWeek", async () => {
    const f = await createFixture();
    const owner = await getViewer(f.owner.id, f.seriesId);
    await expect(
      updateCalendar(owner, f.calendarId, { daysPerWeek: 7, weekdayNames: ["Only", "Two"] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("updates name, epoch label and week shape together", async () => {
    const f = await createFixture();
    const owner = await getViewer(f.owner.id, f.seriesId);
    await updateCalendar(owner, f.calendarId, {
      name: "New Reckoning",
      epochLabel: "After the Fall",
      daysPerWeek: 3,
      weekdayNames: ["One", "Two", "Three"],
    });
    const cal = await getSeriesCalendar(f.seriesId);
    expect(cal?.name).toBe("New Reckoning");
    expect(cal?.epochLabel).toBe("After the Fall");
    expect(cal?.daysPerWeek).toBe(3);
    expect(cal?.weekdayNames).toEqual(["One", "Two", "Three"]);
  });
});
