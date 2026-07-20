# ROLE

You are a senior full-stack engineer building a production-quality, self-hosted
worldbuilding wiki for a book club. Optimize for correctness of the data model
and clarity of the code. Prefer small files, small functions, single
responsibility. Comment only non-obvious logic.

# PROJECT

An open-source, self-hosted alternative to World Anvil, scoped to book clubs.
Members collaboratively build a knowledge base about books they are reading
(characters, events, locations, theories, relationships), and the app
*mechanically guarantees* no member sees information from beyond their reading
position.

# CORE INVARIANT (highest priority requirement)

Every piece of content is gated by a reveal point. A user whose reading progress
is below a content item's reveal point MUST NOT receive that content — not in the
UI, not in the API response, not in graph edges, not in search results, not in
timeline entries, not in revision diffs, not in aggregate counts.

Enforcement is SERVER-SIDE ONLY. Client-side filtering of a full payload is a
security failure and is forbidden. Filtering must occur at the query layer.

Two deliberate, bounded disclosures are permitted:
1. Locked placeholders in card list views (defined under UI/UX) disclose
   existence and count, nothing else.
2. Series structure — how many books, parts, and sections exist, and their
   numbering — is never gated. Section TITLES and Part TITLES are gated. (The session goal mechanic already
   requires structure to be visible.)

# STACK (do not substitute)

- Next.js 15, App Router, TypeScript strict mode
- PostgreSQL 16 + Prisma
- Auth.js v5, credentials provider, bcrypt
- Server Actions for mutations; Route Handlers for the REST API
- Zod for all input validation, shared between client and server
- Tailwind CSS + shadcn/ui
- Cytoscape.js for the knowledge graph (with cytoscape-fcose layout)
- Tiptap for rich text
- Vitest for tests
- Docker Compose: a `dev` profile running Postgres only (app runs via
  `npm run dev`), and a `prod` profile running Postgres + the app (multi-stage
  Dockerfile, `next start`) + Caddy as reverse proxy with automatic HTTPS via
  a `DOMAIN` env var. All secrets and URLs via `.env` (`DATABASE_URL`,
  `AUTH_SECRET`, `AUTH_URL`, `DOMAIN`); ship `.env.example`.

# DOMAIN MODEL

## Sections and reading position

Books are composed of ordered **Sections**, not merely numbered chapters.
Prologues, interludes, epilogues, and end notes are all Sections; a reader
passes through them linearly, and the spoiler gate cares only about linear
position.

- **Part** — an optional display grouping within a Book: `bookId`, `number`,
  `title` (nullable — PART TITLES ARE GATED, they can spoil), `order`,
  `deletedAt`. Parts group chapters; interludes and other interstitial
  sections may sit BETWEEN Parts, so Part membership on a Section is nullable.
  Parts are presentational grouping only — they never participate in the gate
  or in ordering.
- **Section** — `bookId`, `partId` (nullable FK — null for sections outside
  any Part, e.g. interludes between Parts, prologues, epilogues), `type`
  (PROLOGUE | PRELUDE | CHAPTER | INTERLUDE | EPILOGUE | END_NOTES | APPENDIX
  | OTHER), `number` (nullable int — a per-type sequence within the Series:
  chapters are numbered among chapters, interludes among interludes; types
  that occur once, like a prologue, leave it null), `title` (nullable —
  TITLES ARE GATED), `position` (int — a dense, gapless global sequence
  across the entire Series, spanning Part and book boundaries).
