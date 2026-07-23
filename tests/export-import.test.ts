import { beforeAll, describe, expect, it } from "vitest";
import { withinImportLimit } from "@/lib/import-limit";
import { prisma } from "@/lib/db";
import { AppError, ForbiddenError } from "@/lib/errors";
import { createCard } from "@/lib/services/cards";
import {
  exportSeries,
  importSeries,
  parseSeriesExport,
  type SeriesExport,
} from "@/lib/services/export-import";
import { getViewer, type Viewer } from "@/lib/visibility";
import { createFixture, createUser, makeCard, type Fixture } from "@/tests/fixture";

/** Populate a fixture series with cards, a relation and a dated timeline entry. */
async function populate(f: Fixture, owner: Viewer) {
  const template = await prisma.template.findUnique({
    where: { seriesId_cardType: { seriesId: f.seriesId, cardType: "CHARACTER" } },
    include: { fields: true },
  });
  const aliases = template!.fields.find((x) => x.key === "aliases")!;

  const a = await createCard(owner, {
    type: "CHARACTER",
    title: "Aldric",
    summary: "A knight",
    revealSectionId: f.sections[0]!.id,
    fields: [{ templateFieldId: aliases.id, value: "The Bold" }],
  });
  const b = (
    await makeCard(f.seriesId, f.owner.id, {
      type: "LOCATION",
      title: "Vale Keep",
      section: f.sections[3]!,
    })
  ).id;

  await prisma.cardRelation.create({
    data: {
      fromCardId: a,
      toCardId: b,
      type: "resides at",
      weight: 0.8,
      directed: true,
      revealSectionId: f.sections[3]!.id,
      revealIndex: f.sections[3]!.position,
    },
  });
  await prisma.timelineEntry.create({
    data: {
      seriesId: f.seriesId,
      cardId: a,
      label: "The Founding",
      revealSectionId: f.sections[1]!.id,
      revealIndex: f.sections[1]!.position,
      eraId: f.eras[1]!.id, // Second Age, offset 1000
      year: 7,
      monthOrder: 2,
      precision: "MONTH",
      absoluteSortKey: 1007n * 1000000n + 2n * 10000n,
    },
  });
  return { a, b };
}

