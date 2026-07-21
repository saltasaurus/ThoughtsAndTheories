"use server";

import { cookies } from "next/headers";
import { optStr, parseOr400, runAndRedirect, str } from "@/lib/action-run";
import { requireUser } from "@/lib/auth-helpers";
import { apiTokenSchema } from "@/lib/schemas";
import { NEW_TOKEN_COOKIE, createApiToken, revokeApiToken } from "@/lib/services/api-tokens";

/** Tokens belong to the USER, but are managed from a series' settings page. */
export async function createTokenAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const seriesId = str(formData, "seriesId");
  await runAndRedirect(`/series/${seriesId}/settings`, async () => {
    const { label, scope, expiresAt } = parseOr400(apiTokenSchema, {
      label: str(formData, "label").trim(),
      scope: str(formData, "scope") || "READ",
      expiresAt: optStr(formData, "expiresAt") ?? null,
    });
    const created = await createApiToken(user.id, label, { scope, expiresAt });
    (await cookies()).set(NEW_TOKEN_COOKIE, created.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      // Scoped to the page that displays it: with path "/" the plaintext token
      // rides along on every request to the origin (including static assets)
      // and re-renders on every OTHER series' settings page too.
      path: `/series/${seriesId}/settings`,
      maxAge: 300, // shown once, then it is gone for good
    });
  });
}

export async function dismissTokenAction(formData: FormData): Promise<void> {
  await requireUser();
  const seriesId = str(formData, "seriesId");
  await runAndRedirect(`/series/${seriesId}/settings`, async () => {
    // Must match the path it was set with, or the delete silently misses.
    (await cookies()).delete({ name: NEW_TOKEN_COOKIE, path: `/series/${seriesId}/settings` });
  });
}

export async function revokeTokenAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const seriesId = str(formData, "seriesId");
  await runAndRedirect(`/series/${seriesId}/settings`, () =>
    revokeApiToken(user.id, str(formData, "tokenId")),
  );
}