- Display labels derive from type + number: "Chapter 14", "Interlude 2",
  "Epilogue"; sections inside a Part prepend it when useful ("Part III ·
  Chapter 14"). Numbering and Parts are presentational; ordering is
  `position` only.

### Reveal points

Every gateable row stores TWO columns:

1. `revealSectionId` — a foreign key to Section. This is the durable source of
   truth for "when is this revealed."
2. `revealIndex` — a denormalized, persisted, indexed copy of that Section's
   `position`, used for fast indexed comparison in queries.

Content is visible iff `content.revealIndex <= viewer.revealIndex`.

### Structure edits (REQUIRED — do not defer)

OWNER may insert, reorder, or remove Sections and Parts at any time, including
after content exists. Moving a Section into or out of a Part changes only its
`partId`, never its gate. Because `position` is dense, any structural edit shifts
positions. Implement a single transactional service function
`recomputeSeriesPositions(seriesId)` that:

1. Rewrites `position` for every Section in the series,
2. Rewrites the cached `revealIndex` on every dependent row (cards, fields,
   relations, timeline entries, memberships) from its `revealSectionId` FK,
3. Runs in one transaction.

The FK guarantees correctness; the integer is a cache. A test must insert a
prologue mid-series and assert that all previously-gated content remains gated
at the same *section*, not the same number.

Deleting a Section that is referenced by any `revealSectionId` is RESTRICTED —
the OWNER must first reassign that content's reveal point. Do not cascade
reveal points implicitly.

- **Series** — a book series (or a standalone book, i.e. a series of one).
- **Book** — belongs to Series, has `order`.
- **Membership** — User ↔ Series, with `role` (OWNER | EDITOR | READER),
  `currentSectionId` (FK — their progress), and cached `revealIndex`.

## Content entities

- **Card** — the core content unit. Shared, not owned. Fields:
  - `id`, `seriesId`, `type` (CHARACTER | LOCATION | EVENT | ITEM | FACTION |
    CONCEPT | THEORY), `title`, `summary`, `revealSectionId`, `revealIndex`,
    `createdById`, `deletedAt` (nullable), timestamps.
  - `createdById` is attribution only — it grants NO special permission.
    Any EDITOR may edit any card. This is deliberate.
- **CardField** — a card's structured data: `cardId`, `templateFieldId`,
  `value` (JSONB), `revealSectionId`, `revealIndex`, `deletedAt`.
  CRITICAL: fields are gated *independently* of their parent card. A character
  card may be visible at section 3 while their true identity field is gated to
  section 40.
- **Revision** — append-only history of every Card and CardField mutation:
  `entityType`, `entityId`, `userId`, `diff` (JSONB), `revealIndex` (snapshot
  of the entity's effective revealIndex at write time), `createdAt`.
  REVISIONS ARE GATED CONTENT. A revision diff contains the gated value, so
  every revision read passes through the visibility layer using the revision's
  own `revealIndex`. This holds in Phase 1 even though the browser UI is
  Phase 3 — the REST API and any admin query must not leak diffs.
- **Relation** — a weighted, typed edge between two Cards:
  `fromCardId`, `toCardId`, `type` (free-text label, e.g. "sibling of",
  "betrays", "located in"), `weight` (float, 0–1, drives graph layout and edge
  thickness), `directed` (bool), `revealSectionId`, `revealIndex`, `notes`,
  `deletedAt`.
- **Template** — a per-type, per-series schema definition. Has many
  **TemplateField**: `key`, `label`, `fieldType` (TEXT | RICHTEXT | NUMBER |
  INWORLD_DATE | SELECT | MULTISELECT | CARD_REF | IMAGE_URL), `options`
  (JSONB), `required`, `order`, `defaultRevealBehavior`, `deletedAt`.
  There is deliberately NO real-world DATE field type; in-fiction dates use
  INWORLD_DATE (the embedded structure below), and real-world dates have no
  use case in card content.
  Ship default templates for all seven card types, seeded at series creation,
  editable afterward.
- **Theory** — a Card of type THEORY. Additional behavior: has `confidence`
  (int 1–5) and links to supporting/contradicting Cards via Relations.
  A theory's revealIndex defaults to the maximum revealIndex of the cards it
  cites. Because citations are Relations attached AFTER card creation,
  recompute this default on every relation attach/detach targeting a THEORY
  card, and surface a UI warning whenever the theory's stored revealIndex is
  below any cited card's — do not silently raise it.

## Calendar (per Series)

Fictional calendars require structure to be sortable. Do not parse strings.

- **Calendar** — `seriesId`, `name`, `epochLabel` (e.g. "Third Age"),
  `daysPerWeek`, `weekdayNames` (JSONB array).
- **CalendarEra** — `calendarId`, `name`, `order`, `yearOffset`, `abbreviation`
  (e.g. "TA"). Eras may be non-contiguous; `yearOffset` maps era-year →
  absolute year.
- **CalendarMonth** — `calendarId`, `name`, `order`, `dayCount`.
- **InWorldDate** — an embedded value, not a table. Stored as columns on any
  row that carries one (TimelineEntry; CardField values of type INWORLD_DATE
  store the same shape in JSONB): `eraId`, `year`, `monthOrder` (nullable),
  `day` (nullable), `precision` (YEAR | MONTH | DAY | UNKNOWN),
  `displayOverride` (nullable string, for named events like "the Long Winter").

`absoluteSortKey` is a **computed, persisted, indexed BIGINT**:

    absoluteYear = era.yearOffset + year
    absoluteSortKey = absoluteYear * 1_000_000
                    + (monthOrder ?? 0) * 10_000
                    + (day ?? 0)

Precision degrades gracefully: a YEAR-precision date sorts to the start of its
year. Entries with precision UNKNOWN carry a manual `manualSortKey` and are
grouped separately in the UI, never interleaved with dated entries.

`yearOffset` on an era is mutable, and changing it invalidates every
`absoluteSortKey` derived from it. Recomputation is a single transactional
service function (same pattern as `recomputeSeriesPositions`), with a test.

Rendering: a `formatInWorldDate(date, calendar)` function in `lib/calendar.ts`
produces "14th of Rethe, TA 3019" or "TA 3019" or the `displayOverride`. Pure
function, fully unit-tested.

Seed a complete fictional calendar (2 eras, 12 named months, 7 weekdays) in
`prisma/seed.ts` so the feature is demonstrable immediately.

## TimelineEntry

- `seriesId`, `cardId` (nullable), `label`, `description`, `revealSectionId`,
  `revealIndex`, the embedded InWorldDate columns, `absoluteSortKey`,
  `manualSortKey` (nullable, for UNKNOWN precision), `deletedAt`.

Note the two independent axes and do not conflate them: `revealIndex` is *when
the reader learns it*; `absoluteSortKey` is *when it happened in-world*. A
prophecy revealed early may describe an event 3000 years prior; a flashback in
the final section may be gated late but sort early. Gating uses revealIndex
exclusively. Ordering uses absoluteSortKey exclusively.

## Session (book club meeting)

- **Session** — `seriesId`, `title`, `scheduledAt` (nullable timestamp),
  `goalSectionId` (FK — the section the group should reach), cached
  `goalRevealIndex`, `notes` (RICHTEXT), `createdById`,
  `status` (UPCOMING | ACTIVE | COMPLETED), `deletedAt`.
- Created and edited by OWNER or EDITOR. Visible to all members regardless of
  their own progress — **a session goal is never gated.** Section titles,
  however, ARE gated: display "Book 2, Chapter 14" and suppress the section
  title if it is above the viewer's progress. Titles spoil.
- **SessionProgress** is derived, not stored: compare each member's
  `Membership.revealIndex` to the active session's `goalRevealIndex`.
- At most one Session per Series may hold status ACTIVE. Prisma cannot express
  a partial unique index in the schema DSL — write it as raw SQL in a
  migration. Do not fake it with application-level checks alone.
- Session `notes` are authored free-text and are NOT gated by revealIndex —
  the system cannot know what they contain. Warn the author in the UI at edit
  time that notes are visible to all members regardless of progress.

## The reveal-index cascade rule

When a Card's reveal point is raised, raise any of its CardFields and Relations
that would otherwise precede it (a field cannot be revealed before its card).
When lowered, do not cascade. Implement as a single transactional service
function with tests.

A Relation's effective visibility is `max(relation.revealIndex,
fromCard.revealIndex, toCard.revealIndex)` — an edge cannot be visible before
both its endpoints. Compute this in the visibility layer rather than trusting
the stored column, since either endpoint may be raised independently later.

A CardField of type CARD_REF follows the same rule: the field is invisible
unless BOTH the field's own reveal point AND the referenced card's reveal point
are at or below the viewer's progress. Rendering a gated card's title through a
reference is a leak.

## Invites and registration

The app is designed to be exposed on the public internet for a private group.
Therefore registration is CLOSED: there is no open signup page.

- **Invite** — `seriesId`, `code` (random, URL-safe, unguessable), `role`
  (EDITOR | READER — never OWNER), `createdById`, `expiresAt` (nullable),
  `maxUses` (nullable), `useCount`, `revokedAt` (nullable).
- OWNER (or EDITOR, for READER-role invites only) generates an invite link:
  `https://<host>/join/<code>`. Visiting it while logged out offers
  registration; while logged in, it adds the Series membership directly.
  Either path consumes one use.
- Registration is ONLY reachable through a valid invite link. The first
  account ever created (empty User table) bootstraps without an invite and is
  prompted to create the first Series as its OWNER.
- Invite management UI (list, revoke, copy link) lives in series settings.
- A new member's initial progress is the series start; a first-run prompt asks
  them to set their real position immediately after joining.
- Naming note: the Auth.js login session and the book-club Session entity are
  unrelated concepts — name the Prisma model `ClubSession` if needed to avoid
  collision.

## Deletion semantics

Soft delete throughout: every user-creatable entity (Card, CardField, Relation,
TimelineEntry, Session, TemplateField, Book, Section — subject to the Section
RESTRICT rule above) carries `deletedAt`. Default queries exclude soft-deleted
rows via the same central query-composition point as visibility. Hard delete
does not exist in the UI; a maintenance script may purge soft-deleted rows and
their revisions together. Revisions of a soft-deleted entity are retained.

# ACCESS CONTROL

Two orthogonal axes. Do not conflate them:

1. **Permission** (role-based): READER may read; EDITOR may create/edit cards,
   relations, timeline entries, sessions; OWNER may additionally edit
   templates, edit the calendar, manage members, and edit the book/section
   structure.
2. **Visibility** (progress-based): applies to everyone including OWNER, but
   OWNER and EDITOR get a "spoiler peek" toggle that temporarily lifts the gate
   for their session — because they must be able to author gated content. The
   toggle must be visually unmistakable (persistent banner, distinct color).
   READER has no such toggle, ever.

A member's progress is settable only by that member (or by an OWNER lowering
it). No one may raise another member's progress — it is a claim about what they
have read, not a permission grant.

