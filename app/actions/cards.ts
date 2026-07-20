"use server";

import { optInt, optStr, parseOr400, runAndRedirect, str } from "@/lib/action-run";
import { getRequestViewer } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { parseFieldValue } from "@/lib/field-form";
import { cardCreateSchema, cardUpdateSchema } from "@/lib/schemas";
import {
  clearCardField,
  createCard,
  restoreCard,
  setCardField,
  setCardRevealPoint,
  softDeleteCard,
  updateCard,
} from "@/lib/services/cards";

export async function createCardAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const viewer = await getRequestViewer(seriesId);
  const type = str(formData, "type");
  await runAndRedirect(`/series/${seriesId}/cards/new?type=${type}`, async () => {
    const template = await prisma.template.findFirst({
      where: { seriesId, cardType: type as never },
      include: { fields: { where: { deletedAt: null } } },
    });
    if (!template) throw new NotFoundError("Unknown card type");
    const fields: Array<{ templateFieldId: string; value: unknown; revealSectionId?: string }> = [];
    for (const tf of template.fields) {
      const value = parseFieldValue(tf.fieldType, formData, tf.id);
      if (value === undefined) continue;
      fields.push({
        templateFieldId: tf.id,
        value,
        revealSectionId: optStr(formData, `fieldReveal_${tf.id}`),
      });
    }
    const input = parseOr400(cardCreateSchema, {
      type,
      title: str(formData, "title"),
      summary: optStr(formData, "summary"),
      confidence: optInt(formData, "confidence"),
      revealSectionId: str(formData, "revealSectionId"),
      fields,
    });
    const id = await createCard(viewer, input);
    return `/series/${seriesId}/cards/${id}`;
  });
}

export async function updateCardAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const cardId = str(formData, "cardId");
  const viewer = await getRequestViewer(seriesId);
  await runAndRedirect(`/series/${seriesId}/cards/${cardId}/edit`, async () => {
    const patch = parseOr400(cardUpdateSchema, {
      title: optStr(formData, "title"),
      summary: optStr(formData, "summary") ?? null,
      confidence: optInt(formData, "confidence") ?? null,
    });
    await updateCard(viewer, cardId, patch);
    const revealSectionId = optStr(formData, "revealSectionId");
    if (revealSectionId) await setCardRevealPoint(viewer, cardId, revealSectionId);
    return `/series/${seriesId}/cards/${cardId}`;
  });
}

export async function setFieldAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const cardId = str(formData, "cardId");
  const templateFieldId = str(formData, "templateFieldId");
  const viewer = await getRequestViewer(seriesId);
  await runAndRedirect(`/series/${seriesId}/cards/${cardId}/edit`, async () => {
    const tf = await prisma.templateField.findFirst({
      where: { id: templateFieldId, template: { seriesId } },
    });
    if (!tf) throw new NotFoundError("Template field not found");
    const value = parseFieldValue(tf.fieldType, formData, tf.id);
    if (value === undefined) {
      await clearCardField(viewer, cardId, templateFieldId);
    } else {
      await setCardField(viewer, cardId, templateFieldId, {
        value,
        revealSectionId: optStr(formData, `fieldReveal_${tf.id}`),
      });
    }
  });
}

export async function deleteCardAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const viewer = await getRequestViewer(seriesId);
  await runAndRedirect(`/series/${seriesId}/cards`, () =>
    softDeleteCard(viewer, str(formData, "cardId")),
  );
}

export async function restoreCardAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const cardId = str(formData, "cardId");
  const viewer = await getRequestViewer(seriesId);
  await runAndRedirect(`/series/${seriesId}/cards`, async () => {
    await restoreCard(viewer, cardId);
    return `/series/${seriesId}/cards/${cardId}`;
  });
}