describe("export/import — round trip", () => {
  let f: Fixture;
  let owner: Viewer;
  let file: SeriesExport;
  let importer: { id: string };
  let newSeriesId: string;

  beforeAll(async () => {
    f = await createFixture();
    owner = await getViewer(f.owner.id, f.seriesId);
    await populate(f, owner);
    file = await exportSeries(owner);
    importer = await createUser("importer");
    newSeriesId = await importSeries(importer.id, file);
  });

  it("requires OWNER to export", async () => {
    for (const userId of [f.editor.id, f.reader.id]) {
      const viewer = await getViewer(userId, f.seriesId);
      await expect(exportSeries(viewer)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("creates a brand-new series with fresh ids", async () => {
    expect(newSeriesId).not.toBe(f.seriesId);
    const created = await prisma.series.findUnique({ where: { id: newSeriesId } });
    expect(created?.title).toBe("Test Series");
  });

  it("preserves structure, card, field, relation and timeline counts", async () => {
    const count = async (seriesId: string) => ({
      books: await prisma.book.count({ where: { seriesId } }),
      sections: await prisma.section.count({ where: { book: { seriesId } } }),
      templates: await prisma.template.count({ where: { seriesId } }),
      templateFields: await prisma.templateField.count({ where: { template: { seriesId } } }),
      cards: await prisma.card.count({ where: { seriesId } }),
      fields: await prisma.cardField.count({ where: { card: { seriesId } } }),
      relations: await prisma.cardRelation.count({ where: { fromCard: { seriesId } } }),
      timeline: await prisma.timelineEntry.count({ where: { seriesId } }),
      eras: await prisma.calendarEra.count({ where: { calendar: { seriesId } } }),
      months: await prisma.calendarMonth.count({ where: { calendar: { seriesId } } }),
    });
    expect(await count(newSeriesId)).toEqual(await count(f.seriesId));
  });

  it("recomputes revealIndex to match the source, from the section FKs", async () => {
    const byTitle = async (seriesId: string) =>
      Object.fromEntries(
        (
          await prisma.card.findMany({
            where: { seriesId },
            select: { title: true, revealIndex: true },
            orderBy: { title: "asc" },
          })
        ).map((c) => [c.title, c.revealIndex]),
      );
    expect(await byTitle(newSeriesId)).toEqual(await byTitle(f.seriesId));
    // and it is genuinely recomputed, not the provisional 0 written at insert
    const imported = await prisma.card.findFirst({
      where: { seriesId: newSeriesId, title: "Vale Keep" },
    });
    expect(imported?.revealIndex).toBe(4);
  });

  it("recomputes absoluteSortKey to match the source", async () => {
    const source = await prisma.timelineEntry.findFirst({
      where: { seriesId: f.seriesId, label: "The Founding" },
    });
    const copy = await prisma.timelineEntry.findFirst({
      where: { seriesId: newSeriesId, label: "The Founding" },
    });
    expect(copy?.absoluteSortKey).toBe(source?.absoluteSortKey);
    expect(copy?.absoluteSortKey).toBe(1007n * 1000000n + 2n * 10000n);
  });

  it("remaps relation endpoints into the new series", async () => {
    const rel = await prisma.cardRelation.findFirst({
      where: { fromCard: { seriesId: newSeriesId } },
      include: { fromCard: true, toCard: true },
    });
    expect(rel?.fromCard.seriesId).toBe(newSeriesId);
    expect(rel?.toCard.seriesId).toBe(newSeriesId);
    expect(rel?.type).toBe("resides at");
  });

  it("reassigns createdById to the importer and gives them an OWNER membership", async () => {
    const cards = await prisma.card.findMany({ where: { seriesId: newSeriesId } });
    expect(cards.every((c) => c.createdById === importer.id)).toBe(true);

    const membership = await prisma.membership.findUnique({
      where: { userId_seriesId: { userId: importer.id, seriesId: newSeriesId } },
    });
    expect(membership?.role).toBe("OWNER");
  });

  it("carries no memberships, sessions, invites or revisions from the source", async () => {
    expect(await prisma.membership.count({ where: { seriesId: newSeriesId } })).toBe(1); // importer only
    expect(await prisma.clubSession.count({ where: { seriesId: newSeriesId } })).toBe(0);
    expect(await prisma.invite.count({ where: { seriesId: newSeriesId } })).toBe(0);

    const ids = (
      await prisma.card.findMany({ where: { seriesId: newSeriesId }, select: { id: true } })
    ).map((c) => c.id);
    expect(
      await prisma.revision.count({ where: { entityType: "CARD", entityId: { in: ids } } }),
    ).toBe(0);
  });

  it("omits derived values from the file itself", async () => {
    const raw = JSON.stringify(file);
    expect(raw).not.toContain("absoluteSortKey");
    expect(raw).not.toContain("revealIndex");
    expect(file.sections.every((s) => !("position" in s))).toBe(true);
  });
});

describe("import — size guard (0.3a)", () => {
  it("rejects an oversized declared body", () => {
    expect(withinImportLimit(String(26 * 1024 * 1024))).toBe(false);
  });
  it("rejects a missing or unparseable Content-Length (deny by default)", () => {
    expect(withinImportLimit(null)).toBe(false);
    expect(withinImportLimit("")).toBe(false);
    expect(withinImportLimit("not-a-number")).toBe(false);
    expect(withinImportLimit("0")).toBe(false);
  });
  it("accepts a reasonable declared body", () => {
    expect(withinImportLimit(String(1024))).toBe(true);
  });
});

describe("export/import — malformed files", () => {
  let f: Fixture;
  let owner: Viewer;
  let file: SeriesExport;
  let importer: { id: string };

  beforeAll(async () => {
    f = await createFixture();
    owner = await getViewer(f.owner.id, f.seriesId);
    await populate(f, owner);
    file = await exportSeries(owner);
    importer = await createUser("importer2");
  });

  it("rejects a file that fails the schema", () => {
    expect(() => parseSeriesExport({ formatVersion: 99 })).toThrow(AppError);
    expect(() => parseSeriesExport({ ...file, cards: "nope" })).toThrow(AppError);
    expect(() => parseSeriesExport(null)).toThrow(AppError);
  });

  it("accepts its own export unchanged", () => {
    expect(() => parseSeriesExport(JSON.parse(JSON.stringify(file)))).not.toThrow();
  });

  it("writes NOTHING when a row fails mid-import — one transaction", async () => {
    const before = await prisma.series.count();
    // schema-valid, but this card points at a section key that does not exist
    const broken: SeriesExport = {
      ...file,
      series: { title: "Half-built series", description: null },
      cards: [
        ...file.cards,
        {
          key: "ghost",
          type: "ITEM",
          title: "Dangling",
          summary: null,
          confidence: null,
          revealSectionKey: "no-such-section",
          deletedAt: null,
          fields: [],
        },
      ],
    };
    await expect(importSeries(importer.id, broken)).rejects.toBeInstanceOf(AppError);

    expect(await prisma.series.count()).toBe(before);
    expect(await prisma.series.findFirst({ where: { title: "Half-built series" } })).toBeNull();
    // not even the importer's own membership survived
    expect(await prisma.membership.count({ where: { userId: importer.id } })).toBe(0);
  });
});