# ARCHITECTURE REQUIREMENTS

- All gated reads flow through a single module: `lib/visibility.ts`, exporting
  a function that produces the Prisma `where` clause fragment for a given
  (userId, seriesId) context — covering both the reveal gate and the
  soft-delete filter. Every query for gateable content composes this fragment.
  No exceptions.
- A "spoiler peek" is a flag on the request context that this module reads —
  it must not be plumbed through every call site.
- Every list endpoint is paginated (cursor-based, default page size 50). No
  unbounded queries. The graph endpoint may cap at a configurable node limit
  with a UI notice.
- Include a test suite `lib/visibility.test.ts` (assertions enumerated below).
- Write an integration test that seeds two users at different progress points
  and asserts their API payloads differ correctly.

# UI/UX DIRECTION

Professional and modern, with restrained playfulness. Concretely:

- Not a generic Tailwind admin dashboard. Not a corporate SaaS gradient.
- Typography carries the personality: a distinctive display face for headings
  (pick one, justify it), a highly readable sans for body, and tabular figures
  for indices.
- Card types get distinct, deliberate colors — a considered palette, not the
  Tailwind default swatches.
- Reading-position UI is a first-class, always-visible element in the shell,
  not buried in settings. It is the app's defining mechanic; make it feel like
  one. The control presents Sections by their display label ("Book 2 ·
  Part III · Chapter 14", "Book 2 · Interlude 2"), with gated Section and
  Part titles suppressed.
- The active session's goal is displayed persistently in the app shell,
  adjacent to the user's own reading-position control, so the relationship
  between "where I am" and "where I should be" is always legible.
- The reading-position control offers a one-click "jump to session goal".
- A session view shows a roster of members with an at-a-glance state:
  behind / at goal / ahead. Show state only — never another member's exact
  position, which is their business.
- Dark mode required, and it should be the default.

## Locked placeholders

- Gated content renders as a **locked placeholder**: uniform grey card, lock
  icon, and NOTHING else. No title, no type color, no summary, no icon
  variant. The server sends only `{ id, locked: true }` for gated cards — the
  redaction happens in `lib/visibility.ts`, not in the component. A component
  that receives full data and chooses not to render it is a failure.
- Locked placeholders are not clickable and expose no tooltip.
- The count of locked cards is inherently visible (they occupy grid slots).
  This is an accepted, deliberate leak: existence and count are disclosed,
  content and identity are not.
- Locked placeholders appear in: card grid/list views only. They do NOT appear
  in the graph (no phantom nodes), in search results, or in relation boards —
  those views omit gated content entirely, because a locked node's *position*
  in a graph or its *adjacency* leaks structure.
- Card list ordering must not be a side channel. If the list is sorted by any
  gated attribute (title, type, date), a locked card's slot position leaks
  that attribute. Sort lists containing locked placeholders by `revealIndex`
  then `id`, or segregate locked placeholders into a trailing group. Never
  interleave them under a content-derived sort.

## Timeline view

- The axis is **clamped** to the user's `revealIndex`. The user cannot scroll,
  zoom, or pan past their progress — the timeline terminates in a visible,
  styled "your progress" boundary marker.
- Clamping is enforced server-side: the query never returns entries above the
  user's progress, so there is nothing client-side to reveal via devtools.
- The active session's `goalRevealIndex` is drawn as a second, distinct marker
  on the axis — visible even when it is ahead of the user's progress (since
  the goal itself is not gated), but no entries between the two are returned.
