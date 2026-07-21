import {
  errorResponse,
  getViewerFromToken,
  json,
  jsonBody,
  parseInput,
  searchParams,
} from "@/lib/api";
import { apiListQuerySchema, cardCreateSchema } from "@/lib/schemas";
import { createCard } from "@/lib/services/cards";
import { listCards } from "@/lib/visibility";

type Ctx = { params: Promise<{ seriesId: string }> };

/**
 * Gated cards come back as { id, locked: true } and nothing else — the exact
 * shape listCards gives the web UI, because it IS listCards. There is no second
 * gate in the API layer to drift from the first.
 */
export async function GET(request: Request, { params }: Ctx) {
  try {
    const { seriesId } = await params;
    const viewer = await getViewerFromToken(request, seriesId);
    const q = parseInput(apiListQuerySchema, searchParams(request));
    return json(await listCards(viewer, q));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Writes reuse the same service the Server Actions call; it enforces EDITOR. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { seriesId } = await params;
    const viewer = await getViewerFromToken(request, seriesId);
    const input = parseInput(cardCreateSchema, await jsonBody(request));
    const id = await createCard(viewer, input);
    return json({ id }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
