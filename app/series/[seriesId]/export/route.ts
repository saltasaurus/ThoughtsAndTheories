import { errorResponse } from "@/lib/api";
import { getRequestViewer } from "@/lib/auth-helpers";
import { exportSeries } from "@/lib/services/export-import";

/**
 * Cookie-authed JSON download (OWNER only — enforced inside exportSeries).
 * A route handler rather than a Server Action because the response is a file.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ seriesId: string }> }) {
  try {
    const { seriesId } = await params;
    const viewer = await getRequestViewer(seriesId);
    const data = await exportSeries(viewer);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="series-${seriesId}-${stamp}.json"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
