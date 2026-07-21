/**
 * Production-readiness behaviour: throttling, the import size ceiling, and the
 * health probe. These are the properties that only start to matter once the app
 * is reachable from the internet.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { GET as healthGET } from "@/app/api/health/route";
import { GET as cardsGET } from "@/app/api/v1/series/[seriesId]/cards/route";
import { prisma } from "@/lib/db";
import { TooManyRequestsError } from "@/lib/errors";
import { LIMITS, clientIpFrom, rateLimit, resetRateLimits } from "@/lib/rate-limit";
import { createApiToken } from "@/lib/services/api-tokens";
import { exportSeries, importSeries, parseSeriesExport } from "@/lib/services/export-import";
import { getViewer } from "@/lib/visibility";
import { createFixture, createUser } from "@/tests/fixture";

beforeEach(() => {
  resetRateLimits();
});

describe("rate limiter", () => {
  it("allows up to the limit, then throws 429", () => {
    for (let i = 0; i < 5; i++) rateLimit("k", 5, 60_000);
    expect(() => rateLimit("k", 5, 60_000)).toThrowError(TooManyRequestsError);
  });

  it("keys are independent — one caller cannot exhaust another's budget", () => {
    for (let i = 0; i < 5; i++) rateLimit("a", 5, 60_000);
    expect(() => rateLimit("b", 5, 60_000)).not.toThrow();
  });

  it("reports a positive retry-after and a 429 status", () => {
    rateLimit("k", 1, 60_000);
    try {
      rateLimit("k", 1, 60_000);
      throw new Error("expected a 429");
    } catch (e) {
      expect(e).toBeInstanceOf(TooManyRequestsError);
      expect((e as TooManyRequestsError).status).toBe(429);
      expect((e as TooManyRequestsError).retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("lets the window expire", async () => {
    rateLimit("k", 1, 1); // 1ms window
    await new Promise((r) => setTimeout(r, 10));
    expect(() => rateLimit("k", 1, 1)).not.toThrow();
  });

  /**
   * The bit that is easy to get backwards. Caddy APPENDS the peer it actually
   * saw, so the LAST hop is trustworthy and the first is whatever the client
   * sent. If this ever reads the first entry, the limiter becomes decorative:
   * a fresh bucket per request for anyone who sets the header.
   */
  it("takes the LAST X-Forwarded-For hop, which a client cannot forge", () => {
    const spoofed = new Request("http://x/", {
      headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" },
    });
    expect(clientIpFrom(spoofed)).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip, then to a constant", () => {
    expect(clientIpFrom(new Request("http://x/", { headers: { "x-real-ip": "9.9.9.9" } }))).toBe(
      "9.9.9.9",
    );
    expect(clientIpFrom(new Request("http://x/"))).toBe("local");
  });

  it("throttles the v1 API and reports 429 as JSON, not a crash", async () => {
    const f = await createFixture();
    const { token } = await createApiToken(f.owner.id, "throttled");
    const call = () =>
      cardsGET(
        new Request(`http://localhost/api/v1/series/${f.seriesId}/cards`, {
          headers: { authorization: `Bearer ${token}`, "x-forwarded-for": "198.51.100.7" },
        }),
        { params: Promise.resolve({ seriesId: f.seriesId }) },
      );

    for (let i = 0; i < LIMITS.api.limit; i++) {
      expect((await call()).status).toBe(200);
    }
    const blocked = await call();
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toMatch(/too many/i);
  });
});

describe("import ceiling", () => {
  /**
   * Import moved from a Server Action to a route handler because actions cap
   * the body at 1 MB by default, which rejected exports this very app produces.
   * Rather than assert a framework constant, this proves the export/import pair
   * handles a payload comfortably past that line.
   */
  it("round-trips an export larger than the 1 MB Server Action body limit", async () => {
    const f = await createFixture();
    const owner = await getViewer(f.owner.id, f.seriesId);
    const section = f.sections[0]!;
    const filler = "x".repeat(2000);

    await prisma.card.createMany({
      data: Array.from({ length: 800 }, (_, i) => ({
        seriesId: f.seriesId,
        type: "CONCEPT" as const,
        title: `Bulk ${i}`,
        summary: filler,
        revealSectionId: section.id,
        revealIndex: section.position,
        createdById: f.owner.id,
      })),
    });

    const file = await exportSeries(owner);
    expect(Buffer.byteLength(JSON.stringify(file), "utf8")).toBeGreaterThan(1_000_000);

    const importer = await createUser("big-importer");
    const parsed = parseSeriesExport(JSON.parse(JSON.stringify(file)));
    const newSeriesId = await importSeries(importer.id, parsed);

    expect(await prisma.card.count({ where: { seriesId: newSeriesId } })).toBe(
      await prisma.card.count({ where: { seriesId: f.seriesId } }),
    );
  });
});

describe("health probe", () => {
  it("reports ok and discloses nothing else", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    // no version, no row counts, no migration state — it is always exposed
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
