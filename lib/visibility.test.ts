import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError, ConflictError, ForbiddenError, PeekForbiddenError } from "@/lib/errors";
import {
  getActiveSession,
  getCardDetail,
  getViewer,
  graphData,
  listCards,
  listRelationsForCard,
  listRevisions,
  listTimeline,
  searchCards,
  type Viewer,
} from "@/lib/visibility";
import { createCard, restoreCard, setCardRevealPoint, softDeleteCard } from "@/lib/services/cards";
import { updateEraYearOffset } from "@/lib/services/calendar-admin";
import {
  getValidInvite,
  isBootstrap,
  redeemInvite,
  registerUser,
} from "@/lib/services/invites";
import { lowerMemberProgress } from "@/lib/services/memberships";
import { insertSection, moveSection } from "@/lib/services/structure";
import { createFixture, createUser, makeCard, type Fixture } from "@/tests/fixture";

async function templateField(seriesId: string, cardType: "CHARACTER", key: string) {
  const template = await prisma.template.findUnique({
    where: { seriesId_cardType: { seriesId, cardType } },
    include: { fields: true },
  });
  const field = template?.fields.find((f) => f.key === key);
  if (!field) throw new Error(`missing template field ${key}`);
  return field;
}

describe("locked placeholders (card list)", () => {
  let f: Fixture;
  let reader: Viewer;
  let gatedId: string;

  beforeAll(async () => {
    f = await createFixture();
    await makeCard(f.seriesId, f.owner.id, {
      type: "CHARACTER",
      title: "Aldric the Bold",
      section: f.sections[0]!,
    });
    gatedId = (
      await makeCard(f.seriesId, f.owner.id, {
        type: "CHARACTER",
        title: "Hidden Villain",
        summary: "verysecret identity",
        section: f.sections[3]!,
      })
    ).id;
    reader = await getViewer(f.reader.id, f.seriesId);
  });

  it("sends ONLY { id, locked } for gated cards — nothing else", async () => {
    const { items } = await listCards(reader);
    const locked = items.find((i) => i.id === gatedId);
    expect(locked).toBeDefined();
    expect(Object.keys(locked!).sort()).toEqual(["id", "locked"]);
    expect(locked).toEqual({ id: gatedId, locked: true });
  });

  it("returns visible cards in full, sorted by (revealIndex, id) — never a content sort", async () => {
    const { items } = await listCards(reader);
    const indices = items.map((i) => ("revealIndex" in i ? i.revealIndex : Number.MAX_SAFE_INTEGER));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    const visible = items.find((i) => !("locked" in i && i.locked));
    expect(visible).toMatchObject({ title: "Aldric the Bold", locked: false });
  });

  it("omits gated cards entirely from graph payloads (no phantom nodes)", async () => {
    const graph = await graphData(reader);
    expect(graph.nodes.map((n) => n.id)).not.toContain(gatedId);
  });

  it("omits gated cards entirely from search payloads", async () => {
    expect((await searchCards(reader, "Hidden")).items).toHaveLength(0);
    expect((await searchCards(reader, "verysecret")).items).toHaveLength(0);
    const owner = await getViewer(f.owner.id, f.seriesId);
    expect((await searchCards(owner, "Hidden")).items).toHaveLength(1);
  });
});

describe("full-text search (precomputed tsvector)", () => {
  it("matches by stemmed lexeme over title + summary, not substring", async () => {
    const f = await createFixture();
    const owner = await getViewer(f.owner.id, f.seriesId);
    await makeCard(f.seriesId, f.owner.id, {
      type: "FACTION",
      title: "The Wandering Merchants",
      summary: "A caravan guild.",
      section: f.sections[0]!,
    });
    // plural/inflected queries stem to the stored lexeme and match
    expect((await searchCards(owner, "merchant")).items).toHaveLength(1);
    expect((await searchCards(owner, "caravans")).items).toHaveLength(1);
    // a term in neither field does not match
    expect((await searchCards(owner, "dragon")).items).toHaveLength(0);
    // a substring fragment is NOT a lexeme — proves this is full-text, not ILIKE
    expect((await searchCards(owner, "merch")).items).toHaveLength(0);
    // blank query yields nothing rather than everything
    expect((await searchCards(owner, "   ")).items).toHaveLength(0);
  });
});

