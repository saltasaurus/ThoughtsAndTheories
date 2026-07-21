/**
 * Regression tests for the Phase 3 hardening round. One test per CONFIRMED
 * finding from the three adversarial finder lenses; each fails against the
 * code as it stood before the fix.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError, ConflictError } from "@/lib/errors";
import { deleteEra, deleteMonth } from "@/lib/services/calendar-admin";
import { createCard, softDeleteCard } from "@/lib/services/cards";
import { getRosterAnalytics, listMembers } from "@/lib/services/memberships";
import {
  exportSeries,
  importSeries,
  parseSeriesExport,
  type SeriesExport,
} from "@/lib/services/export-import";
import { updateField } from "@/lib/services/templates";
import { getViewer, listCards, type Viewer } from "@/lib/visibility";
import { createFixture, createUser, makeCard, type Fixture } from "@/tests/fixture";

async function templateField(seriesId: string, cardType: "CHARACTER" | "EVENT", key: string) {
  const t = await prisma.template.findUnique({
    where: { seriesId_cardType: { seriesId, cardType } },
    include: { fields: true },
  });
  const f = t?.fields.find((x) => x.key === key);
  if (!f) throw new Error(`missing ${cardType}.${key}`);
  return f;
}

// ---------------------------------------------------------------------------
// Finding 1 (critical) — exportSeries emitted files parseSeriesExport rejected.
// The JSON value schema had no z.null() member, but every INWORLD_DATE value
// carries nulls, and INWORLD_DATE is in the default EVENT template.
// ---------------------------------------------------------------------------

describe("hardening: an in-world date survives a real export → parse → import", () => {
  let f: Fixture;
  let owner: Viewer;
  let file: SeriesExport;

  const dateValue = {
    eraId: "",
    year: 1604,
    monthOrder: 3,
    day: 14,
    precision: "DAY",
    displayOverride: null, // the null that used to break the whole file
  };

  beforeAll(async () => {
    f = await createFixture();
    owner = await getViewer(f.owner.id, f.seriesId);
    dateValue.eraId = f.eras[0]!.id;
    const dateField = await templateField(f.seriesId, "EVENT", "date");
    await createCard(owner, {
      type: "EVENT",
      title: "The Sundering",
      revealSectionId: f.sections[0]!.id,
      fields: [{ templateFieldId: dateField.id, value: dateValue }],
    });
    file = await exportSeries(owner);
  });

  it("accepts its own export after a real JSON round trip", () => {
    // JSON.parse(JSON.stringify(...)) is what actually happens on upload.
    expect(() => parseSeriesExport(JSON.parse(JSON.stringify(file)))).not.toThrow();
  });

  it("imports the null-bearing value back byte-for-byte", async () => {
    const importer = await createUser("date-importer");
    const parsed = parseSeriesExport(JSON.parse(JSON.stringify(file)));
    const newSeriesId = await importSeries(importer.id, parsed);

    const card = await prisma.card.findFirst({
      where: { seriesId: newSeriesId, title: "The Sundering" },
      include: { fields: true },
    });
    const value = card?.fields[0]?.value as Record<string, unknown>;
    expect(value.displayOverride).toBeNull();
    expect(value.year).toBe(1604);
    expect(value.day).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// Finding 5 (minor) — duplicate keys pass the shape schema but silently make
// every reference resolve to whichever row came last.
// ---------------------------------------------------------------------------

describe("hardening: duplicate keys in an import file are rejected", () => {
  it("refuses a file with two sections sharing a key", async () => {
    const f = await createFixture();
    const owner = await getViewer(f.owner.id, f.seriesId);
    const file = await exportSeries(owner);
    const dup: SeriesExport = {
      ...file,
      sections: [...file.sections, { ...file.sections[0]! }],
    };
    expect(() => parseSeriesExport(JSON.parse(JSON.stringify(dup)))).toThrow(AppError);
  });
});

// ---------------------------------------------------------------------------
// Finding 2 (major, spoiler lens) — the card-type filter was applied before the
// reveal gate, so locked placeholders were type-filtered too. Differencing the
// type tabs recovered the type of every card above the viewer's progress.
// ---------------------------------------------------------------------------

describe("hardening: the type filter never narrows the locked set", () => {
  let f: Fixture;
  let reader: Viewer;

  beforeAll(async () => {
    f = await createFixture();
    // Two gated cards of DIFFERENT types, both above the reader (position 2).
    await makeCard(f.seriesId, f.owner.id, {
      type: "THEORY",
      title: "Gated theory",
      section: f.sections[3]!,
    });
    await makeCard(f.seriesId, f.owner.id, {
      type: "CHARACTER",
      title: "Gated character",
      section: f.sections[4]!,
    });
    // One visible card, so the filter demonstrably still works.
    await makeCard(f.seriesId, f.owner.id, {
      type: "CHARACTER",
      title: "Visible character",
      section: f.sections[0]!,
    });
    reader = await getViewer(f.reader.id, f.seriesId);
  });

  const lockedIds = async (type?: "THEORY" | "CHARACTER") => {
    const { items } = await listCards(reader, type ? { type } : {});
    return items
      .filter((i) => i.locked)
      .map((i) => i.id)
      .sort();
  };

  it("returns an identical locked set on every type tab", async () => {
    const all = await lockedIds();
    expect(all.length).toBe(2);
    expect(await lockedIds("THEORY")).toEqual(all);
    expect(await lockedIds("CHARACTER")).toEqual(all);
  });

  it("still filters the VISIBLE cards by type", async () => {
    const { items } = await listCards(reader, { type: "CHARACTER" });
    const visible = items.filter((i) => !i.locked);
    expect(visible.map((v) => (v as { title: string }).title)).toEqual(["Visible character"]);

    const none = await listCards(reader, { type: "THEORY" });
    expect(none.items.filter((i) => !i.locked)).toEqual([]);
  });

  it("still filters normally under spoiler peek", async () => {
    const peeker = await getViewer(f.owner.id, f.seriesId, true);
    const { items } = await listCards(peeker, { type: "THEORY" });
    expect(items.every((i) => !i.locked)).toBe(true);
    expect(items.length).toBe(1); // only the theory
  });
});

// ---------------------------------------------------------------------------
// Finding 3 (major, spoiler lens) — the roster paired a NAME with a comparison
// against the active session goal. An EDITOR may retarget that goal freely, so
// repeating the observation binary-searched any member's exact position.
// Resolved by decision: session goals stay freely movable, the per-member badge
// goes, and pacing is reported in aggregate only.
// ---------------------------------------------------------------------------

describe("hardening: the roster never pairs a name with a position comparison", () => {
  let f: Fixture;
  let owner: Viewer;

  beforeAll(async () => {
    f = await createFixture();
    owner = await getViewer(f.owner.id, f.seriesId);
    // An ACTIVE session whose goal the members straddle: reader@2 is behind,
    // editor@3 is exactly at goal, owner@5 is ahead. If any per-member
    // comparison survived, this is the fixture that would expose it.
    await prisma.clubSession.create({
      data: {
        seriesId: f.seriesId,
        title: "Week 3",
        goalSectionId: f.sections[2]!.id,
        goalRevealIndex: f.sections[2]!.position,
        createdById: f.owner.id,
        status: "ACTIVE",
      },
    });
  });

  it("returns identity and role only — no state, no position, no goal", async () => {
    const members = await listMembers(owner);
    expect(members.length).toBe(3);
    for (const m of members) {
      expect(Object.keys(m).sort()).toEqual(["name", "role", "userId"]);
    }
    const raw = JSON.stringify(members);
    for (const leak of ["behind", "at_goal", "ahead", "revealIndex", "goal"]) {
      expect(raw).not.toContain(leak);
    }
  });

  it("is invariant to the goal moving — the whole basis of the binary search", async () => {
    const before = await listMembers(owner);
    // Retarget the goal across the members' positions, as an EDITOR may.
    for (const section of [f.sections[0]!, f.sections[4]!, f.sections[1]!]) {
      await prisma.clubSession.updateMany({
        where: { seriesId: f.seriesId, status: "ACTIVE" },
        data: { goalSectionId: section.id, goalRevealIndex: section.position },
      });
      expect(await listMembers(owner)).toEqual(before); // nothing to observe
    }
  });

  it("still reports pacing in aggregate, which names nobody", async () => {
    await prisma.clubSession.updateMany({
      where: { seriesId: f.seriesId, status: "ACTIVE" },
      data: { goalSectionId: f.sections[2]!.id, goalRevealIndex: f.sections[2]!.position },
    });
    const a = await getRosterAnalytics(owner);
    expect(a.counts).toEqual({ behind: 1, at_goal: 1, ahead: 1 });
    expect(JSON.stringify(a)).not.toContain("userId");
  });
});

// ---------------------------------------------------------------------------
// Finding 4 (major, integrity lens) — the template guards ignored values on
// soft-deleted cards, but restoreCard re-validates nothing, so soft-delete →
// retype → restore produced exactly the malformed state they exist to prevent.
// ---------------------------------------------------------------------------

describe("hardening: template guards count values on soft-deleted cards", () => {
  let f: Fixture;
  let owner: Viewer;

  beforeAll(async () => {
    f = await createFixture();
    owner = await getViewer(f.owner.id, f.seriesId);
  });

  it("still refuses a retype when the only value sits on a soft-deleted card", async () => {
    const aliases = await templateField(f.seriesId, "CHARACTER", "aliases");
    const cardId = await createCard(owner, {
      type: "CHARACTER",
      title: "Doomed",
      revealSectionId: f.sections[0]!.id,
      fields: [{ templateFieldId: aliases.id, value: "The Bold" }],
    });
    await softDeleteCard(owner, cardId);

    await expect(updateField(owner, aliases.id, { fieldType: "NUMBER" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("still refuses removing a choice used only by a soft-deleted card", async () => {
    const status = await templateField(f.seriesId, "CHARACTER", "status");
    const cardId = await createCard(owner, {
      type: "CHARACTER",
      title: "Also doomed",
      revealSectionId: f.sections[0]!.id,
      fields: [{ templateFieldId: status.id, value: "Dead" }],
    });
    await softDeleteCard(owner, cardId);

    await expect(
      updateField(owner, status.id, { options: { choices: ["Alive", "Unknown"] } }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ---------------------------------------------------------------------------
// Findings 2 & 3 (major, integrity lens) — deleteEra/deleteMonth are HARD
// deletes. They ignored soft-deleted timeline entries (whose eraId the FK would
// silently SET NULL, stranding an unrepairable absoluteSortKey) and ignored
// INWORLD_DATE card values, which embed eraId/monthOrder in JSON with no FK.
// ---------------------------------------------------------------------------

describe("hardening: calendar deletes respect every reference", () => {
  let f: Fixture;
  let owner: Viewer;

  beforeAll(async () => {
    f = await createFixture();
    owner = await getViewer(f.owner.id, f.seriesId);
  });

  it("refuses to delete an era referenced only by a SOFT-DELETED timeline entry", async () => {
    const era = f.eras[0]!;
    const entry = await prisma.timelineEntry.create({
      data: {
        seriesId: f.seriesId,
        label: "Buried",
        revealSectionId: f.sections[0]!.id,
        revealIndex: f.sections[0]!.position,
        eraId: era.id,
        year: 7,
        precision: "YEAR",
        absoluteSortKey: 7_000_000n,
        deletedAt: new Date(),
      },
    });

    await expect(deleteEra(owner, era.id)).rejects.toBeInstanceOf(ConflictError);
    // the entry is untouched: era intact, sort key intact
    const after = await prisma.timelineEntry.findUnique({ where: { id: entry.id } });
    expect(after?.eraId).toBe(era.id);
    expect(after?.absoluteSortKey).toBe(7_000_000n);
  });

  it("refuses to delete an era referenced only by an INWORLD_DATE card value", async () => {
    const era = f.eras[1]!;
    const dateField = await templateField(f.seriesId, "EVENT", "date");
    await createCard(owner, {
      type: "EVENT",
      title: "Dated by card field",
      revealSectionId: f.sections[0]!.id,
      fields: [
        {
          templateFieldId: dateField.id,
          value: {
            eraId: era.id,
            year: 1604,
            monthOrder: null,
            day: null,
            precision: "YEAR",
            displayOverride: null,
          },
        },
      ],
    });

    // no timeline entry uses this era at all
    expect(await prisma.timelineEntry.count({ where: { eraId: era.id } })).toBe(0);
    await expect(deleteEra(owner, era.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.calendarEra.findUnique({ where: { id: era.id } })).not.toBeNull();
  });

  it("refuses to delete a month referenced only by an INWORLD_DATE card value", async () => {
    const month = await prisma.calendarMonth.findFirst({
      where: { calendarId: f.calendarId },
      orderBy: { order: "asc" },
    });
    const dateField = await templateField(f.seriesId, "EVENT", "date");
    await createCard(owner, {
      type: "EVENT",
      title: "Dated by month",
      revealSectionId: f.sections[0]!.id,
      fields: [
        {
          templateFieldId: dateField.id,
          value: {
            eraId: f.eras[0]!.id,
            year: 1200,
            monthOrder: month!.order,
            day: null,
            precision: "MONTH",
            displayOverride: null,
          },
        },
      ],
    });

    await expect(deleteMonth(owner, month!.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.calendarMonth.findUnique({ where: { id: month!.id } })).not.toBeNull();
  });
});
