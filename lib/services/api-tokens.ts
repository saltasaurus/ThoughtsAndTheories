import { createHash, randomBytes } from "node:crypto";
import type { ApiTokenScope } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";

const PREFIX = "tt_";

/**
 * Carries a freshly minted token from the create action to the one render that
 * displays it. A cookie rather than a query parameter: a secret in the URL ends
 * up in browser history, referrer headers and access logs.
 */
export const NEW_TOKEN_COOKIE = "new-api-token";

/**
 * SHA-256, unsalted and deliberately fast.
 *
 * bcrypt is right for passwords because the email is the lookup key and the
 * secret is low-entropy. A bearer token has neither property: there is no
 * lookup key but the token itself, and a salted hash cannot be queried — it
 * would force a full-table compare on every API request. The token is 256 bits
 * of CSPRNG output, so there is no dictionary to grind and no salt to earn.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The plaintext token — returned to the user exactly once, never stored. */
export function mintToken(): string {
  return PREFIX + randomBytes(32).toString("base64url");
}

export type NewApiToken = { id: string; label: string; token: string };

/**
 * Tokens are scoped to the USER, not a series: a token carries exactly the
 * memberships its owner already has, so it can never reach a series its owner
 * could not open in the UI. Any member may mint one for themselves.
 *
 * Scope defaults to READ — most consumers of a wiki only read, and a leaked
 * read token cannot rewrite anyone's series. Expiry is optional but encouraged;
 * a token with no expiry lives until it is revoked by hand.
 */
export async function createApiToken(
  userId: string,
  label: string,
  opts: { scope?: ApiTokenScope; expiresAt?: Date | null } = {},
): Promise<NewApiToken> {
  const token = mintToken();
  const row = await prisma.apiToken.create({
    data: {
      userId,
      label,
      tokenHash: hashToken(token),
      scope: opts.scope ?? "READ",
      expiresAt: opts.expiresAt ?? null,
    },
    select: { id: true, label: true },
  });
  return { id: row.id, label: row.label, token };
}

export async function revokeApiToken(userId: string, tokenId: string): Promise<void> {
  // Scoped to the owner: one user may never revoke another's token.
  const token = await prisma.apiToken.findFirst({
    where: { id: tokenId, userId, revokedAt: null },
    select: { id: true },
  });
  if (!token) throw new NotFoundError("Token not found");
  await prisma.apiToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
}

export type ApiTokenView = {
  id: string;
  label: string;
  scope: ApiTokenScope;
  expiresAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

/** Never returns tokenHash — no path reveals a token after creation. */
export async function listApiTokens(userId: string): Promise<ApiTokenView[]> {
  return prisma.apiToken.findMany({
    where: { userId },
    select: {
      id: true,
      label: true,
      scope: true,
      expiresAt: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}
