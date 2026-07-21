import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createCard, setCardField } from "@/lib/services/cards";
import { getRosterAnalytics } from "@/lib/services/memberships";
import { createSeries } from "@/lib/services/series";
import { getCardDetail, getViewer, listRevisions, type Viewer } from "@/lib/visibility";
import { createFixture, createUser, type Fixture } from "@/tests/fixture";

describe("roster analytics — aggregate only", () => {
  let f: Fixture;
  let owner: Viewer;

  beforeAll(async () => {
    f = await createFixture();
    owner = await getViewer(f.owner.id, f.seriesId);
  });

  it("reports no goal (and zero counts) when no session is active", async () => {
    const a = await getRosterAnalytics(owner);
    expect(a.goalRevealIndex).toBeNull();
    expect(a.totalMembers).toBe(3);
    expect(a.counts).toEqual({ behind: 0, at_goal: 0, ahead: 0 });
  });

  it("counts members by state against the active goal", async () => {
    // goal at position 3: reader@2 behind, editor@3 at goal, owner@5 ahead
    await prisma.clubSession.create({
      data: {
        seriesId: f.seriesId,
        title: "Week 3",
        goalSectionId: f.sections[2]!.id,
        goalRevealIndex: f.sections[2]!.position,
        createdById: f.owner.id,
        status: "ACTIVE",
      },
    });
    const a = await getRosterAnalytics(owner);
    expect(a.goalRevealIndex).toBe(3);
    expect(a.counts).toEqual({ behind: 1, at_goal: 1, ahead: 1 });
    expect(a.counts.behind + a.counts.at_goal + a.counts.ahead).toBe(a.totalMembers);
  });

  it("exposes no member identity or position — counts and a goal, nothing else", async () => {
    const a = await getRosterAnalytics(owner);
    expect(Object.keys(a).sort()).toEqual(["counts", "goalRevealIndex", "totalMembers"]);
    expect(Object.keys(a.counts).sort()).toEqual(["ahead", "at_goal", "behind"]);
    expect(JSON.stringify(a)).not.toContain("userId");
  });

  it("handles a series with no sessions and a single member", async () => {
    const solo = await createUser("solo");
    const seriesId = await createSeries(solo.id, { title: "Empty" });
    const viewer = await getViewer(solo.id, seriesId);
    const a = await getRosterAnalytics(viewer);
    expect(a.totalMembers).toBe(1); // just the creating owner
    expect(a.goalRevealIndex).toBeNull();
    expect(a.counts).toEqual({ behind: 0, at_goal: 0, ahead: 0 });
  });
});

describe("revision history — a gated field's revisions are invisible, and look absent", () => {
  let f: Fixture;
  let owner: Viewer;
  let reader: Viewer;
  let cardId: string;
  let fieldId: string;

  beforeAll(async () => {
    f = await createFixture();
    owner = await getViewer(f.owner.id, f.seriesId);

    const template = await prisma.template.findUnique({
      where: { seriesId_cardType: { seriesId: f.seriesId, cardType: "CHARACTER" } },
      include: { fields: true },
    });
    const aliases = template!.fields.find((x) => x.key === "aliases")!;

    // Card is visible to the reader (position 1 <= 2)…
    cardId = await createCard(owner, {
      type: "CHARACTER",
      title: "Aldric",
      revealSectionId: f.sections[0]!.id,
      fields: [{ templateFieldId: aliases.id, value: "The Bold" }],
    });
    // …but this field edit is pushed to position 4, above the reader's progress.
    await setCardField(owner, cardId, aliases.id, {
      value: "The Betrayer",
      revealSectionId: f.sections[3]!.id,
    });
    const stored = await prisma.cardField.findFirst({
      where: { cardId, templateFieldId: aliases.id },
      select: { id: true },
    });
    fieldId = stored!.id;
    reader = await getViewer(f.reader.id, f.seriesId);
  });

  it("hides the gated field from the reader's card detail entirely", async () => {
    const detail = await getCardDetail(reader, cardId);
    expect(detail).not.toBeNull();
    expect(detail!.fields.find((x) => x.id === fieldId)).toBeUndefined();
  });

  it("shows only revisions at or below the reader's progress, and never the gated value", async () => {
    const res = await listRevisions(reader, "CARD_FIELD", fieldId);
    expect(res.items.every((r) => r.revealIndex <= reader.revealIndex)).toBe(true);
    // the later edit's content must not appear anywhere in the payload
    expect(JSON.stringify(res.items)).not.toContain("The Betrayer");
    // and nothing hints that more revisions exist above the gate
    expect(res.nextCursor).toBeNull();
  });

  it("is shape-identical to a field that never received a later revision", async () => {
    // Control: same series, a field whose only revision is its creation, all
    // below the reader's progress. The reader's view of the gated field must be
    // indistinguishable in shape from this — same row count, same keys, no
    // cursor — or the difference itself would disclose the hidden edit.
    const template = await prisma.template.findUnique({
      where: { seriesId_cardType: { seriesId: f.seriesId, cardType: "CHARACTER" } },
      include: { fields: true },
    });
    const aliases = template!.fields.find((x) => x.key === "aliases")!;
    const controlCard = await createCard(owner, {
      type: "CHARACTER",
      title: "Control",
      revealSectionId: f.sections[0]!.id,
      fields: [{ templateFieldId: aliases.id, value: "The Bold" }],
    });
    const controlField = await prisma.cardField.findFirst({
      where: { cardId: controlCard, templateFieldId: aliases.id },
      select: { id: true },
    });

    const gated = await listRevisions(reader, "CARD_FIELD", fieldId);
    const control = await listRevisions(reader, "CARD_FIELD", controlField!.id);

    expect(gated.items.length).toBe(control.items.length);
    expect(gated.nextCursor).toBe(control.nextCursor);
    expect(gated.items.map((r) => Object.keys(r).sort())).toEqual(
      control.items.map((r) => Object.keys(r).sort()),
    );
    expect(gated.items.map((r) => r.diff)).toEqual(control.items.map((r) => r.diff));
  });

  it("still shows the owner the full history", async () => {
    const res = await listRevisions(owner, "CARD_FIELD", fieldId);
    expect(res.items.length).toBeGreaterThan(0);
  });

  it("does not leak revisions of an entity in another series", async () => {
    const other = await createFixture();
    const otherOwner = await getViewer(other.owner.id, other.seriesId);
    const otherCard = await createCard(otherOwner, {
      type: "CHARACTER",
      title: "Elsewhere",
      revealSectionId: other.sections[0]!.id,
      fields: [],
    });
    // asking for another series' entity through THIS viewer yields nothing
    const res = await listRevisions(owner, "CARD", otherCard);
    expect(res).toEqual({ items: [], nextCursor: null });
  });
});
