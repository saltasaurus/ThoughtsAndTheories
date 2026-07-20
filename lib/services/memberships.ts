import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { requireOwner } from "@/lib/permissions";
import type { Viewer } from "@/lib/visibility";

/**
 * Progress is a claim about what a member has read. Only the member sets it;
 * an OWNER may only LOWER someone else's (never raise).
 */
export async function setOwnProgress(
  userId: string,
  seriesId: string,
  sectionId: string | null,
): Promise<void> {
  const membership = await prisma.membership.findUnique({
    where: { userId_seriesId: { userId, seriesId } },
  });
  if (!membership) throw new NotFoundError("Not a member of this series");
  if (sectionId === null) {
    await prisma.membership.update({
      where: { id: membership.id },
      data: { currentSectionId: null, revealIndex: 0 },
    });
    return;
  }
  const section = await prisma.section.findFirst({
    where: { id: sectionId, book: { seriesId }, deletedAt: null },
    select: { id: true, position: true },
  });
  if (!section) throw new NotFoundError("Section not found in this series");
  await prisma.membership.update({
    where: { id: membership.id },
    data: { currentSectionId: section.id, revealIndex: section.position },
  });
}

export async function lowerMemberProgress(
  viewer: Viewer,
  targetUserId: string,
  sectionId: string | null,
): Promise<void> {
  requireOwner(viewer.role);
  const membership = await prisma.membership.findUnique({
    where: { userId_seriesId: { userId: targetUserId, seriesId: viewer.seriesId } },
  });
  if (!membership) throw new NotFoundError("Member not found");
  const newIndex =
    sectionId === null
      ? 0
      : (
          await prisma.section.findFirst({
            where: { id: sectionId, book: { seriesId: viewer.seriesId }, deletedAt: null },
            select: { position: true },
          })
        )?.position;
  if (newIndex === undefined) throw new NotFoundError("Section not found in this series");
  if (newIndex >= membership.revealIndex) {
    // Silent no-op, NOT an error: a distinguishable failure here is a
    // comparison oracle — an owner could binary-search a member's exact
    // position, which the spec forbids disclosing. Only lowering ever applies.
    return;
  }
  await prisma.membership.update({
    where: { id: membership.id },
    data: { currentSectionId: sectionId, revealIndex: newIndex },
  });
}

export type MemberRosterEntry = {
  userId: string;
  name: string;
  role: Role;
  /** vs the active session goal; null when no session is active */
  state: "behind" | "at_goal" | "ahead" | null;
};

/**
 * Roster shows STATE only — never another member's exact position, which is
 * their business. The viewer's own revealIndex comes from their Viewer context.
 */
export async function listMembers(viewer: Viewer): Promise<MemberRosterEntry[]> {
  const [members, active] = await Promise.all([
    prisma.membership.findMany({
      where: { seriesId: viewer.seriesId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.clubSession.findFirst({
      where: { seriesId: viewer.seriesId, status: "ACTIVE", deletedAt: null },
      select: { goalRevealIndex: true },
    }),
  ]);
  return members.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    role: m.role,
    state: active
      ? m.revealIndex < active.goalRevealIndex
        ? "behind"
        : m.revealIndex === active.goalRevealIndex
          ? "at_goal"
          : "ahead"
      : null,
  }));
}
