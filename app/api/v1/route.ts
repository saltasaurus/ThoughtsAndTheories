import { json } from "@/lib/api";

/**
 * Unauthenticated discovery document. Deliberately lists only route shapes —
 * no series ids, no titles — so it discloses nothing about this instance.
 */
export function GET() {
  return json({
    version: "v1",
    auth: "Authorization: Bearer <token> — create one in a series' settings page",
    notes:
      "Responses are gated exactly as the web UI is: gated cards appear in lists as { id, locked: true } and are absent from search, graph and detail. Tokens never carry spoiler peek.",
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