- Note that the axis is in-world time while `revealIndex` is narrative time,
  so the clamp boundary is not a single clean cut on the axis — it is a filter
  on which entries exist. Render the boundary marker as a legend/state
  indicator rather than pretending it is an axis position, unless the two
  happen to align.
- Use vis-timeline. Feed it the computed `absoluteSortKey` as the time axis
  and override the axis label formatter to render in-world dates via
  `formatInWorldDate`. Do NOT attempt to map the fictional calendar onto real
  Date objects. If vis-timeline cannot accept a plain integer axis, implement
  a custom axis rather than coercing in-world dates into `Date`; say so
  explicitly in PHASES.md rather than silently substituting real dates.

## Search

Search scope is deliberately narrow: Postgres full-text over Card `title` and
`summary` ONLY, gated at the card level (one revealIndex per row, so a
precomputed tsvector is safe). Do NOT index CardField values, relation notes,
or rich text bodies — per-field gating cannot be reconciled with precomputed
per-row vectors, and a match against a gated field leaks that the term exists.
State this limitation in the README. Field-content search is out of scope.

# PHASING

Build Phase 1 completely and correctly. Scaffold Phases 2 and 3 with real
routes, real components, and honest TODOs — never with fake data or stub UI
that implies function it lacks.

**Phase 1 — build fully:**
- Docker Compose (dev + prod profiles) + Dockerfile + Prisma schema +
  migrations (including the raw-SQL partial unique index) + seed script
