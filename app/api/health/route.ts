import { prisma } from "@/lib/db";

/**
 * Liveness + readiness for self-hosting: Docker healthchecks, reverse-proxy
 * upstream checks, and uptime monitors.
 *
 * Deliberately unauthenticated and deliberately mute — it reports whether the
 * database answers, and nothing else. No version, no migration state, no row
 * counts: a health endpoint is the one thing guaranteed to be exposed, so it
 * must not become a reconnaissance surface.
 */
export async function GET(): Promise<Response> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
