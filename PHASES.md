# Phase status

## Phase 1 — done, fully built

| Area | Where |
|---|---|
| Docker Compose dev/prod + multi-stage Dockerfile + Caddy | `docker-compose.yml`, `Dockerfile`, `docker/Caddyfile` |
| Prisma schema, single init migration incl. raw-SQL partial unique index (one ACTIVE session per series) | `prisma/schema.prisma`, `prisma/migrations/*_init/migration.sql` |
| Seed: 3-book series (book 1 in three Parts, prologue, two interludes *between* Parts, epilogue), 29 sections, 25 cards across the reveal range, full calendar, divergent timeline, ACTIVE session, 3 users at different positions | `prisma/seed.ts` |
| Auth.js v5 credentials + bcrypt, invite-gated register, first-account bootstrap, join flow | `lib/auth.ts`, `app/actions/auth.ts`, `app/register/`, `app/join/[code]/` |
| Invites: create (role-limited), revoke, list, atomic redemption | `lib/services/invites.ts`, `app/series/[seriesId]/settings/` |
| Series/Book/Section CRUD, `recomputeSeriesPositions`, mid-series insertion, RESTRICT on referenced sections | `lib/services/structure.ts`, `app/series/[seriesId]/structure/` |
| Membership + progress (self-set; owner may lower only), roster states only | `lib/services/memberships.ts` |
| Card CRUD via templates, per-field reveal points, reveal-cascade rule | `lib/services/cards.ts`, `app/series/[seriesId]/cards/` |
| Relation CRUD with type/weight/directed | `lib/services/relations.ts` |
| Calendar schema + seed + `formatInWorldDate` + era-offset recompute + structured date entry | `lib/calendar.ts`, `lib/services/calendar-admin.ts`, `lib/services/timeline.ts` |
| Session CRUD, DB-enforced single ACTIVE, shell goal display, notes warning | `lib/services/sessions.ts`, `components/shell/reading-position.tsx` |
| Soft delete + restore (cards, relations, timeline entries) | services + respective pages |
| Revision writes, gated reads | `lib/services/revisions.ts`, `lib/visibility.ts` |
| **The visibility layer + full test suite (37 tests, all green)** | `lib/visibility.ts`, `lib/visibility.test.ts`, `lib/calendar.test.ts`, `tests/integration.test.ts` |
| Card list with locked placeholders + detail + template-driven edit | `app/series/[seriesId]/cards/**` |
| Default templates for all seven types, seeded at series creation | `lib/templates.ts`, `lib/services/series.ts` |

Verified: `npx tsc --noEmit` clean (strict, no `any`), `npm test` 42/42,
`next build` green, seed runs.

### Hardening round (post-build adversarial review)

A multi-agent adversarial review (3 finder lenses, every finding independently
verified against the code; 16 raw findings, 9 confirmed, 7 refuted) surfaced
and fixed, with regression tests:

1. **critical** — `moveSection`/`insertSection` could persist book-interleaved
   orders that the next structural edit silently "corrected", flipping reveal
   gates. Fix: ordering anchors are constrained to the target section's own
   book (server-rejected otherwise; the UI picker only offers same-book
   anchors). Cross-book *moves* are deliberately unsupported.
2. **major** — `listRevisions` didn't scope the entity to the viewer's series;
   revealIndex is a per-series axis, so cross-series entityIds could pass the
   gate. Fix: entity resolved through its parent card/field to the viewer's
   series inside the visibility layer.
3. **major** — `registerUser` wasn't transactional: a lost invite-claim race
   left an orphaned invite-less account. Fix: account creation + claim in one
   transaction, email-conflict catch narrowed to P2002.
4. `lowerMemberProgress` error was a comparison oracle on a member's exact
   position (binary-searchable). Fix: non-lowering requests are a silent no-op.
5. YEAR/MONTH-precision dates with stray finer components skewed
   `absoluteSortKey`. Fix: precision truncation in both the pure function and
   the raw-SQL recompute.
6. `setOwnProgress` could interleave with `recomputeSeriesPositions` and
   persist a stale cached revealIndex. Fix: single atomic UPDATE reading the
   position in the same statement.
7. First-account bootstrap check was a TOCTOU race on an empty public
   instance. Fix: `pg_advisory_xact_lock` serializes registration.
8. Cascade raises and field clears wrote no CardField revisions. Fix: both
   revisioned.

## Phase 2 — data cores done, UI pending

- **Search** — shipped early and functional (`app/series/[seriesId]/search/`),
  title+summary only, gated per card via `searchCards` in `lib/visibility.ts`.
  Currently `ILIKE` contains; Phase 2 will move it to a precomputed tsvector.
