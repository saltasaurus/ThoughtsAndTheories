# TheoryTracker

A self-hosted, spoiler-safe worldbuilding wiki for book clubs. Members build a
shared knowledge base about the series they're reading — characters, locations,
events, theories, relationships — and the app **mechanically guarantees** that
no member ever sees information from beyond their own reading position.

## Quick start (dev)

```bash
cp .env.example .env          # 1. defaults work for local dev
npm install                   # 2.
docker compose --profile dev up -d    # 3. Postgres 16
npx prisma migrate dev && npx prisma db seed   # 4. schema + demo series
npm run dev                   # 5. http://localhost:3000
```

Demo logins (all `password123`): `alice@example.com` (owner, deep in book 3),
`bram@example.com` (editor, at the session goal), `cora@example.com` (reader,
early in book 1). Log in as Cora and Alice side by side to watch the gate work.

Run the test suite (needs the dev-profile Postgres running):

```bash
npm test
```

## The invariant

Every piece of content carries a **reveal point** — a foreign key to the
Section where the story discloses it, plus a cached integer copy of that
section's global position. A viewer sees content iff
`content.revealIndex <= viewer.revealIndex`. That comparison happens
**server-side, at the query layer**, in exactly one module:

- [`lib/visibility.ts`](lib/visibility.ts) — builds the Prisma `where`
  fragments (reveal gate + soft-delete filter) that every gated read composes.
  Locked-placeholder redaction, relation endpoint-max visibility, CARD_REF
  double-gating, revision gating, and timeline clamping all live here.
  No client-side filtering exists anywhere; a payload that leaves the server
  never contains gated data.

Two deliberate, bounded disclosures — and only these:

1. **Locked placeholders** in card list views: a gated card renders as a
   uniform grey tile with a lock icon, and its payload is exactly
   `{ id, locked: true }`. Existence and count are disclosed; nothing else.
   Graph, search, and relation payloads omit gated content entirely instead.
2. **Series structure**: how many books, parts, and sections exist and their
   numbering ("Book 2 · Chapter 14") is never gated — the session-goal mechanic
   requires it. Section **titles** and Part **titles** are gated; titles spoil.

**Search-scope limitation (deliberate):** search covers card *titles and
summaries only*, gated per card. Field values, relation notes, and rich-text
bodies are not indexed — per-field gating cannot be reconciled with per-row
search vectors, and a match against a gated field would leak that the term
exists. Field-content search is out of scope.

## Architecture

- **Next.js 15** (App Router, server components, Server Actions), TypeScript
  strict, Tailwind v4 + shadcn-style primitives, Tiptap for rich text.
- **PostgreSQL 16 + Prisma.** Reveal points are FKs (source of truth) plus
  denormalized indexed integers (cache). Structural edits — inserting a
  prologue mid-series, reordering — rewrite every position and every dependent
  cache in one transaction (`lib/services/structure.ts`), so content stays
  gated at the same *section* even when numbers shift.
- **Auth.js v5** with credentials + bcrypt. Registration is closed: only a
  valid invite link reaches it (the very first account bootstraps the install).
- **Roles** (OWNER / EDITOR / READER) govern *permission*; **progress** governs
  *visibility* — two orthogonal axes. Owners and editors get a loud, banner-red
  "spoiler peek" toggle to author gated content; readers never do, and a reader
  request carrying the peek flag is rejected outright.
- **Progress is a claim, not a grant**: only you can raise yours; an owner can
  only lower someone's.
- Fictional **calendars** are structured data (eras, months, weekdays), never
  parsed strings. In-world dates sort by a persisted BIGINT key; *when the
  reader learns something* (revealIndex) and *when it happened in-world*
  (absoluteSortKey) are independent axes and never conflated.
- **Soft delete** everywhere, filtered at the same central query-composition
  point as visibility. **Revisions** are append-only and gated — a diff
  contains gated values, so revision reads pass through the visibility layer.

Key directories:

```
lib/visibility.ts        the gate — all gated reads compose this
lib/services/            transactional domain services
lib/calendar.ts          pure in-world date math + formatting
app/actions/             server actions (zod-validated mutations)
app/series/[seriesId]/   the app shell + feature pages
prisma/                  schema, migrations (incl. raw-SQL partial unique
                         index: one ACTIVE session per series), seed
lib/visibility.test.ts   the invariant test suite
```

## Deployment

### A. VPS with Docker Compose + Caddy (primary path)

1. **Provision** a small VPS (1–2 GB RAM is plenty) with Docker installed.
2. **DNS**: point an A/AAAA record for your domain (e.g. `club.example.com`)
   at the VPS.
3. **Clone & configure**:
   ```bash
   git clone <your-fork> theorytracker && cd theorytracker
   cp .env.example .env
   # edit .env:
   #   AUTH_SECRET=$(openssl rand -base64 32)
   #   DOMAIN=club.example.com
   ```
4. **Launch** (Caddy obtains HTTPS automatically for $DOMAIN):
   ```bash
   docker compose --profile prod up -d --build
   ```
   The `migrate` service runs `prisma migrate deploy` before the app starts.
5. **Bootstrap or seed**: visit `https://club.example.com` — with an empty
   database you're prompted to create the first (owner) account. To load the
   demo series instead:
   ```bash
   docker compose --profile prod run --rm migrate npx prisma db seed
   ```
6. **Backups** — nightly `pg_dump` via cron (`crontab -e`):
   ```cron
   0 3 * * * docker exec theorytracker-db-1 pg_dump -U theorytracker theorytracker | gzip > /var/backups/theorytracker-$(date +\%F).sql.gz
   ```
   Restore: `gunzip -c backup.sql.gz | docker exec -i theorytracker-db-1 psql -U theorytracker theorytracker`.

### B. Home server behind Cloudflare Tunnel or Tailscale

Run the same prod profile without exposing ports 80/443:

- **Cloudflare Tunnel**: `cloudflared tunnel create theorytracker`, route your
  hostname to `http://localhost:3000`, and run the `app` + `db` services only
  (skip Caddy; the tunnel terminates TLS). Set `AUTH_URL` to the tunnel
  hostname.
- **Tailscale**: install Tailscale on the server, `tailscale serve 3000`, and
  share the tailnet with your club. `AUTH_URL=https://<machine>.<tailnet>.ts.net`.

### C. Vercel + managed Postgres

No Compose involved. Create a managed Postgres (Neon, Supabase, Vercel
Postgres), then in the Vercel project set `DATABASE_URL` (from the provider),
`AUTH_SECRET`, and `AUTH_URL` (your Vercel URL). Run
`npx prisma migrate deploy` against the database once (locally or via CI).
Everything else is unchanged — the app is a standard Next.js deployment.

## Inviting your book club

1. **Bootstrap**: the first visit to a fresh install prompts you to create the
   founding account (no invite needed — the only time that's true).
2. **Create your series**, then add its books and sections under **Structure**
   (prologues, chapters, interludes, epilogues — anything a reader passes
   through).
3. **Generate invite links** under **Settings**: choose Reader or Editor,
   optionally an expiry and a use limit. Copy the `https://…/join/<code>` link.
4. **Members join** through the link — it offers registration (or joins
   directly if they're logged in) and consumes one use.
5. **Members set their reading position** — the first-run banner asks
   immediately; the control lives permanently in the shell. Everything at or
   before their position unlocks; everything after stays locked.
6. Create a **session** with a goal section; the goal (never gated) appears in
   everyone's shell next to their own position, with a one-click "jump to
   goal".
