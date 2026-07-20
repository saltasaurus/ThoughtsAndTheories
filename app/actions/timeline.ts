"use server";

import { optInt, optStr, parseOr400, runAndRedirect, str } from "@/lib/action-run";
import { getRequestViewer } from "@/lib/auth-helpers";
import { inWorldDateSchema } from "@/lib/schemas";
import {
  createTimelineEntry,
  restoreTimelineEntry,
  softDeleteTimelineEntry,
} from "@/lib/services/timeline";

export async function createTimelineEntryAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const viewer = await getRequestViewer(seriesId);
  const returnTo = `/series/${seriesId}/timeline`;
  await runAndRedirect(returnTo, async () => {
    const toInt = (key: string): number | null => optInt(formData, key) ?? null;
    const date = parseOr400(inWorldDateSchema, {
      eraId: optStr(formData, "date_era") ?? null,
      year: toInt("date_year"),
      monthOrder: toInt("date_month"),
      day: toInt("date_day"),
      precision: str(formData, "date_precision"),
      displayOverride: optStr(formData, "date_override") ?? null,
    });
    await createTimelineEntry(viewer, {
      label: str(formData, "label"),
      description: optStr(formData, "description"),
      cardId: optStr(formData, "cardId") ?? null,
      revealSectionId: str(formData, "revealSectionId"),
      date,
      manualSortKey: optInt(formData, "manualSortKey") ?? null,
    });
  });
}

export async function deleteTimelineEntryAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const viewer = await getRequestViewer(seriesId);
  await runAndRedirect(`/series/${seriesId}/timeline`, () =>
    softDeleteTimelineEntry(viewer, str(formData, "entryId")),
  );
}

export async function restoreTimelineEntryAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const viewer = await getRequestViewer(seriesId);
  await runAndRedirect(`/series/${seriesId}/timeline`, () =>
    restoreTimelineEntry(viewer, str(formData, "entryId")),
  );
}
