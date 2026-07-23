import { headers } from "next/headers";
import { TooManyRequestsError } from "@/lib/errors";

/**
 * Fixed-window rate limiter held in process memory.
 *
 * ponytail: in-memory, single-instance. A self-hosted TheoryTracker runs one
 * app container behind Caddy, so a shared store would be infrastructure with no
 * buyer today. The ceiling is explicit: counters reset on restart and are NOT
 * shared between replicas. If you ever run more than one, move `buckets` to
 * Redis or a Postgres table — no call site changes.
 *
 * This exists because bcrypt is deliberately expensive: an unauthenticated
 * login flood is both a credential-stuffing attempt and a CPU-exhaustion DoS.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

/** Drop expired buckets occasionally so the Map cannot grow without bound. */
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Throws TooManyRequestsError (429) once `limit` is exceeded within the window. */
export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new TooManyRequestsError(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
  }
}

/** Test seam — the limiter is module state, so suites must be able to reset it. */
export function resetRateLimits(): void {
  buckets.clear();
  lastSweep = 0;
}

/**
 * The client address to bucket on.
 *
 * Caddy APPENDS the peer it actually observed to X-Forwarded-For, so the LAST
 * entry is the one a client cannot forge. Reading the FIRST entry — the usual
 * mistake — would let anyone send `X-Forwarded-For: <random>` and get a fresh
 * bucket per request, which is worse than no limiter at all because it looks
 * like protection.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",");
    const peer = hops[hops.length - 1]?.trim();
    if (peer) return peer;
  }
  return h.get("x-real-ip")?.trim() ?? "local";
}

/** Same rule, for Route Handlers, which get the Request rather than headers(). */
export function clientIpFrom(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",");
    const peer = hops[hops.length - 1]?.trim();
    if (peer) return peer;
  }
  return request.headers.get("x-real-ip")?.trim() ?? "local";
}

/**
 * Shared budgets. Tuned for a book club, not a public API product: generous
 * enough that a real member never notices, tight enough that online guessing
 * against bcrypt is pointless.
 */
export const LIMITS = {
  /** per IP — credential stuffing and CPU exhaustion */
  login: { limit: 10, windowMs: 5 * 60_000 },
  /** per email — stops one account being targeted from many addresses */
  loginPerAccount: { limit: 10, windowMs: 15 * 60_000 },
  /** per IP — account creation is invite-gated, but bcrypt still runs */
  register: { limit: 5, windowMs: 60 * 60_000 },
  /** per IP — invite codes are 144 bits, but should not serve a guessing oracle */
  invite: { limit: 30, windowMs: 60 * 60_000 },
  /** per IP — the REST API; each call is a DB round trip */
  api: { limit: 120, windowMs: 60_000 },
  /** per IP — series import parses a whole JSON file into memory; keep it rare */
  import: { limit: 10, windowMs: 60 * 60_000 },
} as const;
