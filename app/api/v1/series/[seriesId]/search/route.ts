import { errorResponse, getViewerFromToken, json, parseInput, searchParams } from "@/lib/api";
import { apiSearchQuerySchema } from "@/lib/schemas";
import { searchCards } from "@/lib/visibility";

type Ctx = { params: Promise<{ seriesId: string }> };

/**
 * Search omits gated cards entirely rather than placeholdering them: a match
 * against a gated card would leak that the term exists. Same searchCards the
 * UI uses, gate applied in the same WHERE.
 */
export async function GET(request: Request, { params }: Ctx) {
  try {
    const { seriesId } = await params;
    const viewer = await getViewerFromToken(request, seriesId);
    const { q, ...opts } = parseInput(apiSearchQuerySchema, searchParams(request));
    return json(await searchCards(viewer, q, opts));
  } catch (e) {
    return errorResponse(e);
  }
}
