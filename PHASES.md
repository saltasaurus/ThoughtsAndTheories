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

## Phase 2 — done

All four Phase 2 features are built on top of the Phase-1 gated data cores.
Verified: `tsc --noEmit` clean, `npm test` 43/43, `next build` green.

- **Knowledge graph** — `components/graph/graph-view.tsx` (Cytoscape + fcose)
  over `graphData()`. Card type → node color (theme CSS vars, dark/light
  aware), relation weight → edge thickness, degree → node size, directed edges
  get arrowheads, client-side type filter, node-cap notice, click → detail
  panel listing a node's visible connections. Gated cards omitted — no phantom
  nodes. Page: `app/series/[seriesId]/graph/`.
- **Timeline board** — `components/timeline/timeline-board.tsx` over the
  clamped `listTimeline()`. Custom in-world axis (see deviation 18) positioning
  dated entries by `absoluteSortKey`, lane-stacked, in-world date labels via
  `formatInWorldDate`, click-through to cards. Progress + session-goal shown as
  legend/state indicators, not axis positions. The list view remains below as
  an accessible fallback and holds the UNKNOWN-precision group.
- **Relations board** — `app/series/[seriesId]/cards/[cardId]/relations/`,
  grouping a card's visible edges by type with direction + weight bars, over
  `listRelationsForCard()`. Linked from card detail. Both endpoints must be
  visible, so gated relations are omitted.
- **Search** — upgraded from Phase-1 `ILIKE` to Postgres full-text over a
  precomputed, GIN-indexed `searchVector` (`searchCards` in
  `lib/visibility.ts`, raw SQL + `websearch_to_tsquery`). Title + summary only,
  gate + soft-delete + keyset cursor preserved. See deviation 19.

## Phase 3 — done

All six spec areas built on the Phase-1 gated cores. Verified: `tsc --noEmit`
clean (strict, no `any`), `npm test` 118/118, `next build` green, new migration
applied.

| Area | Where |
|---|---|
| Template editor: add/edit/reorder/retire/restore fields for all 7 types, with `fieldType` immutability + choice-removal guards and app-enforced `(templateId, key)` uniqueness | `lib/services/templates.ts`, `app/actions/templates.ts`, `app/series/[seriesId]/templates/` |
| Calendar editor: create calendar (one per series), edit week config, add/rename eras + months, delete with referential guards; era-offset edits recompute every sort key in one transaction | `lib/services/calendar-admin.ts`, `app/actions/calendar.ts`, `app/series/[seriesId]/calendar/` |
| Revision history browser: chronological card + field diffs, gated by the same `listRevisions` snapshot rule | `app/series/[seriesId]/cards/[cardId]/history/` |
| Session roster analytics: aggregate state counts against the active goal | `getRosterAnalytics` in `lib/services/memberships.ts`, `app/series/[seriesId]/sessions/` |
| REST API v1: token auth, reads (cards/detail/graph/timeline/search) + writes (create/update/set-field), gated through the same `lib/visibility.ts` functions the UI uses | `lib/api.ts`, `lib/services/api-tokens.ts`, `app/api/v1/**`, `app/actions/tokens.ts` |
| `ApiToken` model + migration; token create (shown once) / revoke UI | `prisma/migrations/*_add_api_token/`, `app/series/[seriesId]/settings/` |
| JSON export/import: whole-series export, import-as-new-series in one transaction with full FK remap and derived-value recompute | `lib/services/export-import.ts`, `app/series/[seriesId]/export/route.ts`, `app/actions/export-import.ts` |

Tests: `lib/services/templates.test.ts`, `lib/services/calendar-admin.test.ts`,
`tests/phase3.test.ts`, `tests/api-v1.test.ts`, `tests/export-import.test.ts`,
`tests/hardening.test.ts`.

### Hardening round (post-build adversarial review)

Same shape as Phase 1's: 3 independent finder lenses (spoiler-leak,
auth/permissions, data integrity), every finding verified against the code
before it was fixed, regression test per confirmed finding in
`tests/hardening.test.ts`. Confirmed and fixed:

1. **critical** — `exportSeries` emitted files its own `parseSeriesExport`
   rejected. The recursive JSON schema was typed against
   `Prisma.InputJsonValue`, which deliberately excludes `null`, but every
   `INWORLD_DATE` value carries nulls (`eraId`/`monthOrder`/`day`/
   `displayOverride`) and `INWORLD_DATE` is in the default EVENT template. Any
   series with an in-world date produced an unrestorable backup. Fix: `z.null()`
   in the union, with a `JsonLike` type that models the file rather than the
   Prisma write type.
