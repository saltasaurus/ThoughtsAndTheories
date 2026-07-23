import { json } from "@/lib/api";
import { LIMITS, clientIpFrom, rateLimit } from "@/lib/rate-limit";

/**
 * Unauthenticated discovery document. Deliberately lists only route shapes —
 * no series ids, no titles — so it discloses nothing about this instance.
 *
 * Every other v1 route inherits throttle() via getApiContext; this bare GET
 * never calls it, so it must rate-limit itself or it is the one unmetered,
 * no-store, unauthenticated route on every public instance.
 */
export function GET(request: Request) {
  rateLimit(`api:ip:${clientIpFrom(request)}`, LIMITS.api.limit, LIMITS.api.windowMs);
  return json({
    version: "v1",
    auth: "Authorization: Bearer <token> — create one in a series' settings page",
    scopes: {
      READ: "every GET below",
      WRITE: "required for POST/PATCH/PUT; a READ token is refused with 403 even for an owner",
      note: "tokens default to READ, may carry an expiry, and never grant spoiler peek",
    },
    gating:
      "Responses are gated exactly as the web UI is, by calling the same functions: gated cards appear in lists as { id, locked: true } and are absent from search, graph and detail. A gated card, a missing card and another series' card are all an identical 404.",
    limits: `${LIMITS.api.limit} requests per ${LIMITS.api.windowMs / 1000}s per client address; exceeding it returns 429.`,
    coverage:
      "A partial mirror of the web UI, deliberately. Reads cover cards, card detail, graph, timeline and search; writes cover card create/update/set-field. Relations, timeline entries, structure, templates, calendar, revisions and soft-delete/restore are UI-only for now.",
    endpoints: [
      { method: "GET", path: "/api/v1/series/{seriesId}/cards", query: "type, cursor, pageSize" },
      { method: "POST", path: "/api/v1/series/{seriesId}/cards" },
      { method: "GET", path: "/api/v1/series/{seriesId}/cards/{cardId}" },
      { method: "PATCH", path: "/api/v1/series/{seriesId}/cards/{cardId}" },
      { method: "PUT", path: "/api/v1/series/{seriesId}/cards/{cardId}", body: "set one field" },
      { method: "GET", path: "/api/v1/series/{seriesId}/graph", query: "type, nodeLimit" },
      {
        method: "GET",
        path: "/api/v1/series/{seriesId}/timeline",
        query: "maxRevealIndex, cursor, pageSize",
      },
      { method: "GET", path: "/api/v1/series/{seriesId}/search", query: "q, cursor, pageSize" },
    ],
  });
}
