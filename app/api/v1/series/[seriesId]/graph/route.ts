import { errorResponse, getViewerFromToken, json, parseInput, searchParams } from "@/lib/api";
import { apiGraphQuerySchema } from "@/lib/schemas";
import { graphData } from "@/lib/visibility";

type Ctx = { params: Promise<{ seriesId: string }> };

/** Gated cards are omitted entirely — no phantom nodes, same as the UI. */
export async function GET(request: Request, { params }: Ctx) {
  try {
    const { seriesId } = await params;
    const viewer = await getViewerFromToken(request, seriesId);
    const q = parseInput(apiGraphQuerySchema, searchParams(request));
    return json(await graphData(viewer, q));
  } catch (e) {
    return errorResponse(e);
  }
}
