import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { requireOwner } from "@/lib/permissions";
import {
  cardTypeSchema,
  defaultRevealBehaviorSchema,
  fieldTypeSchema,
  precisionSchema,
  sectionTypeSchema,
} from "@/lib/schemas";
import { recomputeCalendarSortKeys } from "@/lib/services/calendar-admin";
import { recomputeSeriesPositions } from "@/lib/services/structure";
import type { Viewer } from "@/lib/visibility";

/**
 * Whole-series JSON export/import.
 *
 * Export reads through UNREDACTED reads, not lib/visibility.ts: this is an
 * OWNER backup tool operating outside the reveal gate by design, at the same
 * trust level as direct database access.
 *
 * Import ALWAYS creates a brand-new series — it never merges into an existing
 * one — inside a single transaction, so a malformed file cannot leave a
 * half-built series behind.
 *
 * Excluded from the format on purpose:
 *   Membership, ClubSession, reading positions, Invite — instance-specific.
 *   Revision — its userId FKs name users that do not exist on the target
 *     instance, and no admin path may leak diffs.
 * Omitted because they are DERIVED and recomputed after load:
 *   Section.position, every cached revealIndex, TimelineEntry.absoluteSortKey
 *   (a BigInt, which JSON.stringify would throw on anyway).
 */

/**
 * JSON as it actually round-trips through the file — INCLUDING null.
 *
 * Prisma.InputJsonValue deliberately excludes null (that is what DbNull and
 * JsonNull are for), so typing this schema against it was type-correct and
 * reality-wrong: every INWORLD_DATE value carries nulls (eraId, monthOrder,
 * day and displayOverride are all nullable), and INWORLD_DATE is in the
 * default EVENT template. Without z.null() here, exporting any card with an
 * in-world date produced a file this module's own importer rejected.
 */
type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

const jsonValue: z.ZodType<JsonLike> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

const nullableDate = z.string().nullable();

export const seriesExportSchema = z.object({
  formatVersion: z.literal(1),
  exportedAt: z.string(),
  series: z.object({ title: z.string().min(1), description: z.string().nullable() }),
  books: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      order: z.number().int(),
      deletedAt: nullableDate,
    }),
  ),
  parts: z.array(
    z.object({
      key: z.string(),
      bookKey: z.string(),
      number: z.number().int(),
      title: z.string().nullable(),
      order: z.number().int(),
      deletedAt: nullableDate,
    }),
  ),
  sections: z.array(
    z.object({
      key: z.string(),
      bookKey: z.string(),
      partKey: z.string().nullable(),
      type: sectionTypeSchema,
      number: z.number().int().nullable(),
      title: z.string().nullable(),
      deletedAt: nullableDate,
    }),
  ),
  templates: z.array(
    z.object({
      key: z.string(),
      cardType: cardTypeSchema,
      fields: z.array(
        z.object({
          key: z.string(),
          fieldKey: z.string(),
          label: z.string(),
          fieldType: fieldTypeSchema,
          options: jsonValue.nullable(),
          required: z.boolean(),
          order: z.number().int(),
          defaultRevealBehavior: defaultRevealBehaviorSchema,
          deletedAt: nullableDate,
        }),
      ),
    }),
  ),
  calendar: z
    .object({
      name: z.string(),
      epochLabel: z.string().nullable(),
      daysPerWeek: z.number().int(),
      weekdayNames: z.array(z.string()),
      eras: z.array(
        z.object({
          key: z.string(),
          name: z.string(),
          order: z.number().int(),
          yearOffset: z.number().int(),
          abbreviation: z.string(),
        }),
      ),
      months: z.array(
        z.object({
          key: z.string(),
          name: z.string(),
          order: z.number().int(),
          dayCount: z.number().int(),
        }),
      ),
    })
    .nullable(),
  cards: z.array(
    z.object({
      key: z.string(),
      type: cardTypeSchema,
      title: z.string(),
      summary: z.string().nullable(),
      confidence: z.number().int().nullable(),
      revealSectionKey: z.string(),
      deletedAt: nullableDate,
      fields: z.array(
        z.object({
          key: z.string(),
          templateFieldKey: z.string(),
          value: jsonValue,
          revealSectionKey: z.string(),
          deletedAt: nullableDate,
        }),
      ),
    }),
  ),
  relations: z.array(
    z.object({
      key: z.string(),
      fromCardKey: z.string(),
      toCardKey: z.string(),
      type: z.string(),
      weight: z.number(),
      directed: z.boolean(),
      notes: z.string().nullable(),
      revealSectionKey: z.string(),
      deletedAt: nullableDate,
    }),
  ),
  timeline: z.array(
    z.object({
      key: z.string(),
      cardKey: z.string().nullable(),
      label: z.string(),
      description: z.string().nullable(),
      revealSectionKey: z.string(),
      eraKey: z.string().nullable(),
      year: z.number().int().nullable(),
      monthOrder: z.number().int().nullable(),
      day: z.number().int().nullable(),
      precision: precisionSchema,
      displayOverride: z.string().nullable(),
      manualSortKey: z.number().int().nullable(),
      deletedAt: nullableDate,
    }),
  ),
});

