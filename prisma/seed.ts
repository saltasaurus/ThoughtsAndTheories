/**
 * Demo seed: "The Vale Cycle" — a 3-book series with parts, interludes, a full
 * fictional calendar, 25 cards across the reveal range, relations, revisions,
 * timeline entries whose in-world order diverges from reveal order, an ACTIVE
 * session, and three users at different progress points, so the spoiler gate
 * is demonstrable immediately.
 *
 * Logins (all password "password123"):
 *   alice@example.com  OWNER   — deep into book 3
 *   bram@example.com   EDITOR  — at the session goal
 *   cora@example.com   READER  — early in book 1
 */
import { PrismaClient, type CardType, type SectionType } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { computeAbsoluteSortKey } from "../lib/calendar";
import { DEFAULT_TEMPLATES } from "../lib/templates";

const prisma = new PrismaClient();

const MONTHS = [
  "Frostwane", "Thawmarch", "Rethe", "Seedfall", "Highsun", "Emberwane",
  "Harvestide", "Gloaming", "Mistfall", "Deepwinter", "Longdark", "Yearsend",
];
const WEEKDAYS = ["Sunmorn", "Moonday", "Tidesday", "Wyrmday", "Thornday", "Veilday", "Reston"];

type SectionDef = {
  book: 0 | 1 | 2;
  part: number | null; // index into created parts of book 1
  type: SectionType;
  number: number | null;
  title: string | null;
};