2. **major** — the card-list `type` filter was applied *before* the reveal gate,
   so locked placeholders were type-filtered too. Differencing the type tabs
   recovered the type — and per-type count — of every card above the viewer's
   progress, from the plain web UI. Fix: the filter applies to the visible
   branch only; the locked set is identical on every tab.
3. **major** — the template `fieldType`-immutability and choice-removal guards
   ignored values on soft-deleted cards, but `restoreCard` re-validates nothing.
   Soft-delete → retype → restore produced exactly the malformed state the
   guards exist to prevent. Fix: guards (and the UI's "locked" hint) count
   values on soft-deleted cards.
4. **major** — `deleteEra` is a hard delete and `TimelineEntry.eraId` is
   `ON DELETE SET NULL`, but the in-use check skipped soft-deleted entries. A
   restorable entry could have its era silently nulled while keeping a stale
   `absoluteSortKey` that `recomputeCalendarSortKeys` (an inner join) could
   never repair. Fix: soft-deleted entries count as in use.
5. **major** — `deleteEra`/`deleteMonth` ignored `INWORLD_DATE` **card field**
   values, which embed `eraId`/`monthOrder` in JSON with no FK behind them.
   Deleting an "unused" era silently re-dated cards. Fix: both checks also count
   matching card-field values.
6. **minor** — `importSeriesAction` authenticated but never authorized; the
   OWNER-only Export/Import panel is a rendering rule, and a Server Action is a
   POST endpoint. Not an escalation (import always creates a new series), but
   the guard belonged there. Fix: `getRequestViewer` + `requireOwner`.
7. **minor** — `jumpToGoalAction` queried `ClubSession` on an unvalidated
   `seriesId` *before* any membership check, and `runAndRedirect` reflected the
   distinguishing message into the URL — a "does this series exist and is it
   running a session" oracle for any logged-in user, defeating `getViewer`'s
   deliberate 404. Fix: resolve membership first.
8. **minor** — the API `errorResponse` catch-all swallowed Next's `redirect()`
   (implemented as a thrown `NEXT_REDIRECT`), turning a login bounce on the
   export URL into a 500. Fix: re-throw framework control-flow errors.
9. **minor** — the one-time new-token cookie was scoped `path: "/"`, so the
   plaintext token rode along on every request to the origin and re-rendered on
   every *other* series' settings page. Fix: scoped to the page that displays it.
10. **minor** — duplicate `key`s in an import file passed the shape schema but
    silently made every reference resolve to whichever row came last. Fix:
    uniqueness assertion inside `parseSeriesExport`, so "malformed" still means
    "fails validation".
11. **major** — the roster paired a member's *name* with a "behind / at goal /
    ahead" comparison against the ACTIVE session's goal, and an EDITOR may
    retarget that goal freely. One observation is harmless; repeating it
    binary-searches any member's exact reading position in ~log₂(sections)
    reloads — the same comparison oracle Phase 1's hardening closed for
    `lowerMemberProgress` (item 4 there), handed to a lower role through a
    cleaner interface. Granularity was never the issue: ANY per-name comparison
    against a movable threshold is searchable, so coarsening the badge would
    have fixed nothing. Resolved by product decision (see deviation 28): goals
    stay freely movable — the more useful capability — and the per-member badge
    is removed. `listMembers` now returns identity and role only; pacing is
    reported by the aggregate `getRosterAnalytics`, which names nobody.

Refuted after investigation (recorded so they aren't re-litigated): API payloads
never exceed what the UI's own visibility functions return; the history page's
queried entity-id set, ordering and empty state disclose nothing; gated,
missing and other-series cards all collapse to an identical 404; `maxRevealIndex`
is intersected with the viewer's progress and can only narrow; peek is
unreachable from the API (hardcoded `false`, and `PEEK_COOKIE` is read only by
the cookie path); every id-taking service function constrains to
`viewer.seriesId`; and `importSeries` remaps all 12 FK families with no path
that leaves a pointer into the source series.

Nothing is left knowingly unfixed. The one finding that required a product
decision rather than a patch — the roster position oracle — was decided in
favour of keeping goals movable and dropping the per-member badge; see hardening
item 11 and deviation 28.

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
18. **(Phase 2) Custom timeline axis instead of vis-timeline.** vis-timeline
    models its axis as real JS `Date`s and cannot accept a plain integer/bigint
    axis. Per SPEC's explicit instruction ("implement a custom axis rather than
    coercing in-world dates into `Date`; say so explicitly in PHASES.md"), the
    board is a hand-built axis driven by `absoluteSortKey`, with in-world date
    labels via `formatInWorldDate`. No fictional date is ever mapped to a real
    `Date`. `vis-timeline` is therefore not a dependency.
19. **(Phase 2) Search vector is a trigger-maintained column, not `GENERATED`.**
    A `GENERATED ALWAYS AS … STORED` column is the tidier SQL, but Prisma cannot
    represent the generated expression, so it reports perpetual drift and tries
    to drop it on every `migrate dev`. A plain `tsvector` column kept current by
    a `BEFORE INSERT OR UPDATE` trigger is invisible to Prisma (schema:
    `Unsupported("tsvector")?`), so there is no drift. Same auto-maintenance,
    portable, and `migrate status` stays clean. Migration:
    `prisma/migrations/20260720072500_add_search_vector/`.
20. **(Phase 3) The template editor edits fields, not card types.** `CardType`
    is a Prisma enum of 7 fixed values; adding one is a schema migration, not a
    UI action. The editor adds/edits/reorders/retires *fields* within the seven
    existing templates. `TemplateField.key` is immutable after creation (it is
    the stable identifier); `fieldType` and SELECT/MULTISELECT `options` are
    mutable only while no stored value would be invalidated.
21. **(Phase 3) Months are append-only and never renumbered.** Timeline entries
    store the raw integer `monthOrder`, not an FK, so reordering or renumbering
    months would silently re-date every stored entry. Months support add
    (append), rename, and guarded delete; `order` is fixed at creation, and
    survivors keep their values (gaps are fine) when one is deleted.
22. **(Phase 3) API tokens are hashed with SHA-256, not bcrypt.** bcrypt suits
    passwords because the email is the lookup key and the secret is
    low-entropy. A bearer token has neither property: there is no lookup key but
    the token itself, and a salted hash cannot be queried, forcing a full-table
    compare on every request. Tokens are 256 bits of `randomBytes`, so an
    unsalted fast hash loses nothing and makes `findUnique({ tokenHash })` work.
    Tokens are scoped to a USER (carrying exactly that user's memberships and
    reading position) and never carry spoiler peek.
23. **(Phase 3) API card detail 404s a gated card rather than returning a
    placeholder.** Locked placeholders exist only in *list* views, matching
    `getCardDetail`'s `null`. Gated, nonexistent and other-series cards all
    return an identical 404, so the status code is not an existence oracle.
24. **(Phase 3) Roster analytics are aggregate-only and active-session-only.**
    Memberships are not revisioned (deviation 16 bounds revisions to
    Card/CardField), so no historical position data exists. A "per-past-session"
    breakdown computed from *current* positions against old goals would be a
    monotone artifact — everyone drifts to "ahead" as they read on — so it is
    cut rather than shipped as pseudo-history.
25. **(Phase 3) Export is OWNER-only and deliberately ungated; import always
    creates a NEW series.** Export reads through unredacted reads, not
    `lib/visibility.ts` — it is a backup tool at the same trust level as direct
    DB access. It excludes `Membership`, sessions, reading positions and
    `Invite` (instance-specific) and `Revision` (its `userId` FKs name users
    that do not exist on the target instance, and no admin path may leak
    diffs). Import never merges into an existing series, runs in one
    transaction, reassigns `Card.createdById` to the importer, and creates the
    importer's OWNER membership — without one, `getViewer` throws for everyone
    and the imported series would be unreachable.
26. **(Phase 3) Import does not call `createSeries`.** That helper seeds the
    seven default templates, which would collide with the file's own templates
    on `@@unique([seriesId, cardType])`. The `Series` row and OWNER membership
    are written directly inside the import transaction instead.
27. **(Phase 3) Derived values are omitted from the export file and recomputed
    on load.** `Section.position`, every cached `revealIndex`, and
    `TimelineEntry.absoluteSortKey` (a `BigInt`, which `JSON.stringify` throws
    on outright) are rebuilt by `recomputeSeriesPositions` and
    `recomputeCalendarSortKeys` inside the same transaction, from the FKs that
    are the source of truth. API responses serialise `BigInt` as a decimal
    string for the same reason.
28. **(Phase 3) The roster shows no per-member progress state — a deliberate
    departure from SPEC.** SPEC asks for per-member "behind / at goal / ahead"
    badges. Shipping that alongside an EDITOR-settable session goal makes every
    member's exact position binary-searchable by repeated observation (hardening
    item 11), which the same spec forbids ("never a name paired with a
    position"). The two requirements cannot both hold: a per-name comparison
    against a threshold the observer controls is searchable at any granularity.
    Given the choice, freely retargetable goals are the more useful capability
    for running a book club, so the badge is dropped and pacing is reported in
    aggregate (`getRosterAnalytics`: counts of behind/at-goal/ahead, naming
    nobody). `listMembers` returns identity and role only, and a regression test
    asserts it stays invariant as the goal moves.
