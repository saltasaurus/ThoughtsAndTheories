# TheoryTracker

[![CI](https://github.com/saltasaurus/ThoughtsAndTheories/actions/workflows/ci.yml/badge.svg)](https://github.com/saltasaurus/ThoughtsAndTheories/actions/workflows/ci.yml)

A self-hosted, spoiler-free wiki and knowledge graph for book clubs. Members
build a shared reference for the series they're reading — characters, locations,
events, theories, relationships — and the app **mechanically guarantees** that
no member ever sees anything from beyond their own reading position.

The gate isn't a convention members have to remember. It's one rule, enforced
server-side at the query layer: you see a piece of content **iff its reveal
point is at or before your reading position**. A reader three chapters in and an
owner who finished the series load the same page and get different data — no
client-side hiding, no "please don't scroll down."

## Requirements

- **Node 24+**
- **Docker** (for the Postgres 16 container; or bring your own Postgres)
- **Ports 3000 and 5432 free.** The dev database binds `127.0.0.1:5432`. If you
  already run Postgres there, `prisma migrate dev` may connect to the *wrong*
  database and fail with what looks like a schema error — stop the other
  Postgres or change the port first. This is the most common way a first run
  goes sideways.

## Screenshot

![The same series, two reading positions: a reader sees locked grey tiles where
an owner sees the cards.](docs/img/gate.png)

The same series opened at two reading positions. Locked tiles disclose that a
card exists and nothing else; graph and search omit gated content entirely.

## Quick start (dev)

```bash
cp .env.example .env                            # 1. defaults work for local dev
npm install                                     # 2.
docker compose --profile dev up -d              # 3. Postgres 16 on 127.0.0.1:5432
npx prisma migrate dev && npx prisma db seed    # 4. schema + demo series
npm run dev                                      # 5. http://localhost:3000
```

Demo logins (all `password123`, **local evaluation only** — see Security):
`alice@example.com` (owner, deep in book 3), `bram@example.com` (editor, at the
session goal), `cora@example.com` (reader, early in book 1). Log in as Cora and
Alice side by side to watch the gate work.

Run the test suite (needs the dev-profile Postgres running):

```bash
npm test
```

### Troubleshooting

- **`prisma migrate dev` errors about missing tables or the wrong schema** —
  something else is already on port 5432. See Requirements.
- **`Cannot connect to the Docker daemon`** — Docker Desktop isn't running.
- **`@prisma/client did not initialize yet`** — run `npx prisma generate` (it
  runs automatically during `npm install`, but not after a fresh `git pull` that
  changed the schema).

## Features

- **Spoiler gate** — every card, field, relation, revision and timeline entry
  carries a reveal point; visibility is one server-side comparison.
- **Structure editor** — books, parts, prologues, chapters, interludes,
  epilogues. Inserting or reordering rewrites every position in one transaction,
  so content stays gated at the same *section* even as numbers shift.
- **Timeline** with fictional **calendars** (eras, months, weekdays) — in-world
  dates sort independently of when the reader learns them.
- **Knowledge graph** of cards and typed relations, gated end-to-end.
- **Search** over card titles and summaries, gated per card.
- **Revisions** — append-only, gated (a diff can contain gated values).
- **Templates** per card type, **club sessions** with reading goals, and
  reading-progress tracking.
- **Invite-only membership** with Reader/Editor roles, expiry and use limits.
- **REST API v1** with scoped bearer tokens.
- **JSON export/import** of a series.
- **`/api/health`** — unauthenticated liveness/readiness for uptime monitors.

## REST API

A self-describing discovery document lives at **`GET /api/v1`** — it lists every
route, the auth scheme, scopes and gating rules. Mint a token on a series'
**Settings** page (READ or WRITE scope; WRITE is required for any mutation).

```bash
curl -H "Authorization: Bearer <token>" https://your-instance/api/v1/series/<seriesId>/cards
```

Responses are gated exactly as the web UI is, by calling the same functions:
tokens never grant spoiler peek.

## Self-hosting

Three supported paths — VPS + Docker Compose + Caddy (automatic HTTPS), a home
server behind a Cloudflare Tunnel or Tailscale, or Vercel + managed Postgres.
Full instructions, the upgrade procedure and backups are in
**[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**.

Generate a real `AUTH_SECRET` before exposing an instance — the dev default is
refused once `AUTH_URL` points anywhere but localhost:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Security posture

- **Invite-only registration.** Only a valid invite link reaches sign-up; the
  first account bootstraps the instance, then registration closes behind it.
- **Progress is a claim, not a grant** — only you can raise your own position; an
  owner can only lower someone's.
- **Rate limiting** on login, registration, invites, the REST API and series
  import.
- **Scoped API tokens** (READ/WRITE, optional expiry); never grant spoiler peek.
- **Postgres binds loopback-only** (`127.0.0.1:5432`). This is the boundary — not
  the compose password. Docker publishes ports via NAT rules *ahead* of the host
  firewall, so a `ufw deny` never protected a `0.0.0.0` bind.
- **Security headers** — CSP, `frame-ancestors 'none'`, `Referrer-Policy:
  same-origin`, HSTS.

### Honest limits

- **In-process rate limiting.** Counters live in one app process: they reset on
  restart and are not shared between replicas. Run a single app container, or
  move `lib/rate-limit.ts` to a shared store first.
- **Search covers titles and summaries only.** Field values, relation notes and
  rich-text bodies are not indexed — per-field gating can't be reconciled with
  per-row search vectors without leaking that a term exists in a gated field.
- **`next-auth` is a v5 beta** (`5.0.0-beta.*`). It handles every session.
- **Two unresolved advisories, both unreachable at runtime**, disclosed rather
  than papered over: `postcss < 8.5.10` (moderate) is build-time only; the
  `sharp` HIGH is reachable only through Next's Image Optimization API, and this
  app imports `next/image` **nowhere** (no `images` block in `next.config.ts`).
  Neither fix is applied because `npm audit fix --force` downgrades Next 15 → 9.
- **Remote card images disclose the viewer's IP.** `img-src https:` is allowed by
  design so `IMAGE_URL` fields can render remote images
  ([`next.config.ts`](next.config.ts)), and cards render `<img src>` directly
  ([`components/cards/field-value.tsx`](components/cards/field-value.tsx)). Any
  EDITOR can point a card image at a host they control and learn the IP,
  User-Agent and view timing of every member who opens it. `Referrer-Policy:
  same-origin` hides the referring URL but not the connection. **v1 discloses
  this; image proxying is post-1.0.**

## The invariant (architecture)

Every piece of content carries a **reveal point** — a foreign key to the Section
where the story discloses it, plus a cached integer copy of that section's
global position. A viewer sees content iff
`content.revealIndex <= viewer.revealIndex`, evaluated **server-side, at the
query layer**, in exactly one module:

- [`lib/visibility.ts`](lib/visibility.ts) — builds the Prisma `where` fragments
  (reveal gate + soft-delete filter) that every gated read composes.
  Locked-placeholder redaction, relation endpoint-max visibility, CARD_REF
  double-gating, revision gating and timeline clamping all live here. No
  client-side filtering exists anywhere; a payload that leaves the server never
  contains gated data.

Two deliberate, bounded disclosures — and only these:

1. **Locked placeholders** in card lists: a gated card renders as a uniform grey
   tile with a lock icon; its payload is exactly `{ id, locked: true }`.
   Existence and count are disclosed, nothing else. Graph, search and relation
   payloads omit gated content entirely.
2. **Series structure**: how many books, parts and sections exist and their
   numbering ("Book 2 · Chapter 14") is never gated — the session-goal mechanic
   requires it. Section and Part *titles* are gated; titles spoil.

**Stack:** Next.js 15 (App Router, server components, Server Actions),
TypeScript strict, PostgreSQL 16 + Prisma, Auth.js v5 (credentials + bcrypt),
Tailwind v4, Tiptap. Roles (OWNER/EDITOR/READER) govern *permission*; progress
governs *visibility* — two orthogonal axes. See [SPEC.md](SPEC.md) for the full
specification and its deviations.

Key directories:

```
lib/visibility.ts        the gate — all gated reads compose this
lib/services/            transactional domain services
lib/calendar.ts          pure in-world date math + formatting
app/actions/             server actions (zod-validated mutations)
app/api/v1/              the REST API
app/series/[seriesId]/   the app shell + feature pages
prisma/                  schema, migrations, seed
lib/visibility.test.ts   the invariant test suite
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The one rule that matters: gating logic
lives only in `lib/visibility.ts`. Security issues go through
[SECURITY.md](SECURITY.md), not public issues.

## Status

v1.0.0. The invariant is covered by an extensive test suite; UI components are
not component-tested. Known limits are listed under Security posture above.

## License

[AGPL-3.0](LICENSE). A hosted fork must publish its source.

Bundled fonts: **Inter** and **Fraunces**, [SIL Open Font License
1.1](https://openfontlicense.org/) — self-hosted by `next/font` into the build.