describe("field gating (independent of parent card)", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture();
  });

  it("hides a field gated above the viewer even when the card is visible", async () => {
    const card = await makeCard(f.seriesId, f.owner.id, {
      type: "CHARACTER",
      title: "Masked Stranger",
      section: f.sections[0]!,
    });
    const aliases = await templateField(f.seriesId, "CHARACTER", "aliases");
    await prisma.cardField.create({
      data: {
        cardId: card.id,
        templateFieldId: aliases.id,
        value: "Secretly the King",
        revealSectionId: f.sections[3]!.id,
        revealIndex: f.sections[3]!.position,
      },
    });
    const reader = await getViewer(f.reader.id, f.seriesId);
    const owner = await getViewer(f.owner.id, f.seriesId);

    const forReader = await getCardDetail(reader, card.id);
    expect(forReader).not.toBeNull();
    expect(forReader!.fields.map((x) => x.key)).not.toContain("aliases");

    const forOwner = await getCardDetail(owner, card.id);
    expect(forOwner!.fields.map((x) => x.key)).toContain("aliases");
  });

  it("hides a CARD_REF field when the referenced card is gated, even past the field's own reveal", async () => {
    const visibleCard = await makeCard(f.seriesId, f.owner.id, {
      type: "CHARACTER",
      title: "Loyal Knight",
      section: f.sections[0]!,
    });
    const gatedCard = await makeCard(f.seriesId, f.owner.id, {
      type: "FACTION",
      title: "The Hidden Order",
      section: f.sections[3]!,
    });
    const affiliation = await templateField(f.seriesId, "CHARACTER", "affiliation");
    await prisma.cardField.create({
      data: {
        cardId: visibleCard.id,
        templateFieldId: affiliation.id,
        value: { cardId: gatedCard.id },
        revealSectionId: f.sections[0]!.id, // field's own reveal has passed
        revealIndex: f.sections[0]!.position,
      },
    });
    const reader = await getViewer(f.reader.id, f.seriesId);
    const owner = await getViewer(f.owner.id, f.seriesId);

    const forReader = await getCardDetail(reader, visibleCard.id);
    expect(forReader!.fields.map((x) => x.key)).not.toContain("affiliation");

    const forOwner = await getCardDetail(owner, visibleCard.id);
    expect(forOwner!.fields.map((x) => x.key)).toContain("affiliation");
  });
});

describe("relation endpoint gating", () => {
  it("hides a relation when either endpoint is gated, even if the edge's own reveal has passed", async () => {
    const f = await createFixture();
    const visibleCard = await makeCard(f.seriesId, f.owner.id, {
      type: "CHARACTER",
      title: "Court Scholar",
      section: f.sections[0]!,
    });
    const gatedCard = await makeCard(f.seriesId, f.owner.id, {
      type: "CHARACTER",
      title: "True Heir",
      section: f.sections[3]!,
    });
    await prisma.cardRelation.create({
      data: {
        fromCardId: visibleCard.id,
        toCardId: gatedCard.id,
        type: "sibling of",
        weight: 0.9,
        revealSectionId: f.sections[0]!.id, // edge itself revealed early
        revealIndex: f.sections[0]!.position,
      },
    });
    const reader = await getViewer(f.reader.id, f.seriesId);
    expect(await listRelationsForCard(reader, visibleCard.id)).toHaveLength(0);

    const owner = await getViewer(f.owner.id, f.seriesId);
    expect(await listRelationsForCard(owner, visibleCard.id)).toHaveLength(1);
  });
});

