import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { requireEditor } from "@/lib/permissions";
import type { Viewer } from "@/lib/visibility";

export type RelationInput = {
  fromCardId: string;
  toCardId: string;
  type: string;
  weight: number;
  directed: boolean;
  notes?: string;
  revealSectionId: string;
};

export async function createRelation(viewer: Viewer, input: RelationInput): Promise<string> {
  requireEditor(viewer.role);
  if (input.fromCardId === input.toCardId) {
    throw new AppError("A relation cannot connect a card to itself");
  }
  return prisma.$transaction(async (tx) => {
    const endpoints = await tx.card.findMany({
      where: {
        id: { in: [input.fromCardId, input.toCardId] },
        seriesId: viewer.seriesId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (endpoints.length !== 2) throw new NotFoundError("Both cards must exist in this series");
    const section = await tx.section.findFirst({
      where: { id: input.revealSectionId, book: { seriesId: viewer.seriesId }, deletedAt: null },
      select: { id: true, position: true },
    });
    if (!section) throw new NotFoundError("Reveal section not found in this series");
    const relation = await tx.cardRelation.create({
      data: {
        fromCardId: input.fromCardId,
        toCardId: input.toCardId,
        type: input.type,
        weight: input.weight,
        directed: input.directed,
        notes: input.notes ?? null,
        revealSectionId: section.id,
        revealIndex: section.position,
      },
    });
    return relation.id;
  });
}

export async function updateRelation(
  viewer: Viewer,
  relationId: string,
  patch: { type?: string; weight?: number; directed?: boolean; notes?: string | null },
): Promise<void> {
  requireEditor(viewer.role);
  const relation = await prisma.cardRelation.findFirst({
    where: { id: relationId, deletedAt: null, fromCard: { seriesId: viewer.seriesId } },
  });
  if (!relation) throw new NotFoundError("Relation not found");
  await prisma.cardRelation.update({ where: { id: relationId }, data: patch });
}

export async function softDeleteRelation(viewer: Viewer, relationId: string): Promise<void> {
  requireEditor(viewer.role);
  const relation = await prisma.cardRelation.findFirst({
    where: { id: relationId, deletedAt: null, fromCard: { seriesId: viewer.seriesId } },
  });
  if (!relation) throw new NotFoundError("Relation not found");
  await prisma.cardRelation.update({ where: { id: relationId }, data: { deletedAt: new Date() } });
}

export async function restoreRelation(viewer: Viewer, relationId: string): Promise<void> {
  requireEditor(viewer.role);
  const relation = await prisma.cardRelation.findFirst({
    where: { id: relationId, deletedAt: { not: null }, fromCard: { seriesId: viewer.seriesId } },
  });
  if (!relation) throw new NotFoundError("Deleted relation not found");
  await prisma.cardRelation.update({ where: { id: relationId }, data: { deletedAt: null } });
}
