"use server";

import { cookies } from "next/headers";
import { optStr, runAndRedirect, str } from "@/lib/action-run";
import { PEEK_COOKIE, getRequestViewer, requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { lowerMemberProgress, setOwnProgress } from "@/lib/services/memberships";

function backTo(formData: FormData, seriesId: string): string {
  return optStr(formData, "returnTo") ?? `/series/${seriesId}/cards`;
}

export async function setProgressAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const user = await requireUser();
  await runAndRedirect(backTo(formData, seriesId), () =>
    setOwnProgress(user.id, seriesId, optStr(formData, "sectionId") ?? null),
  );
}

/** One-click "jump to session goal". */
export async function jumpToGoalAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const user = await requireUser();
  await runAndRedirect(backTo(formData, seriesId), async () => {
    const active = await prisma.clubSession.findFirst({
      where: { seriesId, status: "ACTIVE", deletedAt: null },
      select: { goalSectionId: true },
    });
    if (!active) throw new NotFoundError("No active session");
    await setOwnProgress(user.id, seriesId, active.goalSectionId);
  });
}

/**
 * Spoiler peek toggle — OWNER/EDITOR only. READER requests are rejected, and
 * the reader UI never renders the toggle.
 */
export async function togglePeekAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const user = await requireUser();
  const membership = await prisma.membership.findUnique({
    where: { userId_seriesId: { userId: user.id, seriesId } },
    select: { role: true },
  });
  await runAndRedirect(backTo(formData, seriesId), async () => {
    if (!membership || membership.role === "READER") {
      throw new ForbiddenError("Spoiler peek is not available to readers");
    }
    const jar = await cookies();
    const on = jar.get(PEEK_COOKIE)?.value === "1";
    jar.set(PEEK_COOKIE, on ? "0" : "1", { path: "/", httpOnly: true, sameSite: "lax" });
  });
}

/** OWNER may LOWER another member's progress — never raise it. */
export async function lowerMemberAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const viewer = await getRequestViewer(seriesId);
  await runAndRedirect(`/series/${seriesId}/settings`, () =>
    lowerMemberProgress(viewer, str(formData, "userId"), optStr(formData, "sectionId") ?? null),
  );
}
