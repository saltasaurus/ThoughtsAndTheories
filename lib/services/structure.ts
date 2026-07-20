import type { Prisma, SectionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";

type Tx = Prisma.TransactionClient;

/**
 * Rewrite every dependent row's cached revealIndex from its revealSectionId FK.
 * The FK is the source of truth; the integer is a cache.
 */
async function rewriteRevealCaches(tx: Tx, seriesId: string): Promise<void> {
  await tx.$executeRaw`UPDATE "Card" c SET "revealIndex" = s."position" FROM "Section" s JOIN "Book" b ON b."id" = s."bookId" WHERE c."revealSectionId" = s."id" AND b."seriesId" = ${seriesId}`;
  await tx.$executeRaw`UPDATE "CardField" f SET "revealIndex" = s."position" FROM "Section" s JOIN "Book" b ON b."id" = s."bookId" WHERE f."revealSectionId" = s."id" AND b."seriesId" = ${seriesId}`;
  await tx.$executeRaw`UPDATE "CardRelation" r SET "revealIndex" = s."position" FROM "Section" s JOIN "Book" b ON b."id" = s."bookId" WHERE r."revealSectionId" = s."id" AND b."seriesId" = ${seriesId}`;
  await tx.$executeRaw`UPDATE "TimelineEntry" t SET "revealIndex" = s."position" FROM "Section" s JOIN "Book" b ON b."id" = s."bookId" WHERE t."revealSectionId" = s."id" AND b."seriesId" = ${seriesId}`;
  await tx.$executeRaw`UPDATE "Membership" m SET "revealIndex" = s."position" FROM "Section" s JOIN "Book" b ON b."id" = s."bookId" WHERE m."currentSectionId" = s."id" AND b."seriesId" = ${seriesId}`;
  await tx.$executeRaw`UPDATE "ClubSession" cs SET "goalRevealIndex" = s."position" FROM "Section" s JOIN "Book" b ON b."id" = s."bookId" WHERE cs."goalSectionId" = s."id" AND b."seriesId" = ${seriesId}`;
}

async function orderedSections(
  tx: Tx,
  seriesId: string,
): Promise<Array<{ id: string; position: number; bookId: string; bookOrder: number }>> {
  const rows = await tx.section.findMany({
    where: { book: { seriesId }, deletedAt: null },
    orderBy: [{ book: { order: "asc" } }, { position: "asc" }, { id: "asc" }],
    select: { id: true, position: true, bookId: true, book: { select: { order: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    position: r.position,
    bookId: r.bookId,
    bookOrder: r.book.order,
  }));
}

/** Write positions 1..n following orderedIds, then refresh all dependent caches. */
async function applySectionOrder(tx: Tx, seriesId: string, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    if (id === undefined) continue;
    await tx.section.update({ where: { id }, data: { position: i + 1 } });
  }
  await rewriteRevealCaches(tx, seriesId);
}

/**
 * Normalize positions to a dense, gapless 1..n over the whole series (spanning
 * book boundaries) and rewrite every dependent revealIndex. One transaction.
 */
export async function recomputeSeriesPositions(seriesId: string, tx?: Tx): Promise<void> {
  const run = async (t: Tx): Promise<void> => {
    const sections = await orderedSections(t, seriesId);
    await applySectionOrder(
      t,
      seriesId,
      sections.map((s) => s.id),
    );
  };
  if (tx) return run(tx);
  return prisma.$transaction(run);
}

export type SectionInput = {
  bookId: string;
  partId?: string | null;
  type: SectionType;
  number?: number | null;
  title?: string | null;
  /** null = insert at the start of the book */
  afterSectionId: string | null;
};

/** Insert a section anywhere — including mid-series — shifting all later positions. */
export async function insertSection(seriesId: string, input: SectionInput): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const book = await tx.book.findFirst({
      where: { id: input.bookId, seriesId, deletedAt: null },
      select: { id: true, order: true },
    });
    if (!book) throw new NotFoundError("Book not found in this series");
    if (input.partId) {
      const part = await tx.part.findFirst({
        where: { id: input.partId, bookId: input.bookId, deletedAt: null },
        select: { id: true },
      });
      if (!part) throw new NotFoundError("Part not found in this book");
    }

    const sections = await orderedSections(tx, seriesId);
    let insertIdx: number;
    if (input.afterSectionId) {
      const idx = sections.findIndex((s) => s.id === input.afterSectionId);
      if (idx === -1) throw new NotFoundError("afterSection not found in this series");
      // Ordering is derived from (book.order, position): an order that
      // interleaves books could not be reproduced and would silently shift
      // gates on the next structural edit. Anchor must be in the target book.
      if (sections[idx]!.bookId !== input.bookId) {
        throw new AppError("afterSection must belong to the same book");
      }
      insertIdx = idx + 1;
    } else {
      // start of the given book; if the book is empty, after every section
      // of earlier books
      const firstOfBook = sections.findIndex((s) => s.bookId === input.bookId);
      insertIdx =
        firstOfBook !== -1
          ? firstOfBook
          : sections.filter((s) => s.bookOrder < book.order).length;
    }

    const created = await tx.section.create({
      data: {
        bookId: input.bookId,
        partId: input.partId ?? null,
        type: input.type,
        number: input.number ?? null,
        title: input.title ?? null,
        position: 0, // placeholder; applySectionOrder assigns the real value
      },
    });
    const ids = sections.map((s) => s.id);
    ids.splice(insertIdx, 0, created.id);
    await applySectionOrder(tx, seriesId, ids);
    return created.id;
  });
}

