import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
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
