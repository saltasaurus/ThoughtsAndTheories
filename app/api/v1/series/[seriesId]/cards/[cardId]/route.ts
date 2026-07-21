import { errorResponse, getViewerFromToken, json, jsonBody, parseInput } from "@/lib/api";
import { apiSetFieldSchema, cardUpdateSchema } from "@/lib/schemas";
import { setCardField, updateCard } from "@/lib/services/cards";
import { getCardDetail } from "@/lib/visibility";

type Ctx = { params: Promise<{ seriesId: string; cardId: string }> };

/**
 * Detail has no locked placeholder — placeholders exist only in list views
 * (getCardDetail returns null for a gated card), so a gated card is a 404 here.
 * Anything else would confirm the card exists.
 */
export async function GET(request: Request, { params }: Ctx) {
  try {
    const { seriesId, cardId } = await params;
    const viewer = await getViewerFromToken(request, seriesId);
    const card = await getCardDetail(viewer, cardId);
    if (!card) return json({ error: "Not found" }, 404);
    return json(card);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { seriesId, cardId } = await params;
    const viewer = await getViewerFromToken(request, seriesId);
    const patch = parseInput(cardUpdateSchema, await jsonBody(request));
    await updateCard(viewer, cardId, patch);
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Set (or create) one field value on this card. */
export async function PUT(request: Request, { params }: Ctx) {
  try {
    const { seriesId, cardId } = await params;
    const viewer = await getViewerFromToken(request, seriesId);
    const input = parseInput(apiSetFieldSchema, await jsonBody(request));
    await setCardField(viewer, cardId, input.templateFieldId, {
      value: input.value,
      ...(input.revealSectionId ? { revealSectionId: input.revealSectionId } : {}),
    });
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
