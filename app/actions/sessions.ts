"use server";

import { optStr, parseOr400, runAndRedirect, str } from "@/lib/action-run";
import { getRequestViewer } from "@/lib/auth-helpers";
import { AppError } from "@/lib/errors";
import { sessionSchema } from "@/lib/schemas";
import { createSession, softDeleteSession, updateSession } from "@/lib/services/sessions";

function parseNotes(formData: FormData): unknown {
  const raw = optStr(formData, "notes");
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AppError("Invalid notes payload");
  }
}

export async function createSessionAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const viewer = await getRequestViewer(seriesId);
  const returnTo = `/series/${seriesId}/sessions`;
  await runAndRedirect(returnTo, async () => {
    const input = parseOr400(sessionSchema, {
      title: str(formData, "title"),
      scheduledAt: optStr(formData, "scheduledAt") ?? null,
      goalSectionId: str(formData, "goalSectionId"),
      notes: parseNotes(formData),
      status: str(formData, "status") || "UPCOMING",
    });
    await createSession(viewer, input);
  });
}

export async function setSessionStatusAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const viewer = await getRequestViewer(seriesId);
  const returnTo = `/series/${seriesId}/sessions`;
  await runAndRedirect(returnTo, async () => {
    const status = str(formData, "status");
    if (status !== "UPCOMING" && status !== "ACTIVE" && status !== "COMPLETED") {
      throw new AppError("Unknown status");
    }
    await updateSession(viewer, str(formData, "sessionId"), { status });
  });
}

/**
 * Retarget an existing session's goal. Safe to expose because the roster no
 * longer pairs a member's name with a comparison against this value — see
 * PHASES.md deviation 28. Before that change, a freely movable goal plus a
 * per-name badge was a binary search for anyone's reading position.
 */
export async function updateSessionGoalAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const viewer = await getRequestViewer(seriesId);
  await runAndRedirect(`/series/${seriesId}/sessions`, async () => {
    const goalSectionId = optStr(formData, "goalSectionId");
    // updateSession truthy-checks the goal, so an empty value would silently
    // no-op rather than tell the user nothing happened.
    if (!goalSectionId) throw new AppError("Choose a goal section");
    await updateSession(viewer, str(formData, "sessionId"), { goalSectionId });
  });
}

export async function deleteSessionAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const viewer = await getRequestViewer(seriesId);
  await runAndRedirect(`/series/${seriesId}/sessions`, () =>
    softDeleteSession(viewer, str(formData, "sessionId")),
  );
}
