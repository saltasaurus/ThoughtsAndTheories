import type { Prisma } from "@prisma/client";
import { computeAbsoluteSortKey, type InWorldDate } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { requireEditor } from "@/lib/permissions";
import type { Viewer } from "@/lib/visibility";

export type TimelineEntryInput = {
  label: string;
  description?: string;
  cardId?: string | null;
  revealSectionId: string;
  date: InWorldDate;
  manualSortKey?: number | null;
};

async function resolveDate(
  tx: Prisma.TransactionClient,
  seriesId: string,
  date: InWorldDate,
): Promise<{ sortKey: bigint | null }> {
  if (date.precision === "UNKNOWN" || date.eraId === null) return { sortKey: null };
  const era = await tx.calendarEra.findFirst({
    where: { id: date.eraId, calendar: { seriesId } },
    select: { yearOffset: true },
  });
  if (!era) throw new NotFoundError("Era not found in this series' calendar");
  return { sortKey: computeAbsoluteSortKey(date, era) };
}

export async function createTimelineEntry(
  viewer: Viewer,
  input: TimelineEntryInput,
): Promise<string> {
  requireEditor(viewer.role);
  return prisma.$transaction(async (tx) => {
    const section = await tx.section.findFirst({
      where: { id: input.revealSectionId, book: { seriesId: viewer.seriesId }, deletedAt: null },
      select: { id: true, position: true },
    });
    if (!section) throw new NotFoundError("Reveal section not found in this series");
    if (input.cardId) {
      const card = await tx.card.findFirst({
        where: { id: input.cardId, seriesId: viewer.seriesId, deletedAt: null },
        select: { id: true },
      });
      if (!card) throw new NotFoundError("Card not found in this series");
    }
    const { sortKey } = await resolveDate(tx, viewer.seriesId, input.date);
    const entry = await tx.timelineEntry.create({
      data: {
        seriesId: viewer.seriesId,
        cardId: input.cardId ?? null,
        label: input.label,
        description: input.description ?? null,
        revealSectionId: section.id,
        revealIndex: section.position,
        eraId: input.date.eraId,
        year: input.date.year,
        monthOrder: input.date.monthOrder,
        day: input.date.day,
        precision: input.date.precision,
        displayOverride: input.date.displayOverride,
        absoluteSortKey: sortKey,
        manualSortKey: input.manualSortKey ?? null,
      },
    });
    return entry.id;
  });
}

export async function updateTimelineEntry(
  viewer: Viewer,
  entryId: string,
  input: TimelineEntryInput,
): Promise<void> {
  requireEditor(viewer.role);
  await prisma.$transaction(async (tx) => {
    const entry = await tx.timelineEntry.findFirst({
      where: { id: entryId, seriesId: viewer.seriesId, deletedAt: null },
    });
    if (!entry) throw new NotFoundError("Timeline entry not found");
    const section = await tx.section.findFirst({
      where: { id: input.revealSectionId, book: { seriesId: viewer.seriesId }, deletedAt: null },
      select: { id: true, position: true },
    });
    if (!section) throw new NotFoundError("Reveal section not found in this series");
    const { sortKey } = await resolveDate(tx, viewer.seriesId, input.date);
    await tx.timelineEntry.update({
      where: { id: entryId },
      data: {
        label: input.label,
        description: input.description ?? null,
        cardId: input.cardId ?? null,
        revealSectionId: section.id,
        revealIndex: section.position,
        eraId: input.date.eraId,
        year: input.date.year,
        monthOrder: input.date.monthOrder,
        day: input.date.day,
        precision: input.date.precision,
        displayOverride: input.date.displayOverride,
        absoluteSortKey: sortKey,
        manualSortKey: input.manualSortKey ?? null,
      },
    });
  });
}

export async function softDeleteTimelineEntry(viewer: Viewer, entryId: string): Promise<void> {
  requireEditor(viewer.role);
  const entry = await prisma.timelineEntry.findFirst({
    where: { id: entryId, seriesId: viewer.seriesId, deletedAt: null },
  });
  if (!entry) throw new NotFoundError("Timeline entry not found");
  await prisma.timelineEntry.update({ where: { id: entryId }, data: { deletedAt: new Date() } });
}

export async function restoreTimelineEntry(viewer: Viewer, entryId: string): Promise<void> {
  requireEditor(viewer.role);
  const entry = await prisma.timelineEntry.findFirst({
    where: { id: entryId, seriesId: viewer.seriesId, deletedAt: { not: null } },
  });
  if (!entry) throw new NotFoundError("Deleted timeline entry not found");
  await prisma.timelineEntry.update({ where: { id: entryId }, data: { deletedAt: null } });
}
