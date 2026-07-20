"use server";

import { optStr, parseOr400, str, runAndRedirect } from "@/lib/action-run";
import { getRequestViewer } from "@/lib/auth-helpers";
import { relationSchema } from "@/lib/schemas";
import { createRelation, restoreRelation, softDeleteRelation } from "@/lib/services/relations";

export async function createRelationAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const fromCardId = str(formData, "fromCardId");
  const viewer = await getRequestViewer(seriesId);
  await runAndRedirect(`/series/${seriesId}/cards/${fromCardId}/edit`, async () => {
    const input = parseOr400(relationSchema, {
      fromCardId,
      toCardId: str(formData, "toCardId"),
      type: str(formData, "type"),
      weight: Number(str(formData, "weight") || "0.5"),
      directed: formData.get("directed") === "on",
      notes: optStr(formData, "notes"),
      revealSectionId: str(formData, "revealSectionId"),
    });
    await createRelation(viewer, input);
    return `/series/${seriesId}/cards/${fromCardId}`;
  });
}

export async function deleteRelationAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const cardId = str(formData, "cardId");
  const viewer = await getRequestViewer(seriesId);
  await runAndRedirect(`/series/${seriesId}/cards/${cardId}`, () =>
    softDeleteRelation(viewer, str(formData, "relationId")),
  );
}

export async function restoreRelationAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const cardId = str(formData, "cardId");
  const viewer = await getRequestViewer(seriesId);
  await runAndRedirect(`/series/${seriesId}/cards/${cardId}/edit`, () =>
    restoreRelation(viewer, str(formData, "relationId")),
  );
}
