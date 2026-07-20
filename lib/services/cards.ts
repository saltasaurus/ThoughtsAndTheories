import type { CardType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { requireEditor } from "@/lib/permissions";
import { validateFieldValue } from "@/lib/schemas";
import type { Viewer } from "@/lib/visibility";
import { writeRevision } from "@/lib/services/revisions";

type Tx = Prisma.TransactionClient;

async function requireSection(
  tx: Tx,
  seriesId: string,
  sectionId: string,
): Promise<{ id: string; position: number }> {
  const section = await tx.section.findFirst({
    where: { id: sectionId, book: { seriesId }, deletedAt: null },
    select: { id: true, position: true },
  });
  if (!section) throw new NotFoundError("Reveal section not found in this series");
  return section;
}

async function seriesFirstSection(
  tx: Tx,
  seriesId: string,
): Promise<{ id: string; position: number } | null> {
  return tx.section.findFirst({
    where: { book: { seriesId }, deletedAt: null },
    orderBy: { position: "asc" },
    select: { id: true, position: true },
  });
}

export type CardCreateInput = {
  type: CardType;
  title: string;
  summary?: string;
  confidence?: number;
  revealSectionId: string;
  fields: Array<{ templateFieldId: string; value: unknown; revealSectionId?: string }>;
};

export async function createCard(viewer: Viewer, input: CardCreateInput): Promise<string> {
  requireEditor(viewer.role);
  return prisma.$transaction(async (tx) => {
    const revealSection = await requireSection(tx, viewer.seriesId, input.revealSectionId);
    const template = await tx.template.findUnique({
      where: { seriesId_cardType: { seriesId: viewer.seriesId, cardType: input.type } },
      include: { fields: { where: { deletedAt: null } } },
    });
    if (!template) throw new NotFoundError(`No template for card type ${input.type}`);
    const templateFields = new Map(template.fields.map((f) => [f.id, f]));

    const required = template.fields.filter((f) => f.required).map((f) => f.id);
    const provided = new Set(input.fields.map((f) => f.templateFieldId));
    for (const id of required) {
      if (!provided.has(id)) throw new AppError("Missing required field", 400);
    }

    const card = await tx.card.create({
      data: {
        seriesId: viewer.seriesId,
        type: input.type,
        title: input.title,
        summary: input.summary ?? null,
        confidence: input.type === "THEORY" ? (input.confidence ?? 3) : null,
        revealSectionId: revealSection.id,
        revealIndex: revealSection.position,
        createdById: viewer.userId,
      },
    });
    await writeRevision(tx, {
      entityType: "CARD",
      entityId: card.id,
      userId: viewer.userId,
      diff: { after: { title: card.title, summary: card.summary, type: card.type } },
      revealIndex: card.revealIndex,
    });

    for (const f of input.fields) {
      const tf = templateFields.get(f.templateFieldId);
      if (!tf) throw new NotFoundError("Template field not found");
      const value = validateFieldValue(
        tf.fieldType,
        tf.options as { choices?: string[] } | null,
        f.value,
      ) as Prisma.InputJsonValue;
      // Field reveal point: explicit choice, else the template's default behavior.
      let fieldSection: { id: string; position: number };
      if (f.revealSectionId) {
        fieldSection = await requireSection(tx, viewer.seriesId, f.revealSectionId);
      } else if (tf.defaultRevealBehavior === "SERIES_START") {
        fieldSection = (await seriesFirstSection(tx, viewer.seriesId)) ?? revealSection;
      } else {
        fieldSection = revealSection;
      }
      const created = await tx.cardField.create({
        data: {
          cardId: card.id,
          templateFieldId: tf.id,
          value,
          revealSectionId: fieldSection.id,
          revealIndex: fieldSection.position,
        },
      });
      await writeRevision(tx, {
        entityType: "CARD_FIELD",
        entityId: created.id,
        userId: viewer.userId,
        diff: { after: { value } },
        revealIndex: created.revealIndex,
      });
    }
    return card.id;
  });
}

export async function updateCard(
  viewer: Viewer,
  cardId: string,
  patch: { title?: string; summary?: string | null; confidence?: number | null },
): Promise<void> {
  requireEditor(viewer.role);
  await prisma.$transaction(async (tx) => {
    const card = await tx.card.findFirst({
      where: { id: cardId, seriesId: viewer.seriesId, deletedAt: null },
    });
    if (!card) throw new NotFoundError("Card not found");
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (patch.title !== undefined && patch.title !== card.title) {
      before.title = card.title;
      after.title = patch.title;
    }
    if (patch.summary !== undefined && patch.summary !== card.summary) {
      before.summary = card.summary;
      after.summary = patch.summary;
    }
    if (patch.confidence !== undefined && patch.confidence !== card.confidence) {
      before.confidence = card.confidence;
      after.confidence = patch.confidence;
    }
    if (Object.keys(after).length === 0) return;
    await tx.card.update({ where: { id: cardId }, data: patch });
    await writeRevision(tx, {
      entityType: "CARD",
      entityId: cardId,
      userId: viewer.userId,
      diff: { before, after } as Prisma.InputJsonValue,
      revealIndex: card.revealIndex,
    });
  });
}

/**
 * The reveal-index cascade rule: raising a card's reveal point raises any of
 * its fields and relations that would otherwise precede it. Lowering never
 * cascades. One transaction.
 */
export async function setCardRevealPoint(
  viewer: Viewer,
  cardId: string,
  sectionId: string,
): Promise<void> {
  requireEditor(viewer.role);
  await prisma.$transaction(async (tx) => {
    const card = await tx.card.findFirst({
      where: { id: cardId, seriesId: viewer.seriesId, deletedAt: null },
    });
    if (!card) throw new NotFoundError("Card not found");
    const section = await requireSection(tx, viewer.seriesId, sectionId);
    if (section.position === card.revealIndex && section.id === card.revealSectionId) return;

    await tx.card.update({
      where: { id: cardId },
      data: { revealSectionId: section.id, revealIndex: section.position },
    });
    await writeRevision(tx, {
      entityType: "CARD",
      entityId: cardId,
      userId: viewer.userId,
      diff: {
        before: { revealSectionId: card.revealSectionId },
        after: { revealSectionId: section.id },
      },
      revealIndex: Math.max(card.revealIndex, section.position),
    });

    const raised = section.position > card.revealIndex;
    if (raised) {
      // Every CardField mutation gets a revision — including cascade raises.
      const affectedFields = await tx.cardField.findMany({
        where: { cardId, deletedAt: null, revealIndex: { lt: section.position } },
        select: { id: true, revealSectionId: true },
      });
      await tx.cardField.updateMany({
        where: { cardId, deletedAt: null, revealIndex: { lt: section.position } },
        data: { revealSectionId: section.id, revealIndex: section.position },
      });
      for (const f of affectedFields) {
        await writeRevision(tx, {
          entityType: "CARD_FIELD",
          entityId: f.id,
          userId: viewer.userId,
          diff: {
            before: { revealSectionId: f.revealSectionId },
            after: { revealSectionId: section.id },
          },
          revealIndex: section.position,
        });
      }
      // Relations are outside Revision's scope (spec: Card and CardField only).
      await tx.cardRelation.updateMany({
        where: {
          OR: [{ fromCardId: cardId }, { toCardId: cardId }],
          deletedAt: null,
          revealIndex: { lt: section.position },
        },
        data: { revealSectionId: section.id, revealIndex: section.position },
      });
    }
  });
}

export async function setCardField(
  viewer: Viewer,
  cardId: string,
  templateFieldId: string,
  input: { value: unknown; revealSectionId?: string },
): Promise<void> {
  requireEditor(viewer.role);
  await prisma.$transaction(async (tx) => {
    const card = await tx.card.findFirst({
      where: { id: cardId, seriesId: viewer.seriesId, deletedAt: null },
      select: { id: true, revealSectionId: true, revealIndex: true },
    });
    if (!card) throw new NotFoundError("Card not found");
    const tf = await tx.templateField.findFirst({
      where: { id: templateFieldId, deletedAt: null, template: { seriesId: viewer.seriesId } },
    });
    if (!tf) throw new NotFoundError("Template field not found");
    const value = validateFieldValue(
      tf.fieldType,
      tf.options as { choices?: string[] } | null,
      input.value,
    ) as Prisma.InputJsonValue;

    const existing = await tx.cardField.findFirst({
      where: { cardId, templateFieldId, deletedAt: null },
    });
    if (existing) {
      const section = input.revealSectionId
        ? await requireSection(tx, viewer.seriesId, input.revealSectionId)
        : { id: existing.revealSectionId, position: existing.revealIndex };
      await tx.cardField.update({
        where: { id: existing.id },
        data: { value, revealSectionId: section.id, revealIndex: section.position },
      });
      await writeRevision(tx, {
        entityType: "CARD_FIELD",
        entityId: existing.id,
        userId: viewer.userId,
        diff: { before: { value: existing.value }, after: { value } } as Prisma.InputJsonValue,
        revealIndex: Math.max(existing.revealIndex, section.position),
      });
    } else {
      const section = input.revealSectionId
        ? await requireSection(tx, viewer.seriesId, input.revealSectionId)
        : tf.defaultRevealBehavior === "SERIES_START"
          ? ((await seriesFirstSection(tx, viewer.seriesId)) ?? {
              id: card.revealSectionId,
              position: card.revealIndex,
            })
          : { id: card.revealSectionId, position: card.revealIndex };
      const created = await tx.cardField.create({
        data: {
          cardId,
          templateFieldId,
          value,
          revealSectionId: section.id,
          revealIndex: section.position,
        },
      });
      await writeRevision(tx, {
        entityType: "CARD_FIELD",
        entityId: created.id,
        userId: viewer.userId,
        diff: { after: { value } },
        revealIndex: created.revealIndex,
      });
    }
  });
}

/** Clearing a field's value = soft-deleting the CardField row (revisioned). */
export async function clearCardField(
  viewer: Viewer,
  cardId: string,
  templateFieldId: string,
): Promise<void> {
  requireEditor(viewer.role);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.cardField.findFirst({
      where: {
        cardId,
        templateFieldId,
        deletedAt: null,
        card: { seriesId: viewer.seriesId },
      },
      select: { id: true, revealIndex: true },
    });
    if (!existing) return;
    await tx.cardField.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    await writeRevision(tx, {
      entityType: "CARD_FIELD",
      entityId: existing.id,
      userId: viewer.userId,
      diff: { after: { deleted: true } },
      revealIndex: existing.revealIndex,
    });
  });
}

