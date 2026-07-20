import { Prisma, type SessionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { requireEditor } from "@/lib/permissions";
import type { Viewer } from "@/lib/visibility";

function translateActiveConflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new ConflictError("Another session is already active for this series");
  }
  throw e;
}

export type SessionInput = {
  title: string;
  scheduledAt?: Date | null;
  goalSectionId: string;
  notes?: unknown;
  status: SessionStatus;
};

export async function createSession(viewer: Viewer, input: SessionInput): Promise<string> {
  requireEditor(viewer.role);
  const goal = await prisma.section.findFirst({
    where: { id: input.goalSectionId, book: { seriesId: viewer.seriesId }, deletedAt: null },
    select: { id: true, position: true },
  });
  if (!goal) throw new NotFoundError("Goal section not found in this series");
  try {
    const session = await prisma.clubSession.create({
      data: {
        seriesId: viewer.seriesId,
        title: input.title,
        scheduledAt: input.scheduledAt ?? null,
        goalSectionId: goal.id,
        goalRevealIndex: goal.position,
        notes: (input.notes ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        createdById: viewer.userId,
        status: input.status,
      },
    });
    return session.id;
  } catch (e) {
    translateActiveConflict(e);
  }
}

export async function updateSession(
  viewer: Viewer,
  sessionId: string,
  patch: Partial<SessionInput>,
): Promise<void> {
  requireEditor(viewer.role);
  const session = await prisma.clubSession.findFirst({
    where: { id: sessionId, seriesId: viewer.seriesId, deletedAt: null },
  });
  if (!session) throw new NotFoundError("Session not found");

  let goalPatch = {};
  if (patch.goalSectionId) {
    const goal = await prisma.section.findFirst({
      where: { id: patch.goalSectionId, book: { seriesId: viewer.seriesId }, deletedAt: null },
      select: { id: true, position: true },
    });
    if (!goal) throw new NotFoundError("Goal section not found in this series");
    goalPatch = { goalSectionId: goal.id, goalRevealIndex: goal.position };
  }
  try {
    await prisma.clubSession.update({
      where: { id: sessionId },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.scheduledAt !== undefined ? { scheduledAt: patch.scheduledAt } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.notes !== undefined
          ? { notes: patch.notes as Prisma.InputJsonValue }
          : {}),
        ...goalPatch,
      },
    });
  } catch (e) {
    translateActiveConflict(e);
  }
}

export async function softDeleteSession(viewer: Viewer, sessionId: string): Promise<void> {
  requireEditor(viewer.role);
  const session = await prisma.clubSession.findFirst({
    where: { id: sessionId, seriesId: viewer.seriesId, deletedAt: null },
  });
  if (!session) throw new NotFoundError("Session not found");
  await prisma.clubSession.update({ where: { id: sessionId }, data: { deletedAt: new Date() } });
}

export async function restoreSession(viewer: Viewer, sessionId: string): Promise<void> {
  requireEditor(viewer.role);
  const session = await prisma.clubSession.findFirst({
    where: { id: sessionId, seriesId: viewer.seriesId, deletedAt: { not: null } },
  });
  if (!session) throw new NotFoundError("Deleted session not found");
  try {
    await prisma.clubSession.update({ where: { id: sessionId }, data: { deletedAt: null } });
  } catch (e) {
    translateActiveConflict(e);
  }
}
