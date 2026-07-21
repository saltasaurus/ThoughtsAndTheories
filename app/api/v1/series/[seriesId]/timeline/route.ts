import { errorResponse, getViewerFromToken, json, parseInput, searchParams } from "@/lib/api";
import { apiTimelineQuerySchema } from "@/lib/schemas";
import { listTimeline } from "@/lib/visibility";

type Ctx = { params: Promise<{ seriesId: string }> };

/**
 * maxRevealIndex is clamped server-side against the viewer's progress inside
 * listTimeline — a range parameter can narrow, never widen. absoluteSortKey is
 * a BigInt and is serialised as a decimal string by json().
 */
export async function GET(request: Request, { params }: Ctx) {
  try {
    const { seriesId } = await params;
    const viewer = await getViewerFromToken(request, seriesId);
    const q = parseInput(apiTimelineQuerySchema, searchParams(request));
    return json(await listTimeline(viewer, q));
  } catch (e) {
    return errorResponse(e);
  }
}