- **Knowledge graph** — gated data core done and tested
  (`graphData` in `lib/visibility.ts`: omits gated nodes entirely, node cap
  with `truncated` flag). Cytoscape + fcose UI pending
  (`app/series/[seriesId]/graph/` is an honest scaffold).
- **Timeline board** — gated, clamped query done (`listTimeline`); Phase 1
  ships a list view (`app/series/[seriesId]/timeline/`). The vis-timeline
  board is pending; per spec, if vis-timeline cannot take a plain integer
  axis we will build a custom axis rather than coercing in-world dates into
  real `Date`s.
- **Relations board** — pending; card detail already lists gated relations.

## Phase 3 — scaffolded with real routes and honest TODOs

- Template editor UI — `app/series/[seriesId]/templates/` (read-only view now;
  model + seeding are real).
- Calendar editor — `app/series/[seriesId]/calendar/` (read-only view now;
  era-offset recompute already transactional + tested).
- Revision history browser — `app/series/[seriesId]/cards/[cardId]/history/`
  (writes + gated reads already real).
- REST API — `app/api/v1/route.ts` answers 501.
- Session roster analytics, JSON export/import — noted as TODOs on the
  sessions/settings pages.

## Deviations & judgment calls (spec allows none silently — so, aloud)

1. **Prisma 6, not 7.** Prisma 7 removed `url = env(...)` from schema files in
   favor of driver adapters; the spec mandates the conservative documented
   approach, which today is Prisma 6.
2. **TypeScript pinned to 5.x.** TS 7 (native-compiler preview) has no `ts.sys`
   in its JS API, which crashes Next 15's `next.config.ts` loader.
3. **`bcryptjs` instead of native `bcrypt`.** Same algorithm/format, pure JS —
   no node-gyp on Windows, no musl headaches in the Alpine image.
4. **Model named `CardRelation`** (spec: "Relation") to avoid colliding with
   TypeScript's DOM `Relation` type in app code.
5. **`InviteRole` is its own enum** (`EDITOR | READER`) so the *type system*
   guarantees invites can never mint an OWNER.
6. **`Membership.currentSectionId` is nullable**: null = "series start,
   before any section" (revealIndex 0). Required because a freshly created
   series has no sections yet, and it models "hasn't started" honestly.
7. **`defaultRevealBehavior` values chosen** (spec names the column, not the
   values): `CARD` (field defaults to its card's reveal point) and
   `SERIES_START` (visible whenever the card is). Default `CARD` — protective.
8. **No middleware**; auth is enforced server-side per page/action through
   `requireUser` / `getRequestViewer` (`lib/auth-helpers.ts`). Avoids
   Prisma-in-edge-runtime; enforcement is still entirely server-side.
9. **Spoiler peek** is a cookie read in exactly one place
   (`getRequestViewer`) — never plumbed through call sites. A READER whose
   request carries the flag gets a hard rejection per spec (that includes a
   hand-set cookie; the reader UI never offers the toggle).
10. **Theory reveal default**: implemented as the spec's warning — we *never*
    silently raise a theory's reveal point on relation attach/detach; instead
    `getTheoryRevealWarning` surfaces the mismatch. Computed only under peek,
    because showing the warning to a non-peek viewer would itself leak that a
    later-revealed citation exists.
11. **Fields may store reveal points below their card's** (SERIES_START
    requires it). Reads always double-gate (field AND parent card), and
    raising a card's reveal point raises earlier fields/relations per the
    cascade rule; lowering never cascades. Tested.
12. **Structure-edit permissions** are enforced at the action boundary
    (`requireOwner` in `app/actions/structure.ts`); content services enforce
    roles internally. One boundary per mutation either way.
13. **shadcn/ui delivered as hand-copied primitives** (`components/ui/*`, cva +
    tailwind-merge, native `<select>`): Phase 1 needs no Radix behaviors, and
    shadcn is by design a copy-in component convention, not a dependency.
14. **Section `type` is immutable after creation** in the UI (delete +
    recreate to change it); title/number/part are editable. A non-peek owner
    editing structure cannot accidentally wipe a gated title — the form locks
    the title field instead (`titleLocked`).
15. **Card lists are always sorted by `(revealIndex, id)`** — never a
    content-derived sort — so a locked card's slot position can't act as a
    side channel. This ordering is applied to *all* card lists, not only mixed
    ones.
16. **Revisions cover Card and CardField** mutations (spec's stated scope);
    relation/timeline edits are not revision-tracked.
17. **Tests run against a real Postgres** (`theorytracker_test` on the same
    dev-profile container) — the gate lives in queries, so unit-mocking Prisma
    would test nothing. Files run sequentially; the bootstrap test wipes the
    test DB deliberately as its final act.