/**
 * Move a section within its OWN book's ordering (null = to the book's start).
 * Cross-book interleavings are rejected: derived order is (book.order,
 * position), so an interleaved order could not be reproduced and would
 * silently shift gates on the next structural edit. Part membership never
 * changes the gate.
 */
export async function moveSection(
  seriesId: string,
  sectionId: string,
  afterSectionId: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const sections = await orderedSections(tx, seriesId);
    const moving = sections.find((s) => s.id === sectionId);
    if (!moving) throw new NotFoundError("Section not found in this series");
    if (afterSectionId !== null) {
      const after = sections.find((s) => s.id === afterSectionId);
      if (!after) throw new NotFoundError("afterSection not found");
      if (after.bookId !== moving.bookId) {
        throw new AppError("A section can only be reordered within its own book");
      }
    }
    const remaining = sections.filter((s) => s.id !== sectionId);
    const ids = remaining.map((s) => s.id);
    const to =
      afterSectionId === null
        ? (() => {
            const firstOfBook = remaining.findIndex((s) => s.bookId === moving.bookId);
            return firstOfBook !== -1
              ? firstOfBook
              : remaining.filter((s) => s.bookOrder < moving.bookOrder).length;
          })()
        : ids.indexOf(afterSectionId) + 1;
    ids.splice(to, 0, sectionId);
    await applySectionOrder(tx, seriesId, ids);
  });
}

export async function updateSection(
  seriesId: string,
  sectionId: string,
  patch: { type?: SectionType; number?: number | null; title?: string | null; partId?: string | null },
): Promise<void> {
  const section = await prisma.section.findFirst({
    where: { id: sectionId, book: { seriesId }, deletedAt: null },
    select: { id: true, bookId: true },
  });
  if (!section) throw new NotFoundError("Section not found");
  if (patch.partId) {
    const part = await prisma.part.findFirst({
      where: { id: patch.partId, bookId: section.bookId, deletedAt: null },
      select: { id: true },
    });
    if (!part) throw new NotFoundError("Part not found in this book");
  }
  await prisma.section.update({ where: { id: sectionId }, data: patch });
}

/**
 * RESTRICT: a section referenced by any reveal point (or member position, or
 * session goal) cannot be deleted — reveal points must be reassigned first.
 * Enforced here because soft delete never triggers the DB-level Restrict.
 */