async function main(): Promise<void> {
  if ((await prisma.series.count()) > 0) {
    console.log("Seed skipped: database already contains a series.");
    return;
  }

  const passwordHash = bcrypt.hashSync("password123", 12);
  const makeUser = (name: string) =>
    prisma.user.create({
      data: { email: `${name.toLowerCase()}@example.com`, name, passwordHash },
    });
  const alice = await makeUser("Alice");
  const bram = await makeUser("Bram");
  const cora = await makeUser("Cora");

  const series = await prisma.series.create({
    data: {
      title: "The Vale Cycle",
      description: "A demo series about a haunted mountain vale, its lost crown, and the readers who argue about it.",
    },
  });

  // default templates for all seven card types
  for (const [cardType, fields] of Object.entries(DEFAULT_TEMPLATES)) {
    await prisma.template.create({
      data: {
        seriesId: series.id,
        cardType: cardType as CardType,
        fields: {
          create: fields.map((f, i) => ({
            key: f.key,
            label: f.label,
            fieldType: f.fieldType,
            options: f.options,
            required: f.required ?? false,
            order: i + 1,
          })),
        },
      },
    });
  }

  // ---- structure: 3 books; book 1 has Parts with interludes BETWEEN them ----
  const books = await Promise.all(
    ["The Hollow Crown", "The Ashen Road", "The Last Vigil"].map((title, i) =>
      prisma.book.create({ data: { seriesId: series.id, title, order: i + 1 } }),
    ),
  );
  const book1 = books[0]!;
  const parts = await Promise.all(
    [
      { number: 1, title: "The Vale Below" },
      { number: 2, title: "The Crown Remembers" }, // part titles are gated — they can spoil
      { number: 3, title: "What the Queen Buried" },
    ].map((p) => prisma.part.create({ data: { bookId: book1.id, ...p, order: p.number } })),
  );

  const defs: SectionDef[] = [
    { book: 0, part: null, type: "PROLOGUE", number: null, title: "The Gravedigger's Song" },
    { book: 0, part: 0, type: "CHAPTER", number: 1, title: "Smoke over Harrowmere" },
    { book: 0, part: 0, type: "CHAPTER", number: 2, title: "The Widow's Ledger" },
    { book: 0, part: 0, type: "CHAPTER", number: 3, title: "A Coin for the Ferryman" },
    { book: 0, part: null, type: "INTERLUDE", number: 1, title: "The Pale Queen Dreams" },
    { book: 0, part: 1, type: "CHAPTER", number: 4, title: "Thorns in the Orchard" },
    { book: 0, part: 1, type: "CHAPTER", number: 5, title: "The Sunken Chapel" },
    { book: 0, part: 1, type: "CHAPTER", number: 6, title: "Maren's Bargain" },
    { book: 0, part: null, type: "INTERLUDE", number: 2, title: "The Crown Remembers Fire" },
    { book: 0, part: 2, type: "CHAPTER", number: 7, title: "The Hollow Court" },
    { book: 0, part: 2, type: "CHAPTER", number: 8, title: "Nine Names for Winter" },
    { book: 0, part: 2, type: "CHAPTER", number: 9, title: "The First Betrayal" },
    { book: 0, part: null, type: "EPILOGUE", number: null, title: "Ash on the Water" },
    { book: 1, part: null, type: "CHAPTER", number: 10, title: "The Road South" },
    { book: 1, part: null, type: "CHAPTER", number: 11, title: "The Ashen Toll" },
    { book: 1, part: null, type: "CHAPTER", number: 12, title: "The Cartographer's Lie" },
    { book: 1, part: null, type: "CHAPTER", number: 13, title: "Wolves at the Ford" },
    { book: 1, part: null, type: "CHAPTER", number: 14, title: "The King's True Name" },
    { book: 1, part: null, type: "CHAPTER", number: 15, title: "Embers in the Deep" },
    { book: 1, part: null, type: "CHAPTER", number: 16, title: "The Second Betrayal" },
    { book: 2, part: null, type: "CHAPTER", number: 17, title: "The Last Vigil Begins" },
    { book: 2, part: null, type: "CHAPTER", number: 18, title: "The Queen Unburied" },
    { book: 2, part: null, type: "CHAPTER", number: 19, title: "The Crown Accepts" },
    { book: 2, part: null, type: "CHAPTER", number: 20, title: "What Maren Carried" },
    { book: 2, part: null, type: "CHAPTER", number: 21, title: "The Vale Above" },
    { book: 2, part: null, type: "CHAPTER", number: 22, title: "Morning in Harrowmere" },
    { book: 2, part: null, type: "EPILOGUE", number: null, title: "The Gravedigger's Answer" },
    { book: 2, part: null, type: "END_NOTES", number: null, title: "On the Reckoning of the Vale" },
    { book: 2, part: null, type: "APPENDIX", number: null, title: "Houses of the Vale" },
  ];
  const sections: Array<{ id: string; position: number }> = [];
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]!;
    const created = await prisma.section.create({
      data: {
        bookId: books[d.book]!.id,
        partId: d.part === null ? null : parts[d.part]!.id,
        type: d.type,
        number: d.number,
        title: d.title,
        position: i + 1,
      },
    });
    sections.push({ id: created.id, position: created.position });
  }
  const at = (position: number): { id: string; position: number } => {
    const s = sections[position - 1];
    if (!s) throw new Error(`no section at position ${position}`);
    return s;
  };

  // ---- memberships: three users at different progress points ----
  await prisma.membership.create({
    data: { userId: alice.id, seriesId: series.id, role: "OWNER", currentSectionId: at(25).id, revealIndex: 25 },
  });
  await prisma.membership.create({
    data: { userId: bram.id, seriesId: series.id, role: "EDITOR", currentSectionId: at(16).id, revealIndex: 16 },
  });
  await prisma.membership.create({
    data: { userId: cora.id, seriesId: series.id, role: "READER", currentSectionId: at(3).id, revealIndex: 3 },
  });

  // ---- calendar: 2 eras, 12 months, 7 weekdays ----
  const calendar = await prisma.calendar.create({
    data: {
      seriesId: series.id,
      name: "Reckoning of the Vale",
      epochLabel: "Ages of the Vale",
      daysPerWeek: 7,
      weekdayNames: WEEKDAYS,
    },
  });
  const firstAge = await prisma.calendarEra.create({
    data: { calendarId: calendar.id, name: "First Age", order: 1, yearOffset: 0, abbreviation: "FA" },
  });
  const ashAge = await prisma.calendarEra.create({
    data: { calendarId: calendar.id, name: "Age of Ash", order: 2, yearOffset: 2000, abbreviation: "AA" },
  });
  for (const [i, name] of MONTHS.entries()) {
    await prisma.calendarMonth.create({
      data: { calendarId: calendar.id, name, order: i + 1, dayCount: 30 },
    });
  }

  // ---- cards: 25 across the reveal range ----
  const templates = await prisma.template.findMany({
    where: { seriesId: series.id },
    include: { fields: true },
  });
  const tf = (cardType: CardType, key: string) => {
    const field = templates.find((t) => t.cardType === cardType)?.fields.find((f) => f.key === key);
    if (!field) throw new Error(`missing template field ${cardType}.${key}`);
    return field;
  };
  const doc = (text: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

  const cardDefs: Array<{
    key: string;
    type: CardType;
    title: string;
    summary: string;
    reveal: number;
    confidence?: number;
  }> = [
    { key: "tomas", type: "CHARACTER", title: "Tomas the Gravedigger", summary: "Narrator of the prologue; knows more than he says.", reveal: 1 },
    { key: "maren", type: "CHARACTER", title: "Maren of Harrowmere", summary: "A widow with a ledger of debts nobody remembers incurring.", reveal: 2 },
    { key: "ferryman", type: "CHARACTER", title: "The Ferryman", summary: "Takes coin at the mere. Never seen to sleep.", reveal: 3 },
    { key: "paleQueen", type: "CHARACTER", title: "The Pale Queen", summary: "Dead four centuries. Allegedly.", reveal: 5 },
    { key: "brann", type: "CHARACTER", title: "Captain Brann", summary: "Commander of the Hollow Court guard.", reveal: 10 },
    { key: "king", type: "CHARACTER", title: "The Nameless King", summary: "His true name is chapter 14's problem.", reveal: 18 },
    { key: "cartographer", type: "CHARACTER", title: "The Cartographer", summary: "Draws roads that were never built. People arrive anyway.", reveal: 16 },
    { key: "vigil", type: "CHARACTER", title: "The Last Vigilkeeper", summary: "Waits at the vale's rim for something to end.", reveal: 21 },
    { key: "harrowmere", type: "LOCATION", title: "Harrowmere", summary: "A lakeside town of smoke and ledgers.", reveal: 2 },
    { key: "chapel", type: "LOCATION", title: "The Sunken Chapel", summary: "Flooded nave; the bells still ring on Veilday.", reveal: 7 },
    { key: "court", type: "LOCATION", title: "The Hollow Court", summary: "The vale's seat of power, built into the mountain.", reveal: 10 },
    { key: "vale", type: "LOCATION", title: "The Vale Above", summary: "What sits over the vale is not sky.", reveal: 25 },
    { key: "burning", type: "EVENT", title: "The Burning of the Orchard", summary: "The fire that started the ledger.", reveal: 6 },
    { key: "coronation", type: "EVENT", title: "The Queen's Coronation", summary: "Four hundred years past; the crown remembers it.", reveal: 9 },
    { key: "betrayal1", type: "EVENT", title: "The First Betrayal", summary: "Someone opened the gate from inside.", reveal: 12 },
    { key: "unburial", type: "EVENT", title: "The Unburial", summary: "Chapter 18 changes every earlier chapter.", reveal: 22 },
    { key: "crown", type: "ITEM", title: "The Hollow Crown", summary: "It fits everyone. That is the problem.", reveal: 4 },
    { key: "ledger", type: "ITEM", title: "The Widow's Ledger", summary: "Debts written in a hand nobody alive can match.", reveal: 3 },
    { key: "lantern", type: "ITEM", title: "The Ferryman's Lantern", summary: "Burns without oil, dims near lies.", reveal: 15 },
    { key: "courtFaction", type: "FACTION", title: "The Hollow Court", summary: "The guard, the clerks, the throne behind them.", reveal: 10 },
    { key: "veiled", type: "FACTION", title: "The Veiled", summary: "They tend the chapel bells. Among other things.", reveal: 13 },
    { key: "reckoning", type: "CONCEPT", title: "The Reckoning", summary: "The vale's calendar counts down, not up.", reveal: 8 },
    { key: "crownMemory", type: "CONCEPT", title: "Crown-memory", summary: "Objects remember their bearers. Some resent them.", reveal: 14 },
    { key: "theoryQueen", type: "THEORY", title: "The Queen never died", summary: "The interludes are not dreams — they're present tense.", reveal: 5, confidence: 4 },
    { key: "theoryFerryman", type: "THEORY", title: "The Ferryman is the King", summary: "Nobody takes that much coin without a crown to pay for.", reveal: 18, confidence: 2 },
  ];
  const cards = new Map<string, { id: string; reveal: number; type: CardType }>();
  for (const def of cardDefs) {
    const section = at(def.reveal);
    const card = await prisma.card.create({
      data: {
        seriesId: series.id,
        type: def.type,
        title: def.title,
        summary: def.summary,
        confidence: def.confidence ?? null,
        revealSectionId: section.id,
        revealIndex: section.position,
        createdById: alice.id,
      },
    });
    cards.set(def.key, { id: card.id, reveal: def.reveal, type: def.type });
  }
  const card = (key: string) => {
    const c = cards.get(key);
    if (!c) throw new Error(`missing card ${key}`);
    return c;
  };

  // gated fields: Maren is visible at ch 2, but her true identity unlocks in book 3
  const marenAliases = tf("CHARACTER", "aliases");
  await prisma.cardField.create({
    data: {
      cardId: card("maren").id,
      templateFieldId: marenAliases.id,
      value: "The Pale Queen, unburied",
      revealSectionId: at(24).id,
      revealIndex: 24,
    },
  });
  await prisma.cardField.create({
    data: {
      cardId: card("maren").id,
      templateFieldId: tf("CHARACTER", "description").id,
      value: doc("Keeps the ledger. Pays her debts. Collects everyone else's."),
      revealSectionId: at(2).id,
      revealIndex: 2,
    },
  });
  // CARD_REF field: Brann's affiliation points at the Hollow Court faction
  await prisma.cardField.create({
    data: {
      cardId: card("brann").id,
      templateFieldId: tf("CHARACTER", "affiliation").id,
      value: { cardId: card("courtFaction").id },
      revealSectionId: at(10).id,
      revealIndex: 10,
    },
  });
  // status fields
  await prisma.cardField.create({
    data: {
      cardId: card("paleQueen").id,
      templateFieldId: tf("CHARACTER", "status").id,
      value: "Unknown",
      revealSectionId: at(5).id,
      revealIndex: 5,
    },
  });
  // an in-world date on an event card
  await prisma.cardField.create({
    data: {
      cardId: card("coronation").id,
      templateFieldId: tf("EVENT", "date").id,
      value: { eraId: firstAge.id, year: 1604, monthOrder: 3, day: 14, precision: "DAY", displayOverride: null },
      revealSectionId: at(9).id,
      revealIndex: 9,
    },
  });

  // a couple of revisions on the gated character — diffs are gated content
  await prisma.revision.create({
    data: {
      entityType: "CARD",
      entityId: card("maren").id,
      userId: alice.id,
      diff: { after: { title: "Maren of Harrowmere" } },
      revealIndex: 2,
    },
  });
  await prisma.revision.create({
    data: {
      entityType: "CARD_FIELD",
      entityId: card("maren").id,
      userId: bram.id,
      diff: { after: { value: "The Pale Queen, unburied" } },
      revealIndex: 24, // the gated alias — never served below position 24
    },
  });

  // ---- relations (some spanning wide reveal gaps to demo endpoint gating) ----
  const relate = async (
    fromKey: string,
    toKey: string,
    type: string,
    weight: number,
    reveal: number,
    directed = true,
  ) => {
    const section = at(reveal);
    await prisma.cardRelation.create({
      data: {
        fromCardId: card(fromKey).id,
        toCardId: card(toKey).id,
        type,
        weight,
        directed,
        revealSectionId: section.id,
        revealIndex: section.position,
      },
    });
  };
  await relate("maren", "harrowmere", "lives in", 0.6, 2);
  await relate("maren", "ledger", "keeps", 0.9, 3);
  await relate("ferryman", "lantern", "carries", 0.7, 15);
  await relate("brann", "courtFaction", "commands", 0.8, 10);
  await relate("veiled", "chapel", "tends", 0.7, 13);
  await relate("paleQueen", "coronation", "crowned at", 0.9, 9);
  await relate("maren", "paleQueen", "is", 1.0, 24); // the big one — gated late
  await relate("king", "crown", "bound to", 0.9, 18);
  await relate("theoryQueen", "paleQueen", "concerns", 0.8, 5);
  await relate("theoryQueen", "maren", "supported by", 0.6, 6);
  await relate("theoryFerryman", "ferryman", "concerns", 0.8, 18);
  await relate("theoryFerryman", "king", "contradicted by", 0.5, 18);

  // ---- timeline: in-world order deliberately diverges from reveal order ----
  const timelineDefs: Array<{
    label: string;
    description: string;
    reveal: number;
    era: { id: string } | null;
    year: number | null;
    month: number | null;
    day: number | null;
    precision: "YEAR" | "MONTH" | "DAY" | "UNKNOWN";
    override?: string;
    manualSortKey?: number;
    cardKey?: string;
  }> = [
    // revealed EARLY, happened LATE in-world (present-day events)
    { label: "Smoke rises over Harrowmere", description: "The story opens.", reveal: 2, era: ashAge, year: 941, month: 1, day: 4, precision: "DAY", cardKey: "harrowmere" },
    { label: "The Orchard burns", description: "", reveal: 6, era: ashAge, year: 941, month: 1, day: 19, precision: "DAY", cardKey: "burning" },
    // revealed LATE, happened EARLY in-world (deep history via prophecy/flashback)
    { label: "The Vale is first settled", description: "Known only from the end notes.", reveal: 28, era: firstAge, year: 312, month: null, day: null, precision: "YEAR" },
    { label: "The Queen's Coronation", description: "The crown remembers it differently.", reveal: 9, era: firstAge, year: 1604, month: 3, day: 14, precision: "DAY", cardKey: "coronation" },
    { label: "The Queen's burial", description: "Contested by chapter 18.", reveal: 22, era: firstAge, year: 1636, month: 10, day: null, precision: "MONTH", cardKey: "unburial" },
    { label: "The Reckoning begins its countdown", description: "", reveal: 8, era: firstAge, year: 1700, month: null, day: null, precision: "YEAR" },
    { label: "The First Betrayal", description: "", reveal: 12, era: ashAge, year: 941, month: 2, day: 2, precision: "DAY", cardKey: "betrayal1" },
    // unknown precision: grouped separately, manually ordered
    { label: "The Long Winter", description: "Nobody agrees when. Everybody agrees it was long.", reveal: 11, era: null, year: null, month: null, day: null, precision: "UNKNOWN", override: "the Long Winter", manualSortKey: 1 },
  ];
  for (const t of timelineDefs) {
    const section = at(t.reveal);
    const date = {
      year: t.year,
      monthOrder: t.month,
      day: t.day,
      precision: t.precision,
    };
    await prisma.timelineEntry.create({
      data: {
        seriesId: series.id,
        cardId: t.cardKey ? card(t.cardKey).id : null,
        label: t.label,
        description: t.description || null,
        revealSectionId: section.id,
        revealIndex: section.position,
        eraId: t.era?.id ?? null,
        year: t.year,
        monthOrder: t.month,
        day: t.day,
        precision: t.precision,
        displayOverride: t.override ?? null,
        absoluteSortKey: computeAbsoluteSortKey(
          date,
          t.era ? (t.era.id === firstAge.id ? firstAge : ashAge) : null,
        ),
        manualSortKey: t.manualSortKey ?? null,
      },
    });
  }

  // ---- one ACTIVE session with a goal ----
  await prisma.clubSession.create({
    data: {
      seriesId: series.id,
      title: "Session 4 — into The Ashen Road",
      scheduledAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      goalSectionId: at(16).id, // Book 2 · Chapter 12
      goalRevealIndex: 16,
      notes: doc("Bring your theories about the interludes. No spoilers past the goal, please!"),
      createdById: alice.id,
      status: "ACTIVE",
    },
  });

  console.log("Seeded 'The Vale Cycle':");
  console.log("  alice@example.com / password123  (OWNER, position 25)");
  console.log("  bram@example.com  / password123  (EDITOR, position 16 — at goal)");
  console.log("  cora@example.com  / password123  (READER, position 3)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
