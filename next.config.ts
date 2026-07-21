import type { NextConfig } from "next";

/**
 * Content-Security-Policy.
 *
 * `script-src` needs 'unsafe-inline'; 'unsafe-eval' is deliberately absent.
 * Next's App Router inlines a bootstrap script per response, and the strict
 * alternative is a per-request nonce, which requires middleware — which this
 * app deliberately does not have (PHASES.md deviation 8: middleware would drag
 * Prisma into the edge runtime). So the honest ceiling is: CSP here does not
 * block XSS via inline script. What blocks it is React escaping output and
 * every user-supplied value being escaped text or Zod-validated JSON.
 *
 * `img-src` allows https: because IMAGE_URL card fields render remote images by
 * design. `frame-ancestors 'none'` is the clickjacking control that actually
 * matters, and `form-action 'self'` stops an injected form POSTing a session
 * cookie somewhere else.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // standalone output so the prod Docker image ships only what `next start` needs
  output: "standalone",

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // URLs here carry series ids and ?error= text; never send them to a
          // third-party origin (remote IMAGE_URL images would otherwise leak
          // the referring page).
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          // Inert over plain HTTP in dev; Caddy terminates TLS in prod.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
      {
        // Nothing under the API should be cached by a shared proxy: every
        // response is gated to one viewer's reading position.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