export async function deleteSection(seriesId: string, sectionId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const section = await tx.section.findFirst({
      where: { id: sectionId, book: { seriesId }, deletedAt: null },
      select: { id: true },
    });
    if (!section) throw new NotFoundError("Section not found");
    const [cards, fields, relations, timeline, memberships, sessions] = await Promise.all([
      tx.card.count({ where: { revealSectionId: sectionId, deletedAt: null } }),
      tx.cardField.count({ where: { revealSectionId: sectionId, deletedAt: null } }),
      tx.cardRelation.count({ where: { revealSectionId: sectionId, deletedAt: null } }),
      tx.timelineEntry.count({ where: { revealSectionId: sectionId, deletedAt: null } }),
      tx.membership.count({ where: { currentSectionId: sectionId } }),
      tx.clubSession.count({ where: { goalSectionId: sectionId, deletedAt: null } }),
    ]);
    const total = cards + fields + relations + timeline + memberships + sessions;
    if (total > 0) {
      throw new ConflictError(
        `Section is referenced by ${total} item(s) (cards: ${cards}, fields: ${fields}, relations: ${relations}, timeline: ${timeline}, member positions: ${memberships}, session goals: ${sessions}). Reassign their reveal points first.`,
      );
    }
    await tx.section.update({ where: { id: sectionId }, data: { deletedAt: new Date() } });
    const sections = await orderedSections(tx, seriesId);
    await applySectionOrder(
      tx,
      seriesId,
      sections.map((s) => s.id),
    );
  });
}

// ---------- books & parts ----------

export async function createBook(seriesId: string, title: string): Promise<string> {
  const count = await prisma.book.count({ where: { seriesId, deletedAt: null } });
  const book = await prisma.book.create({
    data: { seriesId, title, order: count + 1 },
  });
  return book.id;
}

export async function updateBook(seriesId: string, bookId: string, title: string): Promise<void> {
  const book = await prisma.book.findFirst({ where: { id: bookId, seriesId, deletedAt: null } });
  if (!book) throw new NotFoundError("Book not found");
  await prisma.book.update({ where: { id: bookId }, data: { title } });
}

export async function deleteBook(seriesId: string, bookId: string): Promise<void> {
  const sections = await prisma.section.count({
    where: { bookId, deletedAt: null },
  });
  if (sections > 0) {
    throw new ConflictError("Delete or move the book's sections first");
  }
  const book = await prisma.book.findFirst({ where: { id: bookId, seriesId, deletedAt: null } });
  if (!book) throw new NotFoundError("Book not found");
  await prisma.book.update({ where: { id: bookId }, data: { deletedAt: new Date() } });
}

export async function createPart(
  seriesId: string,
  input: { bookId: string; number: number; title?: string | null },
): Promise<string> {
  const book = await prisma.book.findFirst({
    where: { id: input.bookId, seriesId, deletedAt: null },
  });
  if (!book) throw new NotFoundError("Book not found");
  const part = await prisma.part.create({
    data: {
      bookId: input.bookId,
      number: input.number,
      title: input.title ?? null,
      order: input.number,
    },
  });
  return part.id;
}

export async function updatePart(
  seriesId: string,
  partId: string,
  patch: { number?: number; title?: string | null },
): Promise<void> {
  const part = await prisma.part.findFirst({
    where: { id: partId, book: { seriesId }, deletedAt: null },
  });
  if (!part) throw new NotFoundError("Part not found");
  await prisma.part.update({
    where: { id: partId },
    data: { ...patch, ...(patch.number !== undefined ? { order: patch.number } : {}) },
  });
}

/** Parts are presentational only: deleting one detaches its sections, gates untouched. */
export async function deletePart(seriesId: string, partId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const part = await tx.part.findFirst({
      where: { id: partId, book: { seriesId }, deletedAt: null },
    });
    if (!part) throw new NotFoundError("Part not found");
    await tx.section.updateMany({ where: { partId }, data: { partId: null } });
    await tx.part.update({ where: { id: partId }, data: { deletedAt: new Date() } });
  });
}
