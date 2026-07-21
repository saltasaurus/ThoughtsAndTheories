import { beforeAll, describe, expect, it } from "vitest";
import {
  GET as cardDetailGET,
  PATCH as cardPATCH,
} from "@/app/api/v1/series/[seriesId]/cards/[cardId]/route";
import { GET as cardsGET, POST as cardsPOST } from "@/app/api/v1/series/[seriesId]/cards/route";
import { GET as searchGET } from "@/app/api/v1/series/[seriesId]/search/route";
import { GET as timelineGET } from "@/app/api/v1/series/[seriesId]/timeline/route";
import { prisma } from "@/lib/db";
import { createApiToken, revokeApiToken } from "@/lib/services/api-tokens";
import { getViewer, listCards } from "@/lib/visibility";
import { createFixture, makeCard, type Fixture } from "@/tests/fixture";

const BASE = "http://localhost/api/v1";

function req(path: string, token?: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

describe("api v1 — token authentication", () => {
  let f: Fixture;
  let readerToken: string;

  beforeAll(async () => {
    f = await createFixture();
    readerToken = (await createApiToken(f.reader.id, "test")).token;
  });

  it("401s an unauthenticated request — no leak, no 501 stub", async () => {
    const res = await cardsGET(req(`/series/${f.seriesId}/cards`), ctx({ seriesId: f.seriesId }));
    expect(res.status).toBe(401);
  });

  it("401s a garbage token", async () => {
    const res = await cardsGET(
      req(`/series/${f.seriesId}/cards`, "tt_notarealtoken"),
      ctx({ seriesId: f.seriesId }),
    );
    expect(res.status).toBe(401);
  });

  it("401s a revoked token", async () => {
    const { id, token } = await createApiToken(f.reader.id, "doomed");
    await revokeApiToken(f.reader.id, id);
    const res = await cardsGET(
      req(`/series/${f.seriesId}/cards`, token),
      ctx({ seriesId: f.seriesId }),
    );
    expect(res.status).toBe(401);
  });

  it("404s a valid token against a series the user is not a member of", async () => {
    const other = await createFixture();
    const res = await cardsGET(
      req(`/series/${other.seriesId}/cards`, readerToken),
      ctx({ seriesId: other.seriesId }),
    );
    expect(res.status).toBe(404); // never 200, and never a 403 that would confirm it exists
  });

  it("records lastUsedAt on a successful call", async () => {
    const { id, token } = await createApiToken(f.reader.id, "tracked");
    expect((await prisma.apiToken.findUnique({ where: { id } }))?.lastUsedAt).toBeNull();
    await cardsGET(req(`/series/${f.seriesId}/cards`, token), ctx({ seriesId: f.seriesId }));
    expect((await prisma.apiToken.findUnique({ where: { id } }))?.lastUsedAt).not.toBeNull();
  });
});

describe("api v1 — gating is byte-identical to the UI", () => {
  let f: Fixture;
  let readerToken: string;
  let gatedId: string;
  let visibleId: string;

  beforeAll(async () => {
    f = await createFixture();
    readerToken = (await createApiToken(f.reader.id, "reader")).token;
    visibleId = (
      await makeCard(f.seriesId, f.owner.id, {
        type: "CHARACTER",
        title: "Aldric the Bold",
        section: f.sections[0]!,
      })
    ).id;
    gatedId = (
      await makeCard(f.seriesId, f.owner.id, {
        type: "CHARACTER",
        title: "Hidden Villain",
        summary: "verysecret identity",
        section: f.sections[3]!,
      })
    ).id;
  });

  it("returns ONLY { id, locked: true } for a gated card in the list", async () => {
    const res = await cardsGET(
      req(`/series/${f.seriesId}/cards`, readerToken),
      ctx({ seriesId: f.seriesId }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    const locked = body.items.find((i) => i.id === gatedId);
    expect(locked).toEqual({ id: gatedId, locked: true });
    expect(Object.keys(locked!).sort()).toEqual(["id", "locked"]);
  });

  it("matches listCards exactly — one gate, not two", async () => {
    const viewer = await getViewer(f.reader.id, f.seriesId);
    const fromUi = await listCards(viewer);
    const res = await cardsGET(
      req(`/series/${f.seriesId}/cards`, readerToken),
      ctx({ seriesId: f.seriesId }),
    );
    const fromApi = await res.json();
    expect(fromApi).toEqual(JSON.parse(JSON.stringify(fromUi)));
  });

  it("404s a gated card's detail rather than hinting it exists", async () => {
    const res = await cardDetailGET(
      req(`/series/${f.seriesId}/cards/${gatedId}`, readerToken),
      ctx({ seriesId: f.seriesId, cardId: gatedId }),
    );
    expect(res.status).toBe(404);
  });

  it("serves a visible card's detail", async () => {
    const res = await cardDetailGET(
      req(`/series/${f.seriesId}/cards/${visibleId}`, readerToken),
      ctx({ seriesId: f.seriesId, cardId: visibleId }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe("Aldric the Bold");
  });

  it("omits gated cards from search entirely — no placeholder, no match", async () => {
    const res = await searchGET(
      req(`/series/${f.seriesId}/search?q=verysecret`, readerToken),
      ctx({ seriesId: f.seriesId }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
  });

  it("serialises the timeline's BigInt sort keys instead of throwing", async () => {
    await prisma.timelineEntry.create({
      data: {
        seriesId: f.seriesId,
        label: "Founding",
        revealSectionId: f.sections[0]!.id,
        revealIndex: f.sections[0]!.position,
        eraId: f.eras[0]!.id,
        year: 5,
        precision: "YEAR",
        absoluteSortKey: 5_000_000n,
      },
    });
    const res = await timelineGET(
      req(`/series/${f.seriesId}/timeline`, readerToken),
      ctx({ seriesId: f.seriesId }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dated[0]?.absoluteSortKey).toBe("5000000"); // string, not a crash
  });
});

describe("api v1 — writes reuse the service layer's roles", () => {
  let f: Fixture;
  let editorToken: string;
  let readerToken: string;

  beforeAll(async () => {
    f = await createFixture();
    editorToken = (await createApiToken(f.editor.id, "editor")).token;
    readerToken = (await createApiToken(f.reader.id, "reader")).token;
  });

  it("lets an EDITOR token create a card", async () => {
    const res = await cardsPOST(
      req(`/series/${f.seriesId}/cards`, editorToken, {
        method: "POST",
        body: JSON.stringify({
          type: "LOCATION",
          title: "Vale Keep",
          revealSectionId: f.sections[0]!.id,
          fields: [],
        }),
      }),
      ctx({ seriesId: f.seriesId }),
    );
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(await prisma.card.findUnique({ where: { id } })).not.toBeNull();
  });

  it("403s a READER token trying to write", async () => {
    const res = await cardsPOST(
      req(`/series/${f.seriesId}/cards`, readerToken, {
        method: "POST",
        body: JSON.stringify({
          type: "LOCATION",
          title: "Should not exist",
          revealSectionId: f.sections[0]!.id,
          fields: [],
        }),
      }),
      ctx({ seriesId: f.seriesId }),
    );
    expect(res.status).toBe(403);
    expect(await prisma.card.findFirst({ where: { title: "Should not exist" } })).toBeNull();
  });

  it("400s an invalid body instead of 500ing", async () => {
    const res = await cardsPOST(
      req(`/series/${f.seriesId}/cards`, editorToken, {
        method: "POST",
        body: JSON.stringify({ type: "NOT_A_TYPE", title: "" }),
      }),
      ctx({ seriesId: f.seriesId }),
    );
    expect(res.status).toBe(400);
  });

  it("400s a malformed JSON body", async () => {
    const res = await cardsPOST(
      req(`/series/${f.seriesId}/cards`, editorToken, { method: "POST", body: "{not json" }),
      ctx({ seriesId: f.seriesId }),
    );
    expect(res.status).toBe(400);
  });

  it("lets an EDITOR token patch a card", async () => {
    const card = await makeCard(f.seriesId, f.owner.id, {
      type: "ITEM",
      title: "Old name",
      section: f.sections[0]!,
    });
    const res = await cardPATCH(
      req(`/series/${f.seriesId}/cards/${card.id}`, editorToken, {
        method: "PATCH",
        body: JSON.stringify({ title: "New name" }),
      }),
      ctx({ seriesId: f.seriesId, cardId: card.id }),
    );
    expect(res.status).toBe(200);
    expect((await prisma.card.findUnique({ where: { id: card.id } }))?.title).toBe("New name");
  });
});
