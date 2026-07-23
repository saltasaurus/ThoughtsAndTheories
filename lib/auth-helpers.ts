import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { getViewer, type Viewer } from "@/lib/visibility";

export type SessionUser = { id: string; name: string; email: string };

// localhost forms; IPv6 hostname comes back bracketed from new URL().hostname.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * AUTH_URL models EXPOSURE, not build mode. next-auth rewrites every callback to
 * it (next-auth/lib/env.js), so "AUTH_URL is localhost" and "this instance works
 * for remote users" are mutually exclusive states the framework itself enforces.
 * Deny by default: unset AUTH_URL lets Auth.js infer the origin from any host, so
 * it counts as exposed; an unparseable value falls to the fatal branch too.
 */
function authUrlIsLocalhost(): boolean {
  const url = process.env.AUTH_URL;
  if (!url) return false;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Refuse to serve with the published dev signing key once exposed — otherwise
 * every clone can forge a session for any user. Request-time and function-scoped
 * on purpose: unreachable from the build graph, so `next build` still runs with
 * no secret. Do NOT gate on NODE_ENV (0.4 records why two attempts to do so
 * were wrong). Ceiling: `next dev -H 0.0.0.0` on a LAN with a localhost AUTH_URL stays
 * silent — a LAN is not the internet. The log is explicit because Next redacts
 * the thrown message in production to "Something went wrong".
 */
function assertRealSecret(): void {
  if (process.env.AUTH_SECRET === "dev-only-do-not-deploy" && !authUrlIsLocalhost()) {
    console.error(
      "FATAL: AUTH_SECRET is the published dev default but AUTH_URL is not " +
        "localhost. This instance is exposed with a forgeable session key. " +
        "Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
    throw new Error("Refusing to run with the dev AUTH_SECRET on a non-localhost AUTH_URL");
  }
}

/** Server-side auth guard: every page and action goes through this or getRequestViewer. */
export async function requireUser(): Promise<SessionUser> {
  assertRealSecret();
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  // A JWT can outlive its user (a purged account, or a dev DB reset). Verify the
  // row still exists so a ghost session bounces to /login instead of failing a
  // foreign-key check deep inside a mutation. /login re-issues a fresh cookie.
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true },
  });
  if (!user) redirect("/login");
  return { id: user.id, name: user.name ?? "", email: user.email ?? "" };
}

export const PEEK_COOKIE = "spoiler-peek";

/**
 * The spoiler-peek flag lives on the request context (a cookie) and is read
 * HERE, once — never plumbed through call sites. A READER carrying the flag is
 * rejected by getViewer, per spec.
 */
export async function getRequestViewer(seriesId: string): Promise<Viewer> {
  const user = await requireUser();
  const peek = (await cookies()).get(PEEK_COOKIE)?.value === "1";
  try {
    return await getViewer(user.id, seriesId, peek);
  } catch (e) {
    if (e instanceof NotFoundError) redirect("/"); // not a member of this series
    throw e;
  }
}
