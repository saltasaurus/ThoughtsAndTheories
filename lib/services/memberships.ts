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
};

/**
 * Roster shows identity and role only — never a member's position, and never a
 * comparison against one.
 *
 * A per-member "behind / at goal / ahead" badge used to live here. It was a
 * single comparison of a NAMED member against the active session's goal, which
 * reads as harmless — but an EDITOR may retarget that goal freely, so repeating
 * the observation binary-searches anyone's exact position in ~log2(sections)
 * reloads. Granularity was never the issue: ANY per-name comparison against a
 * movable threshold is searchable, so coarsening the badge would have fixed
 * nothing. Removing the name/threshold pairing is what closes it — and it is
 * what keeps session goals freely movable, which is the more useful capability.
 *
 * Pacing is still reported, in aggregate, by getRosterAnalytics below.
 */
export async function listMembers(viewer: Viewer): Promise<MemberRosterEntry[]> {
  const members = await prisma.membership.findMany({
    where: { seriesId: viewer.seriesId },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    role: m.role,
  }));
}

export type RosterAnalytics = {
  totalMembers: number;
  /** null when no session is active — there is no goal to measure against */
  goalRevealIndex: number | null;
  counts: { behind: number; at_goal: number; ahead: number };
};

/**
 * Aggregate pacing against the ACTIVE session's goal — counts only.
 *
 * Deliberately returns no userId and no revealIndex: pairing a member with a
 * position is exactly what the roster rule forbids. There is also no
 * per-past-session breakdown, because memberships are not revisioned — the only
 * position data that exists is the current one, and scoring it against old
 * goals would manufacture a monotone "everyone drifts ahead" artifact rather
 * than history.
 */
export async function getRosterAnalytics(viewer: Viewer): Promise<RosterAnalytics> {
  const [members, active] = await Promise.all([
    prisma.membership.findMany({
      where: { seriesId: viewer.seriesId },
      select: { revealIndex: true },
    }),
    prisma.clubSession.findFirst({
      where: { seriesId: viewer.seriesId, status: "ACTIVE", deletedAt: null },
      select: { goalRevealIndex: true },
    }),
  ]);

  const counts = { behind: 0, at_goal: 0, ahead: 0 };
  if (active) {
    for (const m of members) {
      if (m.revealIndex < active.goalRevealIndex) counts.behind++;
      else if (m.revealIndex === active.goalRevealIndex) counts.at_goal++;
      else counts.ahead++;
    }
  }
  return {
    totalMembers: members.length,
    goalRevealIndex: active?.goalRevealIndex ?? null,
    counts,
  };
}