export type SeriesExport = z.infer<typeof seriesExportSchema>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export async function exportSeries(viewer: Viewer): Promise<SeriesExport> {
  requireOwner(viewer.role);
  const seriesId = viewer.seriesId;

  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    select: { title: true, description: true },
  });
  if (!series) throw new NotFoundError("Series not found");

  const [books, parts, sections, templates, calendar, cards, relations, timeline] =
    await Promise.all([
      prisma.book.findMany({ where: { seriesId }, orderBy: { order: "asc" } }),
      prisma.part.findMany({ where: { book: { seriesId } }, orderBy: { order: "asc" } }),
      prisma.section.findMany({ where: { book: { seriesId } }, orderBy: { position: "asc" } }),
      prisma.template.findMany({
        where: { seriesId },
        include: { fields: { orderBy: { order: "asc" } } },
        orderBy: { cardType: "asc" },
      }),
      prisma.calendar.findFirst({
        where: { seriesId },
        include: {
          eras: { orderBy: { order: "asc" } },
          months: { orderBy: { order: "asc" } },
        },
      }),
      prisma.card.findMany({
        where: { seriesId },
        include: { fields: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.cardRelation.findMany({
        where: { fromCard: { seriesId } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.timelineEntry.findMany({ where: { seriesId }, orderBy: { createdAt: "asc" } }),
    ]);

  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    series: { title: series.title, description: series.description },
    books: books.map((b) => ({
      key: b.id,
      title: b.title,
      order: b.order,
      deletedAt: iso(b.deletedAt),
    })),
    parts: parts.map((p) => ({
      key: p.id,
      bookKey: p.bookId,
      number: p.number,
      title: p.title,
      order: p.order,
      deletedAt: iso(p.deletedAt),
    })),
    // position is omitted: it is derived and recomputed on import
    sections: sections.map((s) => ({
      key: s.id,
      bookKey: s.bookId,
      partKey: s.partId,
      type: s.type,
      number: s.number,
      title: s.title,
      deletedAt: iso(s.deletedAt),
    })),
    templates: templates.map((t) => ({
      key: t.id,
      cardType: t.cardType,
      fields: t.fields.map((f) => ({
        key: f.id,
        fieldKey: f.key,
        label: f.label,
        fieldType: f.fieldType,
        options: (f.options ?? null) as JsonLike | null,
        required: f.required,
        order: f.order,
        defaultRevealBehavior: f.defaultRevealBehavior,
        deletedAt: iso(f.deletedAt),
      })),
    })),
    calendar: calendar
      ? {
          name: calendar.name,
          epochLabel: calendar.epochLabel,
          daysPerWeek: calendar.daysPerWeek,
          weekdayNames: Array.isArray(calendar.weekdayNames)
            ? (calendar.weekdayNames as string[])
            : [],
          eras: calendar.eras.map((e) => ({
            key: e.id,
            name: e.name,
            order: e.order,
            yearOffset: e.yearOffset,
            abbreviation: e.abbreviation,
          })),
          months: calendar.months.map((m) => ({
            key: m.id,
            name: m.name,
            order: m.order,
            dayCount: m.dayCount,
          })),
        }
      : null,
    cards: cards.map((c) => ({
      key: c.id,
      type: c.type,
      title: c.title,
      summary: c.summary,
      confidence: c.confidence,
      revealSectionKey: c.revealSectionId,
      deletedAt: iso(c.deletedAt),
      fields: c.fields.map((f) => ({
        key: f.id,
        templateFieldKey: f.templateFieldId,
        value: f.value as JsonLike,
        revealSectionKey: f.revealSectionId,
        deletedAt: iso(f.deletedAt),
      })),
    })),
    relations: relations.map((r) => ({
      key: r.id,
      fromCardKey: r.fromCardId,
      toCardKey: r.toCardId,
      type: r.type,
      weight: r.weight,
      directed: r.directed,
      notes: r.notes,
      revealSectionKey: r.revealSectionId,
      deletedAt: iso(r.deletedAt),
    })),
    // absoluteSortKey is a BigInt and derived — omitted, recomputed on import
    timeline: timeline.map((t) => ({
      key: t.id,
      cardKey: t.cardId,
      label: t.label,
      description: t.description,
      revealSectionKey: t.revealSectionId,
      eraKey: t.eraId,
      year: t.year,
      monthOrder: t.monthOrder,
      day: t.day,
      precision: t.precision,
      displayOverride: t.displayOverride,
      manualSortKey: t.manualSortKey,
      deletedAt: iso(t.deletedAt),
    })),
  };
}

/**
 * Keys are the file's internal ids, remapped through a Map on import — so a
 * repeated key does not collide loudly, it silently makes every reference to
 * it resolve to whichever row came last. Uniqueness is part of "well-formed",
 * but it is not expressible in the shape schema, so it is checked here.
 */
function assertUniqueKeys(file: SeriesExport): void {
  const groups: Array<[string, string[]]> = [
    ["book", file.books.map((b) => b.key)],
    ["part", file.parts.map((p) => p.key)],
    ["section", file.sections.map((s) => s.key)],
    ["card", file.cards.map((c) => c.key)],
    ["template field", file.templates.flatMap((t) => t.fields.map((f) => f.key))],
    ["era", file.calendar?.eras.map((e) => e.key) ?? []],
  ];
  for (const [what, keys] of groups) {
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) throw new AppError(`Invalid export file — duplicate ${what} key: ${key}`);
      seen.add(key);
    }
  }
}

/** "Malformed" means "fails validation" — never an ad-hoc check at write time. */
export function parseSeriesExport(raw: unknown): SeriesExport {
  const result = seriesExportSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AppError(
      issue
        ? `Invalid export file — ${issue.path.join(".")}: ${issue.message}`
        : "Invalid export file",
    );
  }
  assertUniqueKeys(result.data);
  return result.data;
}

const date = (s: string | null): Date | null => (s ? new Date(s) : null);

/** Resolve a remapped key, failing loudly rather than writing a dangling FK. */
function need(map: Map<string, string>, key: string, what: string): string {
  const id = map.get(key);
  if (!id) throw new AppError(`Invalid export file — unknown ${what}: ${key}`);
  return id;
}

/**
 * Always creates a NEW series owned by the importer. Never writes into an
 * existing series, so an import cannot clobber live data.
 *
 * Note it does NOT call createSeries(): that seeds the seven default templates,
 * which would collide with the file's own templates on
 * @@unique([seriesId, cardType]). The series row and OWNER membership are
 * written directly instead.
 */
export async function importSeries(userId: string, file: SeriesExport): Promise<string> {
  return prisma.$transaction(
    async (tx) => {
      const series = await tx.series.create({
        data: { title: file.series.title, description: file.series.description },
        select: { id: true },
      });

      // Without a membership getViewer throws for everyone — the imported
      // series would be unreachable, including by the person who imported it.
      await tx.membership.create({
        data: {
          userId,
          seriesId: series.id,
          role: "OWNER",
          currentSectionId: null,
          revealIndex: 0,
        },
      });

      const bookIds = new Map<string, string>();
      for (const b of file.books) {
        const row = await tx.book.create({
          data: {
            seriesId: series.id,
            title: b.title,
            order: b.order,
            deletedAt: date(b.deletedAt),
          },
          select: { id: true },
        });
        bookIds.set(b.key, row.id);
      }

      const partIds = new Map<string, string>();
      for (const p of file.parts) {
        const row = await tx.part.create({
          data: {
            bookId: need(bookIds, p.bookKey, "book"),
            number: p.number,
            title: p.title,
            order: p.order,
            deletedAt: date(p.deletedAt),
          },
          select: { id: true },
        });
        partIds.set(p.key, row.id);
      }

      // position is provisional (file order); recomputeSeriesPositions
      // normalises it to a dense, gapless 1..n at the end of this transaction.
      const sectionIds = new Map<string, string>();
      for (const [i, s] of file.sections.entries()) {
        const row = await tx.section.create({
          data: {
            bookId: need(bookIds, s.bookKey, "book"),
            partId: s.partKey ? need(partIds, s.partKey, "part") : null,
            type: s.type,
            number: s.number,
            title: s.title,
            position: i + 1,
            deletedAt: date(s.deletedAt),
          },
          select: { id: true },
        });
        sectionIds.set(s.key, row.id);
      }

      const templateFieldIds = new Map<string, string>();
      for (const t of file.templates) {
        const row = await tx.template.create({
          data: { seriesId: series.id, cardType: t.cardType },
          select: { id: true },
        });
        for (const f of t.fields) {
          const field = await tx.templateField.create({
            data: {
              templateId: row.id,
              key: f.fieldKey,
              label: f.label,
              fieldType: f.fieldType,
              options: (f.options ?? undefined) as Prisma.InputJsonValue | undefined,
              required: f.required,
              order: f.order,
              defaultRevealBehavior: f.defaultRevealBehavior,
              deletedAt: date(f.deletedAt),
            },
            select: { id: true },
          });
          templateFieldIds.set(f.key, field.id);
        }
      }

      const eraIds = new Map<string, string>();
      let calendarId: string | null = null;
      if (file.calendar) {
        const cal = await tx.calendar.create({
          data: {
            seriesId: series.id,
            name: file.calendar.name,
            epochLabel: file.calendar.epochLabel,
            daysPerWeek: file.calendar.daysPerWeek,
            weekdayNames: file.calendar.weekdayNames,
          },
          select: { id: true },
        });
        calendarId = cal.id;
        for (const e of file.calendar.eras) {
          const row = await tx.calendarEra.create({
            data: {
              calendarId: cal.id,
              name: e.name,
              order: e.order,
              yearOffset: e.yearOffset,
              abbreviation: e.abbreviation,
            },
            select: { id: true },
          });
          eraIds.set(e.key, row.id);
        }
        for (const m of file.calendar.months) {
          await tx.calendarMonth.create({
            data: { calendarId: cal.id, name: m.name, order: m.order, dayCount: m.dayCount },
          });
        }
      }

      // revealIndex is provisional (0); rewritten from revealSectionId by
      // recomputeSeriesPositions below. createdById is reassigned to the
      // importer — source user ids name users that do not exist here.
      const cardIds = new Map<string, string>();
      for (const c of file.cards) {
        const row = await tx.card.create({
          data: {
            seriesId: series.id,
            type: c.type,
            title: c.title,
            summary: c.summary,
            confidence: c.confidence,
            revealSectionId: need(sectionIds, c.revealSectionKey, "section"),
            revealIndex: 0,
            createdById: userId,
            deletedAt: date(c.deletedAt),
          },
          select: { id: true },
        });
        cardIds.set(c.key, row.id);
        for (const f of c.fields) {
          await tx.cardField.create({
            data: {
              cardId: row.id,
              templateFieldId: need(templateFieldIds, f.templateFieldKey, "template field"),
              value: f.value as Prisma.InputJsonValue,
              revealSectionId: need(sectionIds, f.revealSectionKey, "section"),
              revealIndex: 0,
              deletedAt: date(f.deletedAt),
            },
          });
        }
      }

      // Relations and timeline entries need no id mapped back out, so they go
      // in as batches. One round trip instead of one per row keeps a large
      // import well inside the transaction timeout — and shortens how long the
      // whole thing holds locks. (Cards and their fields still insert per row,
      // because the card's generated id is what the field rows hang off.)
      await tx.cardRelation.createMany({
        data: file.relations.map((r) => ({
          fromCardId: need(cardIds, r.fromCardKey, "card"),
          toCardId: need(cardIds, r.toCardKey, "card"),
          type: r.type,
          weight: r.weight,
          directed: r.directed,
          notes: r.notes,
          revealSectionId: need(sectionIds, r.revealSectionKey, "section"),
          revealIndex: 0,
          deletedAt: date(r.deletedAt),
        })),
      });

      await tx.timelineEntry.createMany({
        data: file.timeline.map((t) => ({
          seriesId: series.id,
          cardId: t.cardKey ? need(cardIds, t.cardKey, "card") : null,
          label: t.label,
          description: t.description,
          revealSectionId: need(sectionIds, t.revealSectionKey, "section"),
          revealIndex: 0,
          eraId: t.eraKey ? need(eraIds, t.eraKey, "era") : null,
          year: t.year,
          monthOrder: t.monthOrder,
          day: t.day,
          precision: t.precision,
          displayOverride: t.displayOverride,
          manualSortKey: t.manualSortKey,
          deletedAt: date(t.deletedAt),
        })),
      });

      // Derived state, rebuilt from the FKs that are the source of truth.
      await recomputeSeriesPositions(series.id, tx);
      if (calendarId) await recomputeCalendarSortKeys(calendarId, tx);

      return series.id;
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}
