/**
 * THE visibility layer. Every read of gateable content composes its fragments.
 * No exceptions. Content is visible iff revealIndex <= viewer.revealIndex,
 * soft-deleted rows are always excluded, and "spoiler peek" (OWNER/EDITOR only)
 * lifts the reveal gate — never the soft-delete filter.
 */
import type { CardType, Prisma, RevisionEntityType, Role, SectionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError, PeekForbiddenError } from "@/lib/errors";
import { sectionLabel } from "@/lib/section-label";

export type Viewer = {
  userId: string;
  seriesId: string;
  role: Role;
  revealIndex: number;
  peek: boolean;
};

/**
 * Build the viewer context from a membership. A READER requesting peek is
 * rejected outright — the flag is never silently ignored.
 */
export async function getViewer(
  userId: string,
  seriesId: string,
  peekRequested = false,
): Promise<Viewer> {
  const membership = await prisma.membership.findUnique({
    where: { userId_seriesId: { userId, seriesId } },
  });
  if (!membership) throw new NotFoundError("Not a member of this series");
  if (peekRequested && membership.role === "READER") throw new PeekForbiddenError();
  return {
    userId,
    seriesId,
    role: membership.role,
    revealIndex: membership.revealIndex,
    peek: peekRequested,
  };
}

export type GateFragment = { deletedAt: null; revealIndex?: { lte: number } };

/** Reveal gate + soft-delete filter, as a spreadable Prisma where fragment. */
export function gateWhere(viewer: Viewer): GateFragment {
  return viewer.peek
    ? { deletedAt: null }
    : { deletedAt: null, revealIndex: { lte: viewer.revealIndex } };
}

/** Soft-delete filter alone, for non-gated soft-deletable rows (books, parts…). */
export function notDeleted(): { deletedAt: null } {
  return { deletedAt: null };
}

/**
 * A relation's effective visibility is max(edge, fromCard, toCard) — computed
 * against the live endpoint columns, not the edge's stored copy.
 */
export function relationWhere(viewer: Viewer): Prisma.CardRelationWhereInput {
  return {
    ...gateWhere(viewer),
    fromCard: gateWhere(viewer),
    toCard: gateWhere(viewer),
  };
}

// ---------- card list with locked placeholders ----------

export type LockedCard = { id: string; locked: true };
export type VisibleCardSummary = {
  locked: false;
  id: string;
  type: CardType;
  title: string;
  summary: string | null;
  confidence: number | null;
  revealIndex: number;
};
export type CardListItem = LockedCard | VisibleCardSummary;

const PAGE_SIZE = 50;

/**
 * Card grid/list: visible cards in full, gated cards as { id, locked: true }
 * and NOTHING else. Sorted by (revealIndex, id) — never a content-derived sort,
 * which would leak the gated attribute through slot position.
 */
export async function listCards(
  viewer: Viewer,
  opts: { type?: CardType; cursor?: string; pageSize?: number } = {},
): Promise<{ items: CardListItem[]; nextCursor: string | null }> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const rows = await prisma.card.findMany({
    where: {
      seriesId: viewer.seriesId,
      deletedAt: null,
      ...(opts.type ? { type: opts.type } : {}),
    },
    orderBy: [{ revealIndex: "asc" }, { id: "asc" }],
    take: pageSize + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, pageSize);
  const items: CardListItem[] = page.map((card) =>
    viewer.peek || card.revealIndex <= viewer.revealIndex
      ? {
          locked: false,
          id: card.id,
          type: card.type,
          title: card.title,
          summary: card.summary,
          confidence: card.confidence,
          revealIndex: card.revealIndex,
        }
      : { id: card.id, locked: true },
  );
  const last = page[page.length - 1];
  return { items, nextCursor: rows.length > pageSize && last ? last.id : null };
}

// ---------- card detail ----------

export type CardFieldView = {
  id: string;
  templateFieldId: string;
  key: string;
  label: string;
  fieldType: string;
  options: unknown;
  value: unknown;
  revealIndex: number;
  revealSectionId: string;
};