describe("revisions are gated content", () => {
  it("never returns a diff whose revealIndex exceeds the viewer's progress", async () => {
    const f = await createFixture();
    const owner = await getViewer(f.owner.id, f.seriesId);
    const cardId = await createCard(owner, {
      type: "CHARACTER",
      title: "The Betrayer",
      revealSectionId: f.sections[3]!.id, // position 4
      fields: [],
    });
    const reader = await getViewer(f.reader.id, f.seriesId); // position 2

    const forReader = await listRevisions(reader, "CARD", cardId);
    expect(forReader.items).toHaveLength(0);

    const forOwner = await listRevisions(owner, "CARD", cardId);
    expect(forOwner.items.length).toBeGreaterThan(0);
    expect(forOwner.items[0]!.diff).toBeTruthy();
  });
});

describe("timeline clamping", () => {
  it("clamps to the viewer's revealIndex even when a range parameter requests a later window", async () => {
    const f = await createFixture();
    for (let i = 0; i < 5; i++) {
      await prisma.timelineEntry.create({
        data: {
          seriesId: f.seriesId,
          label: `Event ${i + 1}`,
          revealSectionId: f.sections[i]!.id,
          revealIndex: f.sections[i]!.position,
          eraId: f.eras[0]!.id,
          year: 100 + i,
          precision: "YEAR",
          absoluteSortKey: BigInt(100 + i) * 1_000_000n,
        },
      });
    }
    const reader = await getViewer(f.reader.id, f.seriesId); // position 2
    const clamped = await listTimeline(reader, { maxRevealIndex: 999 });
    expect(clamped.dated).toHaveLength(2);
    expect(clamped.dated.every((e) => e.revealIndex <= 2)).toBe(true);

    const owner = await getViewer(f.owner.id, f.seriesId);
    expect((await listTimeline(owner)).dated).toHaveLength(5);
  });
});

describe("session goals are never gated; section titles are", () => {
  it("returns goalRevealIndex to a behind member while suppressing the goal section's title", async () => {
    const f = await createFixture();
    await prisma.clubSession.create({
      data: {
        seriesId: f.seriesId,
        title: "Meeting 3",
        goalSectionId: f.sections[3]!.id, // Book 2 · Chapter 3, position 4, title "The Return"
        goalRevealIndex: f.sections[3]!.position,
        createdById: f.owner.id,
        status: "ACTIVE",
      },
    });
    const reader = await getViewer(f.reader.id, f.seriesId); // position 2 — behind
    const session = await getActiveSession(reader);
    expect(session).not.toBeNull();
    expect(session!.goalRevealIndex).toBe(4);
    expect(session!.goalSection.label).toBe("Book 2 · Chapter 3");
    expect(session!.goalSection.title).toBeNull();

    const owner = await getViewer(f.owner.id, f.seriesId); // position 5 — past it
    expect((await getActiveSession(owner))!.goalSection.title).toBe("The Return");
  });
});

describe("spoiler peek", () => {
  let f: Fixture;
  let gatedId: string;

  beforeAll(async () => {
    f = await createFixture();
    gatedId = (
      await makeCard(f.seriesId, f.owner.id, {
        type: "EVENT",
        title: "The Final Battle",
        section: f.sections[4]!,
      })
    ).id;
  });

  it("lifts the gate for EDITOR and OWNER", async () => {
    const editorPeek = await getViewer(f.editor.id, f.seriesId, true); // editor sits at 3
    const { items } = await listCards(editorPeek);
    const item = items.find((i) => i.id === gatedId);
    expect(item).toMatchObject({ locked: false, title: "The Final Battle" });

    const editorPlain = await getViewer(f.editor.id, f.seriesId);
    const plain = (await listCards(editorPlain)).items.find((i) => i.id === gatedId);
    expect(plain).toEqual({ id: gatedId, locked: true });
  });

  it("rejects a READER request carrying the peek flag — not silently ignored", async () => {
    await expect(getViewer(f.reader.id, f.seriesId, true)).rejects.toThrow(PeekForbiddenError);
  });
});