- Auth (invite-gated register, login, session) + first-account bootstrap
- Invite creation, join flow (`/join/<code>`), invite management UI
- Series/Book/Section CRUD (OWNER), including `recomputeSeriesPositions` and
  mid-series insertion
- Membership + progress setting UI
- Card CRUD driven by Templates, with per-field reveal-point assignment
- Relation CRUD with type + weight
- Calendar schema + seed + `formatInWorldDate` + structured date entry
- Session CRUD + shell display of active session goal
- Soft delete + restore for cards, relations, timeline entries
- Revision writes (gated) — browser UI deferred
- `lib/visibility.ts` + full test suite
- Card list (with locked placeholders) + card detail views
- Default template seeding for all seven types

**Phase 2 — build functionally, polish minimally:**
- Knowledge graph view (Cytoscape, fcose layout, weight → edge thickness, card
  type → node color, click node → card detail panel, filter by type,
  degree-based node sizing, node cap with notice)
- Timeline board (in-world axis, clamped, session goal marker)
- Relations board (matrix or grouped list view of a card's edges)
- Search (title + summary, gated)

**Phase 3 — scaffold with working routes and TODOs:**
- Template editor UI (data model and seeding must be real in Phase 1; only the
  visual editor is deferred)
- Visual calendar editor (schema and seed are real in Phase 1)
- Revision history browser (reads must already be gated in Phase 1)
- Session roster analytics
- REST API: `/api/v1/*`, token auth, gated identically to the UI
- Export/import (JSON)

# DELIVERABLES

1. `README.md` — setup in under five commands, architecture overview, the
   visibility invariant explained (including the two permitted disclosures and
   the search-scope limitation), and a DEPLOYMENT section with three concrete,
   tested-in-principle paths: (a) VPS with Docker Compose prod profile + Caddy
   + a domain (primary, fully step-by-step: provision, DNS, `.env`, compose
   up, migrate, seed-or-bootstrap, backup via nightly `pg_dump` cron);
   (b) home server behind Cloudflare Tunnel or Tailscale; (c) Vercel + a
   managed Postgres (note what changes: no compose, `DATABASE_URL` from the
   provider). Include an "inviting your book club" walkthrough: bootstrap
   account → create series → generate invite links → members join and set
   progress.
2. `docker-compose.yml`
3. `prisma/schema.prisma` + migrations + `prisma/seed.ts` — seed a fictional
   3-book series where at least one book is divided into Parts, including a
   prologue, two numbered interludes sitting between Parts, and an epilogue;
   ~25
   cards spanning a wide reveal range; a complete fictional calendar; timeline
   entries whose in-world order deliberately diverges from their reveal order;
   one ACTIVE session with a goal; and 3 users at different progress points,
   so the gate is immediately demonstrable.
4. Full Next.js app per the phasing above
5. Test suite
6. `PHASES.md` — what is done, what is scaffolded, what is next, with file
   pointers, plus any deviations forced by library constraints.

# TEST SUITE REQUIREMENTS

`lib/visibility.test.ts` must assert:

- A locked card payload contains ONLY `{ id, locked }` — the test must fail if
  any other key is present.
- Locked cards are absent from graph, search, and relation payloads.
- A field gated above the viewer's progress is absent from a card detail
  response whose parent card is visible.
- A relation is invisible when either endpoint card is gated, even if the
  relation's own revealIndex is below the viewer's progress.
- A CARD_REF field is invisible when its referenced card is gated, even if the
  field's own reveal point has passed.
- A revision diff is never returned when its `revealIndex` exceeds the
  viewer's progress.
- A timeline query clamps to the viewer's revealIndex even when an explicit
  range parameter requests a later window.
- A session's `goalRevealIndex` is returned to a member whose progress is
  below it, while the corresponding section's `title` is not.
- Spoiler peek lifts the gate for EDITOR and OWNER and does not exist for
  READER (a READER request carrying the peek flag is rejected, not honored).
- Raising a card's reveal point raises its fields and relations; lowering does
  not cascade.
- Inserting a Section mid-series recomputes positions and every dependent
  `revealIndex`, and previously-gated content remains gated at the same
  Section.
- Changing an era's `yearOffset` recomputes every dependent `absoluteSortKey`.
- Soft-deleted rows are excluded from all default reads and from search.
- A revoked, expired, or exhausted invite code is rejected at both
  registration and join, and registration is unreachable without a valid code
  (except the first-account bootstrap).

Additionally, an integration test seeds two users at different progress points
and asserts their API payloads differ correctly.

# CONSTRAINTS

- No localStorage-only persistence. Postgres is the source of truth.
- No client-side gating. Ever.
- No `any`. TypeScript strict.
- No component over ~200 lines; extract.
- No barrel-file re-export chains.
- Do not invent library APIs. If unsure of a Cytoscape, vis-timeline, or
  Tiptap API, use the most conservative documented approach.
- Do not use `dangerouslySetInnerHTML` on user content; render Tiptap JSON.
- Ask no clarifying questions. Where genuinely ambiguous, choose the option
  that better protects the invariant, and note the choice in PHASES.md.
