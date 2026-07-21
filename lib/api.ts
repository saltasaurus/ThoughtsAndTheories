import { NextResponse } from "next/server";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
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
export async function getViewerFromToken(request: Request, seriesId: string): Promise<Viewer> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match?.[1]) throw new AppError("Missing bearer token", 401);

  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(match[1]) },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (!token || token.revokedAt !== null) throw new AppError("Invalid or revoked token", 401);

  await prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
  return getViewer(token.userId, seriesId, false);
}