export async function softDeleteCard(viewer: Viewer, cardId: string): Promise<void> {
  requireEditor(viewer.role);
  await prisma.$transaction(async (tx) => {
    const card = await tx.card.findFirst({
      where: { id: cardId, seriesId: viewer.seriesId, deletedAt: null },
    });
    if (!card) throw new NotFoundError("Card not found");
    await tx.card.update({ where: { id: cardId }, data: { deletedAt: new Date() } });
    await writeRevision(tx, {
      entityType: "CARD",
      entityId: cardId,
      userId: viewer.userId,
      diff: { after: { deleted: true } },
      revealIndex: card.revealIndex,
    });
  });
}

export async function restoreCard(viewer: Viewer, cardId: string): Promise<void> {
  requireEditor(viewer.role);
  await prisma.$transaction(async (tx) => {
    const card = await tx.card.findFirst({
      where: { id: cardId, seriesId: viewer.seriesId, deletedAt: { not: null } },
    });
    if (!card) throw new NotFoundError("Deleted card not found");
    await tx.card.update({ where: { id: cardId }, data: { deletedAt: null } });
    await writeRevision(tx, {
      entityType: "CARD",
      entityId: cardId,
      userId: viewer.userId,
      diff: { after: { deleted: false } },
      revealIndex: card.revealIndex,
    });
  });
}

/** Deleted (restorable) cards — spoiler-peek editors only, for the restore UI. */
export async function listDeletedCards(
  viewer: Viewer,
): Promise<Array<{ id: string; title: string; type: CardType; deletedAt: Date }>> {
  requireEditor(viewer.role);
  if (!viewer.peek) return [];
  const cards = await prisma.card.findMany({
    where: { seriesId: viewer.seriesId, deletedAt: { not: null } },
    select: { id: true, title: true, type: true, deletedAt: true },
    orderBy: { deletedAt: "desc" },
  });
  return cards.flatMap((c) =>
    c.deletedAt === null ? [] : [{ id: c.id, title: c.title, type: c.type, deletedAt: c.deletedAt }],
  );
}