describe("reveal-point cascade", () => {
  it("raising a card raises its earlier fields and relations; lowering does not cascade", async () => {
    const f = await createFixture();
    const owner = await getViewer(f.owner.id, f.seriesId);
    const card = await makeCard(f.seriesId, f.owner.id, {
      type: "CHARACTER",
      title: "Cascade Subject",
      section: f.sections[1]!, // position 2
    });
    const other = await makeCard(f.seriesId, f.owner.id, {
      type: "LOCATION",
      title: "Somewhere",
      section: f.sections[0]!,
    });
    const aliases = await templateField(f.seriesId, "CHARACTER", "aliases");
    const field = await prisma.cardField.create({
      data: {
        cardId: card.id,
        templateFieldId: aliases.id,
        value: "early field",
        revealSectionId: f.sections[1]!.id,
        revealIndex: 2,
      },
    });
    const relation = await prisma.cardRelation.create({
      data: {
        fromCardId: card.id,
        toCardId: other.id,
        type: "located in",
        revealSectionId: f.sections[0]!.id,
        revealIndex: 1,
      },
    });

    // raise 2 -> 4: both dependents precede it, both are raised
    await setCardRevealPoint(owner, card.id, f.sections[3]!.id);
    expect((await prisma.cardField.findUnique({ where: { id: field.id } }))!.revealIndex).toBe(4);
    expect((await prisma.cardRelation.findUnique({ where: { id: relation.id } }))!.revealIndex).toBe(4);

    // lower 4 -> 1: card moves, dependents do NOT follow down
    await setCardRevealPoint(owner, card.id, f.sections[0]!.id);
    expect((await prisma.card.findUnique({ where: { id: card.id } }))!.revealIndex).toBe(1);
    expect((await prisma.cardField.findUnique({ where: { id: field.id } }))!.revealIndex).toBe(4);
    expect((await prisma.cardRelation.findUnique({ where: { id: relation.id } }))!.revealIndex).toBe(4);
  });
});

describe("structure edits", () => {
  it("inserting a section mid-series recomputes positions and every dependent revealIndex; content stays gated at the same SECTION", async () => {
    const f = await createFixture();
    const gatedCard = await makeCard(f.seriesId, f.owner.id, {
      type: "EVENT",
      title: "Mid-book Twist",
      section: f.sections[2]!, // "The Middle", position 3 — above reader at 2
    });

    // insert a prologue at the very start of book 1 — everything shifts by one
    await insertSection(f.seriesId, {
      bookId: f.book1.id,
      type: "PRELUDE",
      afterSectionId: null,
    });

    const positions = await prisma.section.findMany({
      where: { book: { seriesId: f.seriesId }, deletedAt: null },
      orderBy: { position: "asc" },
      select: { position: true },
    });
    expect(positions.map((p) => p.position)).toEqual([1, 2, 3, 4, 5, 6]); // dense, gapless

    const card = await prisma.card.findUnique({ where: { id: gatedCard.id } });
    expect(card!.revealSectionId).toBe(f.sections[2]!.id); // same section (FK: source of truth)
    expect(card!.revealIndex).toBe(4); // shifted cache

    // reader's membership cache also shifted (was 2, now 3) — still below the card
    const reader = await getViewer(f.reader.id, f.seriesId);
    expect(reader.revealIndex).toBe(3);
    const item = (await listCards(reader)).items.find((i) => i.id === gatedCard.id);
    expect(item).toEqual({ id: gatedCard.id, locked: true });
  });
});

