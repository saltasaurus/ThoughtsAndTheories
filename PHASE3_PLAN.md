# Phase 3 Plan

Phase 3 was scaffolded to spec's minimum bar ("working routes and honest
TODOs" — see PHASES.md). This plan takes it the rest of the way: full build,
Phase-1-style rigor (tests + `tsc` + `next build` green, then an adversarial
hardening round), for all six areas SPEC.md lists.

Every item below already has real groundwork from Phase 1 — no area starts
from zero. The work is UI + a thin service layer wired onto data models,
gates, and recompute logic that already exist and are already tested.

## Proposed judgment calls (confirm before starting)

SPEC allows no silent judgment calls — Phase 3 needs a few the spec doesn't
resolve. Flagging up front so they land in PHASES.md's deviations list
either way:

1. **Template editor edits fields only, not `CardType` itself.** `CardType`
   is a Prisma enum (7 fixed values); adding a new card type is a schema
   migration, not a UI action. The editor lets an OWNER add/edit/reorder/
   retire *fields* within the existing 7 templates.
2. **API tokens, not OAuth/JWT.** One `ApiToken` model, token shown once at
   creation, no expiry logic beyond manual revoke. Hashed with **SHA-256,
   not bcrypt**: bcrypt fits passwords because email is the lookup key, but
   a bare bearer token has no lookup key — a salted hash can't be queried,
   forcing a full-table `bcrypt.compare` scan on every API request. Tokens
   are 128+ bits of `randomBytes`, so unsalted SHA-256 (`node:crypto`, zero
   new dependencies) loses nothing and makes `findUnique({ tokenHash })`
   work.
3. **REST API v1 ships read endpoints first; writes reuse existing Server
   Action service functions** (`createCard`, `setOwnProgress`, etc.) behind
   the same token-derived `Viewer`. No parallel gating logic — every route
   calls the same `lib/visibility.ts` / `lib/services/*` functions the UI
   calls.
4. **Roster analytics is aggregate-only and active-session-only.**
   Membership rows aren't revisioned (revisions cover Card/CardField only —
   PHASES.md deviation 16 states the scope), so there's no historical
   position data. A "per-past-session" breakdown computed from *current*
   `revealIndex` vs old goals would be a monotone artifact — everyone
   drifts to "ahead" of old goals as they read on — so it's cut, not
   shipped as pseudo-history. Analytics = state-distribution counts against
   the active session's goal, never a name paired with a position.
5. **Export/import is an OWNER-only, whole-series operation that always
   creates a new series on import** — never overwrites an existing one in
   place. Excludes `Membership`/session/reading-position/invite data
   (instance-specific, not series content) and `Revision` history (its
   `userId` FKs don't exist on the target instance, and no admin path may
   leak diffs per SPEC).

---

## 1. Template editor UI

**Goal:** an OWNER can add, edit, reorder, and retire template fields for
any of the 7 card types without touching the DB directly.

