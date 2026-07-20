import { randomUUID } from "node:crypto";
import type { Book, CalendarEra, CardType, Role, Section, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createSeries } from "@/lib/services/series";

export async function createUser(name: string): Promise<User> {
  return prisma.user.create({
    data: { email: `${name}-${randomUUID()}@test.local`, name, passwordHash: "not-a-hash" },
  });
}

export async function setMember(
  userId: string,
  seriesId: string,
  role: Role,
  section: Section | null,
): Promise<void> {
  await prisma.membership.upsert({
    where: { userId_seriesId: { userId, seriesId } },
    create: {
      userId,
      seriesId,
      role,
      currentSectionId: section?.id ?? null,
      revealIndex: section?.position ?? 0,
    },
    update: {
      role,
      currentSectionId: section?.id ?? null,
      revealIndex: section?.position ?? 0,
    },
  });
}

export async function makeCard(
  seriesId: string,
  createdById: string,
  input: { type: CardType; title: string; summary?: string; section: Section },
): Promise<{ id: string }> {
  return prisma.card.create({
    data: {
      seriesId,
      type: input.type,
      title: input.title,
      summary: input.summary ?? null,
      revealSectionId: input.section.id,
      revealIndex: input.section.position,
      createdById,
    },
    select: { id: true },
  });
}

export type Fixture = {
  seriesId: string;
  owner: User;
  editor: User;
  reader: User;
  book1: Book;
  book2: Book;
  /** ordered by position 1..5: [prologue, ch1, ch2, ch3, ch4] */
  sections: Section[];
  eras: CalendarEra[];
  calendarId: string;
};

/**
 * 2 books, 5 sections (positions 1..5). owner OWNER @5, editor EDITOR @3,
 * reader READER @2. Calendar: First Age (offset 0), Second Age (offset 1000).
 */
export async function createFixture(): Promise<Fixture> {
  const owner = await createUser("owner");
  const editor = await createUser("editor");
  const reader = await createUser("reader");
  const seriesId = await createSeries(owner.id, { title: "Test Series" });

  const book1 = await prisma.book.create({ data: { seriesId, title: "Book One", order: 1 } });
  const book2 = await prisma.book.create({ data: { seriesId, title: "Book Two", order: 2 } });

  const defs: Array<{
    bookId: string;
    type: "PROLOGUE" | "CHAPTER";
    number: number | null;
    title: string;
  }> = [
    { bookId: book1.id, type: "PROLOGUE", number: null, title: "Secret Prologue Title" },
    { bookId: book1.id, type: "CHAPTER", number: 1, title: "The Beginning" },
    { bookId: book1.id, type: "CHAPTER", number: 2, title: "The Middle" },
    { bookId: book2.id, type: "CHAPTER", number: 3, title: "The Return" },
    { bookId: book2.id, type: "CHAPTER", number: 4, title: "The Reveal" },
  ];
  const sections: Section[] = [];
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]!;
    sections.push(
      await prisma.section.create({
        data: {
          bookId: d.bookId,
          type: d.type,
          number: d.number,
          title: d.title,
          position: i + 1,
        },
      }),
    );
  }

  await setMember(owner.id, seriesId, "OWNER", sections[4]!);
  await setMember(editor.id, seriesId, "EDITOR", sections[2]!);
  await setMember(reader.id, seriesId, "READER", sections[1]!);

  const calendar = await prisma.calendar.create({
    data: {
      seriesId,
      name: "Reckoning of the Vale",
      epochLabel: "Ages of the Vale",
      daysPerWeek: 7,
      weekdayNames: ["Sunmorn", "Moonday", "Tidesday", "Wyrmday", "Thornday", "Veilday", "Reston"],
    },
  });
  const era1 = await prisma.calendarEra.create({
    data: { calendarId: calendar.id, name: "First Age", order: 1, yearOffset: 0, abbreviation: "FA" },
  });
  const era2 = await prisma.calendarEra.create({
    data: {
      calendarId: calendar.id,
      name: "Second Age",
      order: 2,
      yearOffset: 1000,
      abbreviation: "SA",
    },
  });
  for (const [i, name] of ["Frostwane", "Thawmarch", "Rethe"].entries()) {
    await prisma.calendarMonth.create({
      data: { calendarId: calendar.id, name, order: i + 1, dayCount: 30 },
    });
  }

  return { seriesId, owner, editor, reader, book1, book2, sections, eras: [era1, era2], calendarId: calendar.id };
}
