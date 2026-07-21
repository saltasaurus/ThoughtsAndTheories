import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { requireOwner } from "@/lib/permissions";
import type { Viewer } from "@/lib/visibility";

/**
 * Recompute every TimelineEntry.absoluteSortKey derived from this calendar's
 * eras. Same transactional pattern as recomputeSeriesPositions.
 */
export async function recomputeCalendarSortKeys(
  calendarId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const run = async (t: Prisma.TransactionClient): Promise<void> => {
    // Mirrors computeAbsoluteSortKey exactly, including precision truncation.
    await t.$executeRaw`
      UPDATE "TimelineEntry" te
      SET "absoluteSortKey" =
        (e."yearOffset" + te."year")::bigint * 1000000
        + (CASE WHEN te."precision" = 'YEAR' THEN 0 ELSE COALESCE(te."monthOrder", 0) END) * 10000
        + (CASE WHEN te."precision" = 'DAY' THEN COALESCE(te."day", 0) ELSE 0 END)
      FROM "CalendarEra" e
      WHERE te."eraId" = e."id"
        AND e."calendarId" = ${calendarId}
        AND te."precision" != 'UNKNOWN'
        AND te."year" IS NOT NULL`;
  };
  if (tx) return run(tx);
  return prisma.$transaction(run);
}

/** yearOffset is mutable and invalidates every derived sort key — recompute in the same transaction. */
export async function updateEraYearOffset(
  viewer: Viewer,
  eraId: string,
  yearOffset: number,
): Promise<void> {
  requireOwner(viewer.role);
  await prisma.$transaction(async (tx) => {
    const era = await tx.calendarEra.findFirst({
      where: { id: eraId, calendar: { seriesId: viewer.seriesId } },
      select: { id: true, calendarId: true },
    });
    if (!era) throw new NotFoundError("Era not found in this series");
    await tx.calendarEra.update({ where: { id: eraId }, data: { yearOffset } });
    await recomputeCalendarSortKeys(era.calendarId, tx);
  });
}

export async function getSeriesCalendar(seriesId: string) {
  return prisma.calendar.findFirst({
    where: { seriesId },
    include: {
      eras: { orderBy: { order: "asc" } },
      months: { orderBy: { order: "asc" } },
    },
  });
}

// ---------- calendar editor (OWNER) ----------

async function requireCalendar(
  tx: Prisma.TransactionClient,
  calendarId: string,
  seriesId: string,
): Promise<{ id: string }> {
  const calendar = await tx.calendar.findFirst({
    where: { id: calendarId, seriesId },
    select: { id: true },
  });
  if (!calendar) throw new NotFoundError("Calendar not found in this series");
  return calendar;
}

export type CalendarInput = {
  name: string;
  epochLabel?: string | null;
  daysPerWeek: number;
  weekdayNames: string[];
};

/**
 * Series.calendars is an unconstrained list, but every read path uses
 * findFirst — a second calendar would be silently unreachable, so one per
 * series is enforced here.
 */
export async function createCalendar(viewer: Viewer, input: CalendarInput): Promise<string> {
  requireOwner(viewer.role);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.calendar.findFirst({
      where: { seriesId: viewer.seriesId },
      select: { id: true },
    });
    if (existing) throw new ConflictError("This series already has a calendar");
    const calendar = await tx.calendar.create({
      data: {
        seriesId: viewer.seriesId,
        name: input.name,
        epochLabel: input.epochLabel ?? null,
        daysPerWeek: input.daysPerWeek,
        weekdayNames: input.weekdayNames,
      },
      select: { id: true },
    });
    return calendar.id;
  });
}

/** Week config + naming. None of these feed absoluteSortKey, so no recompute. */
export async function updateCalendar(
  viewer: Viewer,
  calendarId: string,
  patch: Partial<CalendarInput>,
): Promise<void> {
  requireOwner(viewer.role);
  await prisma.$transaction(async (tx) => {
    await requireCalendar(tx, calendarId, viewer.seriesId);
    if (patch.weekdayNames && patch.daysPerWeek !== undefined) {
      if (patch.weekdayNames.length !== patch.daysPerWeek) {
        throw new ConflictError(
          `Give exactly ${patch.daysPerWeek} weekday name(s) for a ${patch.daysPerWeek}-day week`,
        );
      }
    }
    await tx.calendar.update({
      where: { id: calendarId },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.epochLabel !== undefined ? { epochLabel: patch.epochLabel } : {}),
        ...(patch.daysPerWeek !== undefined ? { daysPerWeek: patch.daysPerWeek } : {}),
        ...(patch.weekdayNames !== undefined ? { weekdayNames: patch.weekdayNames } : {}),
      },
    });
  });
}

export type EraInput = { name: string; abbreviation: string; yearOffset: number };