describe("calendar era offsets", () => {
  it("changing an era's yearOffset recomputes every dependent absoluteSortKey", async () => {
    const f = await createFixture();
    const owner = await getViewer(f.owner.id, f.seriesId);
    const secondAge = f.eras[1]!; // yearOffset 1000
    const entry = await prisma.timelineEntry.create({
      data: {
        seriesId: f.seriesId,
        label: "Founding of the Vale",
        revealSectionId: f.sections[0]!.id,
        revealIndex: 1,
        eraId: secondAge.id,
        year: 100,
        precision: "YEAR",
        absoluteSortKey: 1100n * 1_000_000n,
      },
    });
    await updateEraYearOffset(owner, secondAge.id, 2000);
    const updated = await prisma.timelineEntry.findUnique({ where: { id: entry.id } });
    expect(updated!.absoluteSortKey).toBe(2100n * 1_000_000n);
  });
});

describe("soft delete", () => {
  it("excludes soft-deleted rows from all default reads and search; restore brings them back", async () => {
    const f = await createFixture();
    const owner = await getViewer(f.owner.id, f.seriesId);
    const card = await makeCard(f.seriesId, f.owner.id, {
      type: "ITEM",
      title: "Vanishing Blade",
      section: f.sections[0]!,
    });

    await softDeleteCard(owner, card.id);
    expect((await listCards(owner)).items.map((i) => i.id)).not.toContain(card.id);
    expect((await searchCards(owner, "Vanishing")).items).toHaveLength(0);
    expect((await graphData(owner)).nodes.map((n) => n.id)).not.toContain(card.id);
    expect(await getCardDetail(owner, card.id)).toBeNull();

    await restoreCard(owner, card.id);
    expect((await listCards(owner)).items.map((i) => i.id)).toContain(card.id);
  });
});

describe("revision series scoping", () => {
  it("returns nothing for an entity outside the viewer's series", async () => {
    const fA = await createFixture();
    const fB = await createFixture();
    const ownerB = await getViewer(fB.owner.id, fB.seriesId);
    const cardB = await createCard(ownerB, {
      type: "CHARACTER",
      title: "Foreign Secret",
      revealSectionId: fB.sections[0]!.id,
      fields: [],
    });
    // ownerA's revealIndex (5) would numerically pass the gate — but revealIndex
    // is a per-series axis; a cross-series entityId must return nothing.
    const ownerA = await getViewer(fA.owner.id, fA.seriesId);
    expect((await listRevisions(ownerA, "CARD", cardB)).items).toHaveLength(0);
    expect((await listRevisions(ownerB, "CARD", cardB)).items.length).toBeGreaterThan(0);
  });
});

