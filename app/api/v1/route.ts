import { NextResponse } from "next/server";

/**
 * TODO (Phase 3): versioned REST API with token auth, gated identically to the
 * UI through lib/visibility.ts. Scaffolded honestly: it answers, but with 501.
 */
export function GET(): NextResponse {
  return NextResponse.json(
    { error: "The v1 REST API ships in Phase 3." },
    { status: 501 },
  );
}