/** Appends an era. A brand-new era has no entries yet, so nothing to recompute. */
export async function addEra(
  viewer: Viewer,
  calendarId: string,
  input: EraInput,
): Promise<string> {
  requireOwner(viewer.role);
  return prisma.$transaction(async (tx) => {
    await requireCalendar(tx, calendarId, viewer.seriesId);
    const last = await tx.calendarEra.findFirst({
      where: { calendarId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const era = await tx.calendarEra.create({
      data: {
        calendarId,
        name: input.name,
        abbreviation: input.abbreviation,
        yearOffset: input.yearOffset,
        order: (last?.order ?? 0) + 1,
      },
      select: { id: true },
    });
    return era.id;
  });
}

/** Renaming is free; changing yearOffset invalidates every derived sort key. */
export async function updateEra(
  viewer: Viewer,
  eraId: string,
  patch: Partial<EraInput>,
): Promise<void> {
  requireOwner(viewer.role);
  await prisma.$transaction(async (tx) => {
    const era = await tx.calendarEra.findFirst({
      where: { id: eraId, calendar: { seriesId: viewer.seriesId } },
      select: { id: true, calendarId: true, yearOffset: true },
    });
    if (!era) throw new NotFoundError("Era not found in this series");
    await tx.calendarEra.update({
      where: { id: eraId },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.abbreviation !== undefined ? { abbreviation: patch.abbreviation } : {}),
        ...(patch.yearOffset !== undefined ? { yearOffset: patch.yearOffset } : {}),
      },
    });
    if (patch.yearOffset !== undefined && patch.yearOffset !== era.yearOffset) {
      await recomputeCalendarSortKeys(era.calendarId, tx);
    }
  });
}

/**
 * Eras are FK-referenced by TimelineEntry.eraId, so an in-use era cannot be
 * deleted — rename it or change its offset instead (both recompute cleanly).
 */
export async function deleteEra(viewer: Viewer, eraId: string): Promise<void> {
  requireOwner(viewer.role);
  await prisma.$transaction(async (tx) => {
    const era = await tx.calendarEra.findFirst({
      where: { id: eraId, calendar: { seriesId: viewer.seriesId } },
      select: { id: true },
    });
    if (!era) throw new NotFoundError("Era not found in this series");

    // NOT filtered by deletedAt: this is a HARD delete and TimelineEntry.eraId
    // is ON DELETE SET NULL, so a soft-deleted entry would silently have its
    // era nulled while keeping its stale absoluteSortKey — and
    // recomputeCalendarSortKeys inner-joins CalendarEra, so a null-era row can
    // never be repaired. Soft-deleted entries are restorable, so they count.
    const inUse = await tx.timelineEntry.count({ where: { eraId } });
    // INWORLD_DATE card values embed eraId in JSON with no FK to catch this.
    const inCardFields = await tx.cardField.count({
      where: {
        deletedAt: null,
        card: { seriesId: viewer.seriesId },
        templateField: { fieldType: "INWORLD_DATE" },
        value: { path: ["eraId"], equals: eraId },
      },
    });
    if (inUse + inCardFields > 0) {
      throw new ConflictError(
        `This era dates ${inUse} timeline entr${inUse === 1 ? "y" : "ies"} and ${inCardFields} card field(s). Re-date them before deleting it.`,
      );
    }
    await tx.calendarEra.delete({ where: { id: eraId } });
  });
}

export type MonthInput = { name: string; dayCount: number };

/**
 * Months are append-only: entries store the raw integer `monthOrder`, not an
 * FK, so renumbering would silently re-point every stored date at a different
 * month. Order is fixed at creation and never rewritten — not on add, not on
 * delete.
 */
export async function addMonth(
  viewer: Viewer,
  calendarId: string,
  input: MonthInput,
): Promise<string> {
  requireOwner(viewer.role);
  return prisma.$transaction(async (tx) => {
    await requireCalendar(tx, calendarId, viewer.seriesId);
    const last = await tx.calendarMonth.findFirst({
      where: { calendarId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const month = await tx.calendarMonth.create({
      data: {
        calendarId,
        name: input.name,
        dayCount: input.dayCount,
        order: (last?.order ?? 0) + 1,
      },
      select: { id: true },
    });
    return month.id;
  });
}

export async function updateMonth(
  viewer: Viewer,
  monthId: string,
  patch: Partial<MonthInput>,
): Promise<void> {
  requireOwner(viewer.role);
  const month = await prisma.calendarMonth.findFirst({
    where: { id: monthId, calendar: { seriesId: viewer.seriesId } },
    select: { id: true },
  });
  if (!month) throw new NotFoundError("Month not found in this series");
  await prisma.calendarMonth.update({
    where: { id: monthId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.dayCount !== undefined ? { dayCount: patch.dayCount } : {}),
    },
  });
}

/**
 * No FK backs monthOrder, so the in-use check is an app-level comparison
 * against entries in this calendar's series. Remaining months keep their
 * `order` values (gaps are fine) — renumbering would re-point stored dates.
 */
export async function deleteMonth(viewer: Viewer, monthId: string): Promise<void> {
  requireOwner(viewer.role);
  await prisma.$transaction(async (tx) => {
    const month = await tx.calendarMonth.findFirst({
      where: { id: monthId, calendar: { seriesId: viewer.seriesId } },
      select: { id: true, order: true, calendar: { select: { seriesId: true } } },
    });
    if (!month) throw new NotFoundError("Month not found in this series");
    // Hard delete, and soft-deleted entries are restorable — so, as with eras,
    // they count as in use.
    const inUse = await tx.timelineEntry.count({
      where: { seriesId: month.calendar.seriesId, monthOrder: month.order },
    });
    // INWORLD_DATE card values embed monthOrder in JSON with no FK behind it.
    const inCardFields = await tx.cardField.count({
      where: {
        deletedAt: null,
        card: { seriesId: month.calendar.seriesId },
        templateField: { fieldType: "INWORLD_DATE" },
        value: { path: ["monthOrder"], equals: month.order },
      },
    });
    if (inUse + inCardFields > 0) {
      throw new ConflictError(
        `This month dates ${inUse} timeline entr${inUse === 1 ? "y" : "ies"} and ${inCardFields} card field(s). Re-date them before deleting it.`,
      );
    }
    await tx.calendarMonth.delete({ where: { id: monthId } });
  });
}
