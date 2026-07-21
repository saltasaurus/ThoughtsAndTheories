import type { ApiTokenScope } from "@prisma/client";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { LIMITS, clientIpFrom, rateLimit } from "@/lib/rate-limit";
import { hashToken } from "@/lib/services/api-tokens";
import { getViewer, type Viewer } from "@/lib/visibility";

/**
 * JSON with BigInt support. TimelineEntry.absoluteSortKey is a BigInt and
 * JSON.stringify throws on it outright, so every API response goes through here.
 */
export function json(data: unknown, status = 200): NextResponse {
  const body = JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  return new NextResponse(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Next implements redirect() and notFound() by THROWING a tagged error. A
 * catch-all that swallows those turns a login bounce into a 500, so they are
 * re-thrown for the framework to handle.
 */
function isNextControlFlow(e: unknown): boolean {
  if (typeof e !== "object" || e === null || !("digest" in e)) return false;
  const digest = (e as { digest: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}

export function errorResponse(e: unknown): NextResponse {
  if (isNextControlFlow(e)) throw e;
  if (e instanceof AppError) return json({ error: e.message }, e.status);
  console.error("[api/v1]", e);
  return json({ error: "Internal error" }, 500);
}

/** Zod parse for query params / bodies, surfaced as a 400 rather than a throw. */
export function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AppError(issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid input", 400);
  }
  return result.data;
}

export function searchParams(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams);
}

/** Body parse that reports malformed JSON as a 400 instead of a 500. */
export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("Body must be valid JSON", 400);
  }
}

/**
 * Resolve a bearer token to the SAME Viewer type the cookie path produces.
 *
 * Deliberately does NOT mirror getRequestViewer's behaviour: that function
 * calls redirect(), which is meaningless to an API client. Instead:
 *   401 — missing, unknown, or revoked token
 *   404 — valid token whose user is not a member of this series (matching
 *         getViewer; a 403 would confirm the series exists)
 * Tokens never carry spoiler peek — no peek parameter exists in this surface.
 */
export type ApiContext = { viewer: Viewer; scope: ApiTokenScope };

/** Rate-limit budget shared by every /api/v1 route, keyed on the client address. */
function throttle(request: Request): void {
  rateLimit(`api:ip:${clientIpFrom(request)}`, LIMITS.api.limit, LIMITS.api.windowMs);
}

export async function getApiContext(request: Request, seriesId: string): Promise<ApiContext> {
  throttle(request);

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match?.[1]) throw new AppError("Missing bearer token", 401);

  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(match[1]) },
    select: {
      id: true,
      userId: true,
      scope: true,
      revokedAt: true,
      expiresAt: true,
      lastUsedAt: true,
    },
  });
  // One message for unknown, revoked and expired alike — distinguishing them
  // would confirm that a guessed token once existed.
  const now = new Date();
  if (!token || token.revokedAt !== null || (token.expiresAt !== null && token.expiresAt <= now)) {
    throw new AppError("Invalid, revoked or expired token", 401);
  }

  // lastUsedAt is a coarse "is this still in use?" signal, not an audit log.
  // Writing it on EVERY request put a row lock in the path of every read, so
  // concurrent calls sharing a token serialised on it. Hourly is plenty.
  if (token.lastUsedAt === null || now.getTime() - token.lastUsedAt.getTime() > 3_600_000) {
    await prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: now } });
  }

  return { viewer: await getViewer(token.userId, seriesId, false), scope: token.scope };
}

/** Read-only tokens may not reach a mutation, whatever the user's role allows. */
export function requireWriteScope(scope: ApiTokenScope): void {
  if (scope !== "WRITE") {
    throw new AppError("This token is read-only", 403);
  }
}

/** Reads only need the viewer; keeps the common case a one-liner. */
export async function getViewerFromToken(request: Request, seriesId: string): Promise<Viewer> {
  return (await getApiContext(request, seriesId)).viewer;
}
