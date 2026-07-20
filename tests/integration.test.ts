import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getCardDetail, getViewer, listCards, listTimeline, type Viewer } from "@/lib/visibility";
import { createFixture, makeCard, type Fixture } from "@/tests/fixture";

/**
 * The spec's integration test: two users at different progress points get
 * correctly different API payloads from the same series.
 */
describe("two users at different progress points", () => {
  let f: Fixture;
  let ahead: Viewer; // owner @ position 5
  let behind: Viewer; // reader @ position 2
  let earlyCardId: string;
  let lateCardId: string;

  beforeAll(async () => {
    f = await createFixture();
    earlyCardId = (
      await makeCard(f.seriesId, f.owner.id, {
        type: "CHARACTER",
        title: "The Guide",
        section: f.sections[0]!, // position 1 — visible to both
      })
    ).id;
    lateCardId = (
      await makeCard(f.seriesId, f.owner.id, {
        type: "THEORY",
        title: "Endgame Theory",
        section: f.sections[4]!, // position 5 — visible only to `ahead`
      })
    ).id;
    // a field on the early card that reveals late
    const template = await prisma.template.findUnique({
      where: { seriesId_cardType: { seriesId: f.seriesId, cardType: "CHARACTER" } },
      include: { fields: true },
    });
    const aliases = template!.fields.find((x) => x.key === "aliases")!;
    await prisma.cardField.create({
      data: {
        cardId: earlyCardId,
        templateFieldId: aliases.id,
        value: "Actually the Endgame Villain",
        revealSectionId: f.sections[4]!.id,
        revealIndex: 5,
      },
    });
    // timeline entries revealed at positions 1 and 5
    for (const [i, sectionIdx] of [0, 4].entries()) {
      await prisma.timelineEntry.create({
        data: {
          seriesId: f.seriesId,
          label: `Integration Event ${i + 1}`,
          revealSectionId: f.sections[sectionIdx]!.id,
          revealIndex: f.sections[sectionIdx]!.position,
          eraId: f.eras[0]!.id,
          year: 10 + i,
          precision: "YEAR",
          absoluteSortKey: BigInt(10 + i) * 1_000_000n,
        },
      });
    }
    ahead = await getViewer(f.owner.id, f.seriesId);
    behind = await getViewer(f.reader.id, f.seriesId);
  });

  it("card lists differ: same slots, gated ones locked only for the behind user", async () => {
    const aheadList = (await listCards(ahead)).items;
    const behindList = (await listCards(behind)).items;
    expect(aheadList).toHaveLength(behindList.length); // count is deliberately disclosed

    expect(aheadList.every((i) => i.locked === false)).toBe(true);
    const behindLate = behindList.find((i) => i.id === lateCardId);
    expect(behindLate).toEqual({ id: lateCardId, locked: true });
    const behindEarly = behindList.find((i) => i.id === earlyCardId);
    expect(behindEarly).toMatchObject({ locked: false, title: "The Guide" });
  });

  it("card detail: full for ahead, null for behind on a gated card", async () => {
    expect(await getCardDetail(ahead, lateCardId)).toMatchObject({ title: "Endgame Theory" });
    expect(await getCardDetail(behind, lateCardId)).toBeNull();
  });

  it("the same visible card exposes different field sets", async () => {
    const forAhead = await getCardDetail(ahead, earlyCardId);
    const forBehind = await getCardDetail(behind, earlyCardId);
    expect(forAhead!.fields.map((x) => x.key)).toContain("aliases");
    expect(forBehind!.fields.map((x) => x.key)).not.toContain("aliases");
  });

  it("timeline payloads clamp to each user's progress", async () => {
    expect((await listTimeline(ahead)).dated).toHaveLength(2);
    const behindTimeline = (await listTimeline(behind)).dated;
    expect(behindTimeline).toHaveLength(1);
    expect(behindTimeline[0]!.label).toBe("Integration Event 1");
  });
});