describe("structure ordering safety", () => {
  it("rejects an insert anchor from a different book", async () => {
    const f = await createFixture();
    await expect(
      insertSection(f.seriesId, {
        bookId: f.book1.id,
        type: "CHAPTER",
        number: 99,
        afterSectionId: f.sections[3]!.id, // lives in book 2
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects cross-book moves; in-book moves stay dense and reproducible", async () => {
    const f = await createFixture();
    // book-2 section anchored after a book-1 section would interleave books
    await expect(moveSection(f.seriesId, f.sections[3]!.id, f.sections[0]!.id)).rejects.toThrow(
      AppError,
    );
    // move ch2 to the start of its own book
    await moveSection(f.seriesId, f.sections[2]!.id, null);
    const rows = await prisma.section.findMany({
      where: { book: { seriesId: f.seriesId }, deletedAt: null },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]!.id).toBe(f.sections[2]!.id);
  });
});

describe("owner lowering progress", () => {
  it("treats a non-lowering request as a silent no-op — no comparison oracle", async () => {
    const f = await createFixture();
    const owner = await getViewer(f.owner.id, f.seriesId);
    // reader sits at position 2; probing an equal-or-higher section must not
    // error (a distinguishable failure would let an owner binary-search the
    // member's exact position)
    await expect(lowerMemberProgress(owner, f.reader.id, f.sections[3]!.id)).resolves.toBeUndefined();
    const unchanged = await prisma.membership.findUnique({
      where: { userId_seriesId: { userId: f.reader.id, seriesId: f.seriesId } },
    });
    expect(unchanged!.revealIndex).toBe(2);
    // genuine lowering still applies
    await lowerMemberProgress(owner, f.reader.id, f.sections[0]!.id);
    const lowered = await prisma.membership.findUnique({
      where: { userId_seriesId: { userId: f.reader.id, seriesId: f.seriesId } },
    });
    expect(lowered!.revealIndex).toBe(1);
  });
});

describe("invites & registration", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture();
  });

  async function makeInvite(overrides: {
    revokedAt?: Date;
    expiresAt?: Date;
    maxUses?: number;
    useCount?: number;
  }): Promise<string> {
    const invite = await prisma.invite.create({
      data: {
        seriesId: f.seriesId,
        code: randomUUID(),
        role: "READER",
        createdById: f.owner.id,
        ...overrides,
      },
    });
    return invite.code;
  }

  it("rejects a revoked invite at both registration and join", async () => {
    const code = await makeInvite({ revokedAt: new Date() });
    await expect(getValidInvite(code)).rejects.toThrow(AppError);
    const user = await createUser("joiner1");
    await expect(redeemInvite(code, user.id)).rejects.toThrow(AppError);
    await expect(
      registerUser({ email: `x-${randomUUID()}@t.local`, name: "x", password: "longenough", inviteCode: code }),
    ).rejects.toThrow(AppError);
  });

  it("rejects an expired invite", async () => {
    const code = await makeInvite({ expiresAt: new Date(Date.now() - 1000) });
    const user = await createUser("joiner2");
    await expect(redeemInvite(code, user.id)).rejects.toThrow(AppError);
  });

  it("rejects an exhausted invite", async () => {
    const code = await makeInvite({ maxUses: 1, useCount: 1 });
    const user = await createUser("joiner3");
    await expect(redeemInvite(code, user.id)).rejects.toThrow(AppError);
  });

  it("makes registration unreachable without a valid code", async () => {
    await expect(
      registerUser({ email: `y-${randomUUID()}@t.local`, name: "y", password: "longenough" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      registerUser({
        email: `z-${randomUUID()}@t.local`,
        name: "z",
        password: "longenough",
        inviteCode: "no-such-code",
      }),
    ).rejects.toThrow();
  });

  it("redeems a valid invite: registration + membership at series start", async () => {
    const code = await makeInvite({ maxUses: 2 });
    const { userId, seriesId } = await registerUser({
      email: `ok-${randomUUID()}@t.local`,
      name: "New Reader",
      password: "longenough",
      inviteCode: code,
    });
    expect(seriesId).toBe(f.seriesId);
    const membership = await prisma.membership.findUnique({
      where: { userId_seriesId: { userId, seriesId: f.seriesId } },
    });
    expect(membership).toMatchObject({ role: "READER", revealIndex: 0, currentSectionId: null });
    const invite = await prisma.invite.findUnique({ where: { code } });
    expect(invite!.useCount).toBe(1);
  });

  it("rejects duplicate emails", async () => {
    const code = await makeInvite({});
    const email = `dup-${randomUUID()}@t.local`;
    await registerUser({ email, name: "a", password: "longenough", inviteCode: code });
    await expect(
      registerUser({ email, name: "b", password: "longenough", inviteCode: code }),
    ).rejects.toThrow(ConflictError);
  });

  // LAST in this file: wipes the database to reach the empty-table state.
  it("allows the very first account to bootstrap without an invite", async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "User", "Series" CASCADE');
    expect(await isBootstrap()).toBe(true);
    const { userId, seriesId } = await registerUser({
      email: "founder@t.local",
      name: "Founder",
      password: "longenough",
    });
    expect(userId).toBeTruthy();
    expect(seriesId).toBeNull();
    expect(await isBootstrap()).toBe(false);
  });
});
