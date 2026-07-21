"use server";

import { optInt, optStr, parseOr400, runAndRedirect, str } from "@/lib/action-run";
import { getRequestViewer, requireUser } from "@/lib/auth-helpers";
import { LIMITS, clientIp, rateLimit } from "@/lib/rate-limit";
import { inviteSchema } from "@/lib/schemas";
import { createInvite, redeemInvite, revokeInvite } from "@/lib/services/invites";

export async function createInviteAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const viewer = await getRequestViewer(seriesId);
  const returnTo = `/series/${seriesId}/settings`;
  await runAndRedirect(returnTo, async () => {
    const input = parseOr400(inviteSchema, {
      role: str(formData, "role"),
      expiresAt: optStr(formData, "expiresAt") ?? null,
      maxUses: optInt(formData, "maxUses") ?? null,
    });
    await createInvite(viewer, input);
  });
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const seriesId = str(formData, "seriesId");
  const viewer = await getRequestViewer(seriesId);
  await runAndRedirect(`/series/${seriesId}/settings`, () =>
    revokeInvite(viewer, str(formData, "inviteId")),
  );
}

/** Logged-in join via /join/<code> — consumes one invite use. */
export async function joinInviteAction(formData: FormData): Promise<void> {
  const code = str(formData, "code");
  const user = await requireUser();
  await runAndRedirect(`/join/${code}`, async () => {
    // Codes are 144 bits of randomBytes, so guessing is hopeless — but an
    // unthrottled redemption endpoint is still a free existence oracle and a
    // free database round trip per request.
    rateLimit(`invite:ip:${await clientIp()}`, LIMITS.invite.limit, LIMITS.invite.windowMs);
    const { seriesId } = await redeemInvite(code, user.id);
    return `/series/${seriesId}`;
  });
}
