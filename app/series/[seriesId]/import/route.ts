import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { getRequestViewer } from "@/lib/auth-helpers";
import { AppError } from "@/lib/errors";
import { requireOwner } from "@/lib/permissions";
import { importSeries, parseSeriesExport } from "@/lib/services/export-import";

/**
 * Import as a ROUTE HANDLER, not a Server Action, and that is the whole point.
 *
 * Server Actions carry Next's `serverActions.bodySizeLimit`, which defaults to
 * 1 MB. Export is a route handler with no such limit, so any series whose JSON
 * exceeded 1 MB exported cleanly and then failed to import — a backup that
 * cannot restore. Route handlers stream the body, so export and import now
 * share the same ceiling: none.
 *
 * A plain HTML form posts here (multipart), so no client JS is involved.
 * Import always creates a NEW series owned by the caller; `seriesId` is only
 * the page they came from, but OWNER on it is still required — import/export
 * is an owner-level tool and a POST endpoint enforces its own rules.
 */
export async function POST(request: Request, { params }: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = await params;
  const settings = new URL(`/series/${seriesId}/settings`, request.url);
  try {
    const viewer = await getRequestViewer(seriesId);
    requireOwner(viewer.role);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError("Choose a JSON export file to import");
    }

    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      throw new AppError("That file is not valid JSON");
    }

    const newSeriesId = await importSeries(viewer.userId, parseSeriesExport(raw));
    // 303 so the browser follows with GET rather than re-POSTing the upload.
    return NextResponse.redirect(new URL(`/series/${newSeriesId}`, request.url), 303);
  } catch (e) {
    if (e instanceof AppError) {
      settings.searchParams.set("error", e.message);
      return NextResponse.redirect(settings, 303);
    }
    return errorResponse(e); // re-throws NEXT_REDIRECT (the login bounce)
  }
}
