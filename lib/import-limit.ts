/**
 * Series-import body ceiling. Generous for a JSON series export, far below what
 * OOMs a 1-2 GB VPS. Lives here (not in the route) so a test can reach it
 * without dragging Next's server runtime into the vitest environment.
 */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/**
 * Deny by default. A missing or unparseable Content-Length (e.g.
 * Transfer-Encoding: chunked) is refused, not waved through — `null > CAP` is
 * false and would restore the unbounded buffering this guards. Content-Length
 * is client-supplied: a cheap fast-path rejection, not a guarantee.
 */
export function withinImportLimit(contentLength: string | null): boolean {
  const declared = Number(contentLength);
  return Number.isFinite(declared) && declared > 0 && declared <= MAX_IMPORT_BYTES;
}
