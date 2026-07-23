# Contributing

Thanks for your interest. This is a solo-maintained project, so please open an
issue to discuss anything non-trivial before sending a large PR.

## The one rule that matters

**Gating logic lives only in `lib/visibility.ts`.** Every gated read composes the
`where` fragments built there. A PR that adds a *second* place where visibility
is decided — a filter in a service, a check in a component, a guard in a route —
is rejected however correct it looks, because the guarantee is "one mechanism, no
exceptions." If the gate needs to change, it changes there.

## Setup

Prerequisites: **Node 24+** and **Docker** (see the README for the port caveats).

```bash
cp .env.example .env
npm install
docker compose --profile dev up -d      # Postgres 16 on 127.0.0.1:5432
npx prisma migrate dev
npm run dev
```

The test suite needs the dev-profile Postgres running.

## Before you open a PR

Run all three — CI runs the same:

```bash
npm run typecheck      # tsc --noEmit
npm test               # vitest (needs the dev Postgres up)
npm run build          # next build
```

Add or update tests for behavioural changes, especially anything touching the
gate — `lib/visibility.test.ts` is the invariant suite.

## Notes

- `docker build .` fetches Google Fonts at build time (`next/font`). Offline or
  proxied environments fail opaquely there.
- TypeScript is strict; keep it typed.