**Where:** `app/series/[seriesId]/templates/` (currently read-only) +
new `lib/services/templates.ts` (CRUD, mirroring `structure.ts`'s shape).

**Design:** `TemplateField` already has `order` and `deletedAt` — the
read-only page proves the model needs no migration. Add: `addField`,
`updateField` (label/required/defaultRevealBehavior), `reorderFields`,
`retireField` (soft delete). Because per-deviation-11 explicit `CardField`
reveal points are stored on the card instance, not derived live from the
template, editing/retiring a template field never touches existing cards'
data — it only changes defaults offered to *future* cards. That's what
makes this safe to ship without a data migration.

Two guards the untouched-data property forces:
- **`fieldType` is immutable once any live `CardField` row exists** on the
  field (and SELECT/MULTISELECT `options` can't remove a choice a stored
  value uses). "Never touches existing data" cuts both ways: changing TEXT
  to NUMBER would leave every stored Json value malformed under the new
  type, unvalidated. Server-side check, clear error.
- **`(templateId, key)` uniqueness is app-enforced in `addField`** — the
  schema has only `@@index([templateId])`, no unique constraint, so
  nothing else stops a duplicate key.

**Completeness criteria:**
- OWNER-only actions (redirect/403 for others, matching existing pages).
- Reordering persists and the card-creation form reflects new order.
- Retiring a field removes it from new-card forms but existing cards keep
  their stored `CardField` rows untouched (test asserts this explicitly).
- `fieldType` change on a field with live values is rejected server-side;
  duplicate `key` within a template is rejected (tests for both).
- Service-level tests for reorder + retire in `lib/services/templates.test.ts`.

## 2. Calendar editor

**Goal:** an OWNER can create a calendar (for a series that has none),
edit era offsets, add/rename eras and months, and edit week length /
weekday names — all from the UI.

**Where:** `app/series/[seriesId]/calendar/` (currently read-only) +
extend `lib/services/calendar-admin.ts`.

**Design:** era-offset recompute is already transactional and tested
(PHASES.md Phase 1 line, `calendar-admin.ts`). New mutations: `createCalendar`,
`addEra` (reuses the same recompute path as editing an offset), `renameMonth`,
`updateWeekConfig`.

Eras and months are NOT symmetric in the schema, so their guards differ:
- **Eras** are FK-referenced (`TimelineEntry.eraId`) — an in-use era can't
  be deleted, only renamed or have its offset changed (which recomputes,
  doesn't invalidate). Straight FK check, like `structure.ts` section guards.
- **Months** have no FK — entries store the raw integer `monthOrder`. The
  in-use check is an app-level comparison (`timelineEntry.monthOrder ==
  month.order` within the calendar's series), and **month reordering is
  not offered**: renumbering months would silently re-point every stored
  `monthOrder` at a different month. Months support rename and append-only
  add; order is fixed at creation.
- **`createCalendar` guards one-calendar-per-series** in app code:
  `Series.calendars` is an unconstrained list but every read
  (`getSeriesCalendar`) does `findFirst` — a second calendar would be
  silently unreachable.

**Completeness criteria:**
- Creating a calendar for a series with none (currently a dead end per the
  read-only page's own copy).
- Editing an era's offset recomputes `absoluteSortKey` for every dated
  entry in one transaction (extend the existing recompute test to the new
  editor mutation, not just the seed path).
- Deleting an in-use era/month is rejected server-side with a clear error
  (era via FK check, month via `monthOrder` comparison — separate tests).
- Creating a second calendar for a series is rejected.

## 3. Revision history browser

**Goal:** a viewer sees a card's edit history, respecting the same
spoiler gate as everything else — nothing new to build on the gating side,
this is purely a render of an already-gated read.

**Where:** `app/series/[seriesId]/cards/[cardId]/history/` (currently a
static placeholder) calling `listRevisions` from `lib/visibility.ts`.

**Design:** `listRevisions` is already viewer-scoped (fixed in Phase 1's
hardening round — cross-series entity leaks were the #2 finding). The page
is a straight render: chronological list, before/after diff per
`Revision` row, `CARD` vs `CARD_FIELD` entity type labeled.

Known, accepted asymmetry (so the hardening round doesn't re-litigate it):
revisions snapshot `revealIndex` at write time. If a card's reveal point is
later *lowered*, older revisions keep their higher snapshot — a READER can
see the card but not those revisions, and the page shows an empty history.
Not a leak (it errs toward hiding); expected behavior, documented in the
page's empty-state copy.

**Completeness criteria:**
- OWNER sees full history; a READER sees only revisions whose snapshot
  `revealIndex` they've passed — never a row, timestamp, or count that
  would imply a later, unseen revision exists (this is the exact leak
  Phase 1's hardening round closed at the query layer; the page must not
  reopen it by rendering raw counts or "N more revisions hidden" style UI).
- Regression test: a READER behind a field's reveal point gets a history
  view identical in shape to one where no later revision ever happened.

## 4. Session roster analytics

**Goal:** aggregate insight into how the group is pacing, without ever
pairing a name with an exact position (SPEC is explicit: state only).

**Where:** `app/series/[seriesId]/sessions/page.tsx` (roster list already
renders `behind`/`at_goal`/`ahead` badges per `lib/services/memberships.ts`).

**Design:** add `getRosterAnalytics(seriesId)` returning counts by state
(`behind`/`at_goal`/`ahead`) against the active session's goal. No
per-past-session breakdown and no per-member trend line, per judgment
call #4 above — the historical data to support either doesn't exist, and
faking it from current positions would mislead.

**Completeness criteria:**
- Service-level test asserts `getRosterAnalytics`'s return type carries
  only aggregate counts — no `userId`, no per-member `revealIndex`.
- Handles zero-member and no-active-session series without error.

## 5. REST API (`/api/v1`)

**Goal:** friends can hit a token-authed API gated identically to the web
UI — same locked-placeholder shape for gated cards, same 403s.

**Where:** `app/api/v1/route.ts` (currently a 501 stub) → split into
`app/api/v1/series/[seriesId]/{cards,cards/[cardId],graph,timeline,search}/route.ts`,
plus `app/api/v1/tokens` management wired to the settings page.

**Design:** new `ApiToken { id, userId, label, tokenHash, createdAt,
lastUsedAt, revokedAt }` model (SHA-256 hash per judgment call #2 — bcrypt
can't be queried by hash). `getViewerFromToken(request, seriesId)` in
`lib/auth-helpers.ts` produces the same `Viewer` type as the cookie-based
`getRequestViewer`, but does NOT mirror its error behavior:
`getRequestViewer` calls `redirect()`, which is wrong for an API — token
routes return 401 (bad/revoked token) / 403 / 404 JSON. Tokens never get
spoiler peek — no peek parameter exists in the API surface. All API input
(query params, mutation bodies) is validated with Zod, per SPEC's blanket
rule. Every route handler calls the existing gated functions (`listCards`,
`getCardDetail`, `graphData`, `listTimeline`, `searchCards`) — no bespoke
gating in the API layer, so there's only one place gating logic can be
wrong.

**Scope, explicitly:** reads AND card writes ship in Phase 3. Writes are
thin: route handlers parse with Zod and call `lib/services/cards.ts`
functions (`createCard`, `updateCard`, `setCardField`, …) with the
token-derived `Viewer` — the service layer already enforces roles.

**Completeness criteria:**
- Token generation (shown once) + revoke UI in settings, reusing the
  invite-code generation pattern already in `lib/services/invites.ts`.
- Read endpoints for cards/graph/timeline/search; write endpoints for card
  create/update/set-field, each a Zod-parse + service-call and nothing else.
- Integration test: a READER token against a card past their reveal point
  gets back `{ id, locked: true }` — byte-identical shape to what the UI
  gets, proving there's no second gate to drift from the first.
- Test: a revoked token gets 401; a valid token for a non-member series
  gets 404 (matching `getViewer`'s not-a-member behavior), never 200.
- 501 stub removed; unauthenticated requests get 401, not a leak.

## 6. JSON export/import

**Goal:** an OWNER can export a full series as JSON and import it as a new
series (backup, or move-to-new-instance) — not a partial or in-place merge.

**Where:** `app/series/[seriesId]/settings/page.tsx` (currently a TODO
line) + `lib/services/export-import.ts`.

**Design:** export reads the full series tree (structure, cards, fields,
relations, **timeline entries**, calendar, templates) through **unredacted**
service reads, not `lib/visibility.ts` — export is an OWNER backup tool
operating outside the reveal gate by design, same trust level as direct DB
access. Import always creates a brand-new `Series` (fresh IDs throughout,
remapped foreign keys), never writes into an existing one, and runs inside
a single Prisma transaction so a malformed file can't leave a half-built
series behind.

Cross-instance realities the format must handle:
- **Excluded:** `Membership`, sessions, reading positions (instance-
  specific), `Invite` rows, and `Revision` rows — revisions are append-only
  history whose `userId` FKs reference users that don't exist on the target
  instance, and SPEC is explicit that no admin path may leak diffs.
- **`Card.createdById` is reassigned to the importing OWNER** — source
  user IDs can't be remapped to users that don't exist.
- **Import creates the importer's OWNER `Membership`** on the new series —
  `getViewer` throws for non-members, so a series with zero memberships
  would be unreachable by everyone, including its importer.
- **Derived values are omitted from the file and recomputed after load**:
  `absoluteSortKey` (a `BigInt` — `JSON.stringify` throws on it anyway),
  section `position`, and all cached `revealIndex` columns. After load,
  run `recomputeSeriesPositions` (positions + reveal caches) AND
  `recomputeCalendarSortKeys` (sort keys) inside the same transaction.
- **The file is validated with a Zod schema** before any write — "malformed"
  means "fails the schema," not ad-hoc checks.

**Completeness criteria:**
- Round-trip test: export → import → structural equality (section/card/
  field/relation/timeline counts and values match; new series has fresh
  IDs; recomputed `absoluteSortKey` and `revealIndex` values match the
  source's).
- Malformed JSON is rejected with a clear error and zero partial writes
  (transaction test: kill the import mid-way via a bad row, assert nothing
  persisted).
- Imported cards' `createdById` is the importer; the importer holds an
  OWNER membership on the new series (asserted in the round-trip test).
- Export explicitly excludes `Membership`/session/reading-position/invite/
  revision data; settings UI copy says so.

---

## Hardening round (after all six are built and green)

Same shape as Phase 1's: 3 independent finder lenses, every finding
verified against the code before it's fixed, regression test per confirmed
finding. Priority areas given what's new here:
- Token auth reaching every route the UI reaches, and nothing more (no
  route accidentally skipping the `Viewer` gate).
- Export/import transactional integrity and cross-series ID collisions.
- Revision browser re-opening the leak Phase 1 already closed once.
- Calendar editor referential integrity (in-use era/month deletion).

## Phase 3 completeness bar

- `npx tsc --noEmit` clean, no `any`.
- `npm test` green, including new test files per area above.
- `next build` green.
- New Prisma migration(s) (`ApiToken` model) applied via `prisma migrate dev`.
- PHASES.md Phase 3 section rewritten from "scaffolded" to "done," in the
  same area→file table style as Phase 1/2, plus a hardening list matching
  Phase 1's.
