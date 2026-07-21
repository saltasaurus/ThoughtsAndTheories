"use server";

import { runAndRedirect, str } from "@/lib/action-run";
import { getRequestViewer } from "@/lib/auth-helpers";
import { AppError } from "@/lib/errors";
import { requireOwner } from "@/lib/permissions";
import { importSeries, parseSeriesExport } from "@/lib/services/export-import";

/**
 * Import always creates a NEW series owned by the importer — it never merges
 * into the series whose settings page launched it. On success we redirect to
 * the new series, not back to the old one.
 *
 * The OWNER check is not redundant with the UI hiding this panel: a Server
 * Action is a POST endpoint, so rendering rules enforce nothing. Import/export
 * is an OWNER-level tool, and the guard has to live here. It also keeps the
 * authorization boundary in place for the day someone adds a merge mode —
 * importSeries takes a userId rather than a Viewer, so it carries no series
 * context of its own to check.
 */
export async function importSeriesAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const viewer = await getRequestViewer(seriesId);
  requireOwner(viewer.role);
  await runAndRedirect(`/series/${seriesId}/settings`, async () => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError("Choose a JSON export file to import");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      throw new AppError("That file is not valid JSON");
    }
    const parsed = parseSeriesExport(raw);
    const newSeriesId = await importSeries(viewer.userId, parsed);
    return `/series/${newSeriesId}`;
  });
}