export type RelationView = {
  id: string;
  type: string;
  weight: number;
  directed: boolean;
  notes: string | null;
  revealIndex: number;
  revealSectionId: string;
  fromCard: { id: string; title: string; type: CardType };
  toCard: { id: string; title: string; type: CardType };
};

export type CardDetail = {
  id: string;
  type: CardType;
  title: string;
  summary: string | null;
  confidence: number | null;
  revealIndex: number;
  revealSectionId: string;
  createdById: string;
  fields: CardFieldView[];
  relations: RelationView[];
};

function cardRefId(value: unknown): string | null {
  if (typeof value === "object" && value !== null && "cardId" in value) {
    const id = (value as { cardId: unknown }).cardId;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/**
 * Card detail. Returns null when the card itself is gated (detail views have no
 * placeholder — placeholders exist only in list views). Fields gate
 * independently of the card; CARD_REF fields additionally require the
 * referenced card to be visible.
 */
export async function getCardDetail(viewer: Viewer, cardId: string): Promise<CardDetail | null> {
  const card = await prisma.card.findFirst({
    where: { id: cardId, seriesId: viewer.seriesId, ...gateWhere(viewer) },
    include: {
      fields: {
        where: { ...gateWhere(viewer), templateField: { deletedAt: null } },
        include: { templateField: true },
        orderBy: { templateField: { order: "asc" } },
      },
    },
  });
  if (!card) return null;

  // CARD_REF double gate: the field is invisible unless the referenced card is
  // also visible — rendering a gated card's title through a reference is a leak.
  const refIds = card.fields
    .filter((f) => f.templateField.fieldType === "CARD_REF")
    .map((f) => cardRefId(f.value))
    .filter((id): id is string => id !== null);
  const visibleRefIds = new Set(
    refIds.length === 0
      ? []
      : (
          await prisma.card.findMany({
            where: { id: { in: refIds }, seriesId: viewer.seriesId, ...gateWhere(viewer) },
            select: { id: true },
          })
        ).map((c) => c.id),
  );

  const fields: CardFieldView[] = card.fields
    .filter((f) => {
      if (f.templateField.fieldType !== "CARD_REF") return true;
      const ref = cardRefId(f.value);
      return ref !== null && visibleRefIds.has(ref);
    })
    .map((f) => ({
      id: f.id,
      templateFieldId: f.templateFieldId,
      key: f.templateField.key,
      label: f.templateField.label,
      fieldType: f.templateField.fieldType,
      options: f.templateField.options,
      value: f.value,
      revealIndex: f.revealIndex,
      revealSectionId: f.revealSectionId,
    }));

  return {
    id: card.id,
    type: card.type,
    title: card.title,
    summary: card.summary,
    confidence: card.confidence,
    revealIndex: card.revealIndex,
    revealSectionId: card.revealSectionId,
    createdById: card.createdById,
    fields,
    relations: await listRelationsForCard(viewer, card.id),
  };
}

/** Relations touching a card — both endpoints must be visible (omitted, never placeholdered). */
export async function listRelationsForCard(viewer: Viewer, cardId: string): Promise<RelationView[]> {
  const relations = await prisma.cardRelation.findMany({
    where: {
      OR: [{ fromCardId: cardId }, { toCardId: cardId }],
      ...relationWhere(viewer),
    },
    include: {
      fromCard: { select: { id: true, title: true, type: true } },
      toCard: { select: { id: true, title: true, type: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return relations.map((r) => ({
    id: r.id,
    type: r.type,
    weight: r.weight,
    directed: r.directed,
    notes: r.notes,
    revealIndex: r.revealIndex,
    revealSectionId: r.revealSectionId,
    fromCard: r.fromCard,
    toCard: r.toCard,
  }));
}

// ---------- revisions (gated content — diffs contain gated values) ----------

export async function listRevisions(
  viewer: Viewer,
  entityType: RevisionEntityType,
  entityId: string,
  opts: { cursor?: string; pageSize?: number } = {},
): Promise<{
  items: Array<{ id: string; userId: string; diff: unknown; revealIndex: number; createdAt: Date }>;
  nextCursor: string | null;
}> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  // Revisions carry no seriesId — scope through the entity's parent. An
  // entityId outside the viewer's series returns nothing; revealIndex is a
  // per-series axis and must never be compared across series. (Soft-deleted
  // entities keep their revisions per spec, so no deletedAt filter here.)
  const inSeries =
    entityType === "CARD"
      ? await prisma.card.findFirst({
          where: { id: entityId, seriesId: viewer.seriesId },
          select: { id: true },
        })
      : await prisma.cardField.findFirst({
          where: { id: entityId, card: { seriesId: viewer.seriesId } },
          select: { id: true },
        });
  if (!inSeries) return { items: [], nextCursor: null };
  const rows = await prisma.revision.findMany({
    where: {
      entityType,
      entityId,
      ...(viewer.peek ? {} : { revealIndex: { lte: viewer.revealIndex } }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, pageSize);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.id,
      userId: r.userId,
      diff: r.diff,
      revealIndex: r.revealIndex,
      createdAt: r.createdAt,
    })),
    nextCursor: rows.length > pageSize && last ? last.id : null,
  };
}

// ---------- timeline (revealIndex gates; absoluteSortKey orders) ----------

export type TimelineEntryView = {
  id: string;
  cardId: string | null;
  label: string;
  description: string | null;
  revealIndex: number;
  eraId: string | null;
  year: number | null;
  monthOrder: number | null;
  day: number | null;
  precision: string;
  displayOverride: string | null;
  absoluteSortKey: bigint | null;
  manualSortKey: number | null;
};

/**
 * Clamped server-side: any requested revealIndex window is intersected with the
 * viewer's progress — a range parameter can narrow, never widen.
 */
export async function listTimeline(
  viewer: Viewer,
  opts: {
    maxRevealIndex?: number;
    fromSortKey?: bigint;
    toSortKey?: bigint;
    cursor?: string;
    pageSize?: number;
  } = {},
): Promise<{ dated: TimelineEntryView[]; undated: TimelineEntryView[]; nextCursor: string | null }> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const ceiling = viewer.peek
    ? opts.maxRevealIndex
    : Math.min(viewer.revealIndex, opts.maxRevealIndex ?? Number.MAX_SAFE_INTEGER);
  const revealFilter = ceiling === undefined ? {} : { revealIndex: { lte: ceiling } };

  const dated = await prisma.timelineEntry.findMany({
    where: {
      seriesId: viewer.seriesId,
      deletedAt: null,
      ...revealFilter,
      absoluteSortKey: {
        not: null,
        ...(opts.fromSortKey !== undefined ? { gte: opts.fromSortKey } : {}),
        ...(opts.toSortKey !== undefined ? { lte: opts.toSortKey } : {}),
      },
    },
    orderBy: [{ absoluteSortKey: "asc" }, { id: "asc" }],
    take: pageSize + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  // UNKNOWN-precision entries are grouped separately, never interleaved.
  const undated = await prisma.timelineEntry.findMany({
    where: {
      seriesId: viewer.seriesId,
      deletedAt: null,
      ...revealFilter,
      absoluteSortKey: null,
    },
    orderBy: [{ manualSortKey: "asc" }, { id: "asc" }],
  });

  const view = (e: (typeof dated)[number]): TimelineEntryView => ({
    id: e.id,
    cardId: e.cardId,
    label: e.label,
    description: e.description,
    revealIndex: e.revealIndex,
    eraId: e.eraId,
    year: e.year,
    monthOrder: e.monthOrder,
    day: e.day,
    precision: e.precision,
    displayOverride: e.displayOverride,
    absoluteSortKey: e.absoluteSortKey,
    manualSortKey: e.manualSortKey,
  });
  const page = dated.slice(0, pageSize);
  const last = page[page.length - 1];
  return {
    dated: page.map(view),
    undated: undated.map(view),
    nextCursor: dated.length > pageSize && last ? last.id : null,
  };
}

// ---------- sections & session goals (structure is never gated; titles are) ----------

export function gateSectionTitle(
  viewer: Viewer,
  section: { position: number; title: string | null },
): string | null {
  return viewer.peek || section.position <= viewer.revealIndex ? section.title : null;
}

export type SessionView = {
  id: string;
  title: string;
  scheduledAt: Date | null;
  status: string;
  notes: unknown;
  goalRevealIndex: number;
  goalSection: {
    id: string;
    label: string;
    /** null when the section title is above the viewer's progress — titles spoil */
    title: string | null;
  };
};

type SessionRow = {
  id: string;
  title: string;
  scheduledAt: Date | null;
  status: string;
  notes: unknown;
  goalRevealIndex: number;
  goalSection: {
    id: string;
    type: SectionType;
    number: number | null;
    title: string | null;
    position: number;
    book: { order: number };
    part: { number: number } | null;
  };
};

function toSessionView(viewer: Viewer, session: SessionRow): SessionView {
  return {
    id: session.id,
    title: session.title,
    scheduledAt: session.scheduledAt,
    status: session.status,
    notes: session.notes,
    goalRevealIndex: session.goalRevealIndex,
    goalSection: {
      id: session.goalSection.id,
      label: sectionLabel(session.goalSection, {
        book: session.goalSection.book,
        part: session.goalSection.part,
      }),
      title: gateSectionTitle(viewer, session.goalSection),
    },
  };
}

const sessionInclude = {
  goalSection: {
    select: {
      id: true,
      type: true,
      number: true,
      title: true,
      position: true,
      book: { select: { order: true } },
      part: { select: { number: true } },
    },
  },
} as const;

/** Sessions are visible to all members regardless of progress — a goal is never gated. */
export async function listSessions(viewer: Viewer): Promise<SessionView[]> {
  const sessions = await prisma.clubSession.findMany({
    where: { seriesId: viewer.seriesId, deletedAt: null },
    include: sessionInclude,
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
  });
  return sessions.map((s) => toSessionView(viewer, s));
}

export async function getActiveSession(viewer: Viewer): Promise<SessionView | null> {
  const session = await prisma.clubSession.findFirst({
    where: { seriesId: viewer.seriesId, status: "ACTIVE", deletedAt: null },
    include: sessionInclude,
  });
  return session ? toSessionView(viewer, session) : null;
}

// ---------- section picker (structure is never gated; titles are) ----------

export type SectionOption = {
  id: string;
  position: number;
  /** "Book 2 · Part III · Chapter 14" — derived, never gated */
  label: string;
  /** gated: null when above the viewer's progress */
  title: string | null;
};

/** Every section of the series, in reading order, titles suppressed above progress. */
export async function listSectionOptions(viewer: Viewer): Promise<SectionOption[]> {
  const sections = await prisma.section.findMany({
    where: { book: { seriesId: viewer.seriesId }, deletedAt: null },
    orderBy: { position: "asc" },
    select: {
      id: true,
      type: true,
      number: true,
      title: true,
      position: true,
      book: { select: { order: true } },
      part: { select: { number: true } },
    },
  });
  return sections.map((s) => ({
    id: s.id,
    position: s.position,
    label: sectionLabel(s, { book: s.book, part: s.part }),
    title: gateSectionTitle(viewer, s),
  }));
}

// ---------- search & graph (gated cores; Phase 2 adds their UI) ----------

/**
 * Search omits gated cards entirely — no placeholders. Title + summary only:
 * per-field gating cannot be reconciled with per-row search, and a match
 * against a gated field would leak that the term exists.
 */
export async function searchCards(
  viewer: Viewer,
  query: string,
  opts: { cursor?: string; pageSize?: number } = {},
): Promise<{ items: VisibleCardSummary[]; nextCursor: string | null }> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const rows = await prisma.card.findMany({
    where: {
      seriesId: viewer.seriesId,
      ...gateWhere(viewer),
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { summary: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: [{ revealIndex: "asc" }, { id: "asc" }],
    take: pageSize + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, pageSize);
  const last = page[page.length - 1];
  return {
    items: page.map((card) => ({
      locked: false,
      id: card.id,
      type: card.type,
      title: card.title,
      summary: card.summary,
      confidence: card.confidence,
      revealIndex: card.revealIndex,
    })),
    nextCursor: rows.length > pageSize && last ? last.id : null,
  };
}

export type GraphData = {
  nodes: Array<{ id: string; title: string; type: CardType }>;
  edges: Array<{
    id: string;
    fromCardId: string;
    toCardId: string;
    type: string;
    weight: number;
    directed: boolean;
  }>;
  truncated: boolean;
};

/**
 * Graph omits gated cards entirely — no phantom nodes; a locked node's position
 * or adjacency leaks structure. Node count capped (configurable), with notice.
 */
export async function graphData(
  viewer: Viewer,
  opts: { nodeLimit?: number; type?: CardType } = {},
): Promise<GraphData> {
  const nodeLimit = opts.nodeLimit ?? 200;
  const cards = await prisma.card.findMany({
    where: {
      seriesId: viewer.seriesId,
      ...gateWhere(viewer),
      ...(opts.type ? { type: opts.type } : {}),
    },
    select: { id: true, title: true, type: true },
    orderBy: [{ revealIndex: "asc" }, { id: "asc" }],
    take: nodeLimit + 1,
  });
  const truncated = cards.length > nodeLimit;
  const nodes = cards.slice(0, nodeLimit);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const relations = await prisma.cardRelation.findMany({
    where: { ...relationWhere(viewer), fromCard: { seriesId: viewer.seriesId, ...gateWhere(viewer) } },
    select: {
      id: true,
      fromCardId: true,
      toCardId: true,
      type: true,
      weight: true,
      directed: true,
    },
  });
  return {
    nodes,
    edges: relations.filter((r) => nodeIds.has(r.fromCardId) && nodeIds.has(r.toCardId)),
    truncated,
  };
}

/** Titles of the given cards that are visible to the viewer — for link rendering. */
export async function getVisibleCardTitles(
  viewer: Viewer,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const cards = await prisma.card.findMany({
    where: { id: { in: ids }, seriesId: viewer.seriesId, ...gateWhere(viewer) },
    select: { id: true, title: true },
  });
  return new Map(cards.map((c) => [c.id, c.title]));
}

// ---------- theory reveal warning (authoring aid — peek contexts only) ----------

/**
 * A theory's revealIndex should default to the max of its cited cards'. We never
 * silently raise it; instead surface a warning. Computed only under peek — for a
 * non-peek viewer the warning itself would leak that a later citation exists.
 */
export async function getTheoryRevealWarning(
  viewer: Viewer,
  cardId: string,
): Promise<{ storedRevealIndex: number; citedMaxRevealIndex: number } | null> {
  if (!viewer.peek) return null;
  const card = await prisma.card.findFirst({
    where: { id: cardId, seriesId: viewer.seriesId, type: "THEORY", deletedAt: null },
    select: { revealIndex: true },
  });
  if (!card) return null;
  const relations = await prisma.cardRelation.findMany({
    where: {
      OR: [{ fromCardId: cardId }, { toCardId: cardId }],
      deletedAt: null,
    },
    select: {
      fromCardId: true,
      fromCard: { select: { revealIndex: true, deletedAt: true } },
      toCard: { select: { revealIndex: true, deletedAt: true } },
    },
  });
  const cited = relations
    .map((r) => (r.fromCardId === cardId ? r.toCard : r.fromCard))
    .filter((c) => c.deletedAt === null);
  if (cited.length === 0) return null;
  const citedMax = Math.max(...cited.map((c) => c.revealIndex));
  return citedMax > card.revealIndex
    ? { storedRevealIndex: card.revealIndex, citedMaxRevealIndex: citedMax }
    : null;
}
