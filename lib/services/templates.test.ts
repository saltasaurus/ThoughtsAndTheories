import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { createCard } from "@/lib/services/cards";
import {
  addField,
  listTemplates,
  moveField,
  reorderFields,
  restoreField,
  retireField,
  updateField,
} from "@/lib/services/templates";
import { getViewer, type Viewer } from "@/lib/visibility";
import { createFixture, type Fixture } from "@/tests/fixture";

async function characterTemplate(seriesId: string) {
  const t = await prisma.template.findUnique({
    where: { seriesId_cardType: { seriesId, cardType: "CHARACTER" } },
    include: { fields: { where: { deletedAt: null }, orderBy: [{ order: "asc" }, { id: "asc" }] } },
  });
  if (!t) throw new Error("missing CHARACTER template");
  return t;
}

async function fieldByKey(seriesId: string, key: string) {
  const t = await characterTemplate(seriesId);
  const f = t.fields.find((x) => x.key === key);
  if (!f) throw new Error(`missing template field ${key}`);
  return f;
}

/** Live field keys in template order — what a card-creation form would render. */
async function liveKeys(seriesId: string): Promise<string[]> {
  const t = await characterTemplate(seriesId);
  return t.fields.map((f) => f.key);
}

describe("template editor — permissions", () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createFixture();
  });

  it("rejects non-owners on every mutation", async () => {
    const t = await characterTemplate(f.seriesId);
    const field = await fieldByKey(f.seriesId, "aliases");
    for (const userId of [f.editor.id, f.reader.id]) {
      const viewer = await getViewer(userId, f.seriesId);
      await expect(
        addField(viewer, t.id, { key: "x", label: "X", fieldType: "TEXT" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(updateField(viewer, field.id, { label: "X" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(reorderFields(viewer, t.id, [field.id])).rejects.toBeInstanceOf(ForbiddenError);
      await expect(retireField(viewer, field.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listTemplates(viewer)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("template editor — add & key uniqueness", () => {
  let f: Fixture;
  let owner: Viewer;

  beforeAll(async () => {
    f = await createFixture();
    owner = await getViewer(f.owner.id, f.seriesId);
  });

  it("appends a new field after the existing ones", async () => {
    const t = await characterTemplate(f.seriesId);
    const before = t.fields.length;
    await addField(owner, t.id, { key: "epithet", label: "Epithet", fieldType: "TEXT" });
    const after = await characterTemplate(f.seriesId);
    expect(after.fields.length).toBe(before + 1);
    expect(after.fields[after.fields.length - 1]?.key).toBe("epithet");
  });

  it("rejects a duplicate key within the template — nothing else enforces it", async () => {
    const t = await characterTemplate(f.seriesId);
    await expect(
      addField(owner, t.id, { key: "aliases", label: "Aliases again", fieldType: "TEXT" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("allows the same key in a DIFFERENT card type's template", async () => {
    const location = await prisma.template.findUnique({
      where: { seriesId_cardType: { seriesId: f.seriesId, cardType: "LOCATION" } },
    });
    await expect(
      addField(owner, location!.id, { key: "aliases", label: "Aliases", fieldType: "TEXT" }),
    ).resolves.toBeTruthy();
  });
});

describe("template editor — fieldType and options guards", () => {
  let f: Fixture;
  let owner: Viewer;

  beforeAll(async () => {
    f = await createFixture();
    owner = await getViewer(f.owner.id, f.seriesId);
    const aliases = await fieldByKey(f.seriesId, "aliases");
    const status = await fieldByKey(f.seriesId, "status");
    await createCard(owner, {
      type: "CHARACTER",
      title: "Aldric",
      revealSectionId: f.sections[0]!.id,
      fields: [
        { templateFieldId: aliases.id, value: "The Bold" },
        { templateFieldId: status.id, value: "Alive" },
      ],
    });
  });

  it("rejects retyping a field that already has stored values", async () => {
    const aliases = await fieldByKey(f.seriesId, "aliases");
    await expect(updateField(owner, aliases.id, { fieldType: "NUMBER" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    // and the stored type is unchanged
    expect((await fieldByKey(f.seriesId, "aliases")).fieldType).toBe("TEXT");
  });

  it("allows retyping a field with no stored values", async () => {
    const portrait = await fieldByKey(f.seriesId, "portrait");
    await updateField(owner, portrait.id, { fieldType: "TEXT" });
    expect((await fieldByKey(f.seriesId, "portrait")).fieldType).toBe("TEXT");
  });

  it("rejects removing a SELECT choice a stored value still uses", async () => {
    const status = await fieldByKey(f.seriesId, "status");
    await expect(
      updateField(owner, status.id, { options: { choices: ["Dead", "Unknown"] } }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("allows adding a choice, and removing an unused one", async () => {
    const status = await fieldByKey(f.seriesId, "status");
    await updateField(owner, status.id, {
      options: { choices: ["Alive", "Missing"] }, // drops Dead/Unknown (unused), adds Missing
    });
    const updated = await fieldByKey(f.seriesId, "status");
    expect((updated.options as { choices: string[] }).choices).toEqual(["Alive", "Missing"]);
  });

  it("edits label / required / defaultRevealBehavior freely", async () => {
    const aliases = await fieldByKey(f.seriesId, "aliases");
    await updateField(owner, aliases.id, {
      label: "Also known as",
      required: true,
      defaultRevealBehavior: "SERIES_START",
    });
    const updated = await fieldByKey(f.seriesId, "aliases");
    expect(updated.label).toBe("Also known as");
    expect(updated.required).toBe(true);
    expect(updated.defaultRevealBehavior).toBe("SERIES_START");
  });
});

describe("template editor — reorder", () => {
  let f: Fixture;
  let owner: Viewer;

  beforeAll(async () => {
    f = await createFixture();
    owner = await getViewer(f.owner.id, f.seriesId);
  });

  it("persists an explicit order, and card forms read it back", async () => {
    const t = await characterTemplate(f.seriesId);
    const reversed = [...t.fields].reverse().map((x) => x.id);
    await reorderFields(owner, t.id, reversed);
    const after = await characterTemplate(f.seriesId);
    expect(after.fields.map((x) => x.id)).toEqual(reversed);
    expect(after.fields.map((x) => x.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps omitted fields after the listed ones instead of dropping them", async () => {
    const t = await characterTemplate(f.seriesId);
    const last = t.fields[t.fields.length - 1]!;
    await reorderFields(owner, t.id, [last.id]);
    const after = await characterTemplate(f.seriesId);
    expect(after.fields[0]?.id).toBe(last.id);
    expect(after.fields.length).toBe(t.fields.length); // nothing lost
  });

  it("moveField swaps with a neighbour and no-ops at the edges", async () => {
    const before = await liveKeys(f.seriesId);
    const first = (await characterTemplate(f.seriesId)).fields[0]!;
    await moveField(owner, first.id, -1); // already at the top
    expect(await liveKeys(f.seriesId)).toEqual(before);

    await moveField(owner, first.id, 1);
    const after = await liveKeys(f.seriesId);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
  });

  it("refuses to reorder a field from another template", async () => {
    const t = await characterTemplate(f.seriesId);
    const other = await prisma.template.findUnique({
      where: { seriesId_cardType: { seriesId: f.seriesId, cardType: "LOCATION" } },
      include: { fields: true },
    });
    await expect(reorderFields(owner, t.id, [other!.fields[0]!.id])).rejects.toThrow();
  });
});

describe("template editor — retire leaves card data untouched", () => {
  let f: Fixture;
  let owner: Viewer;
  let cardId: string;
  let aliasesFieldId: string;

  beforeAll(async () => {
    f = await createFixture();
    owner = await getViewer(f.owner.id, f.seriesId);
    const aliases = await fieldByKey(f.seriesId, "aliases");
    aliasesFieldId = aliases.id;
    cardId = await createCard(owner, {
      type: "CHARACTER",
      title: "Aldric",
      revealSectionId: f.sections[0]!.id,
      fields: [{ templateFieldId: aliases.id, value: "The Bold" }],
    });
  });

  it("removes the field from new-card forms but preserves the stored CardField row", async () => {
    expect(await liveKeys(f.seriesId)).toContain("aliases");
    await retireField(owner, aliasesFieldId);

    // gone from the form
    expect(await liveKeys(f.seriesId)).not.toContain("aliases");

    // but the card's stored value is intact and NOT soft-deleted
    const stored = await prisma.cardField.findFirst({
      where: { cardId, templateFieldId: aliasesFieldId },
    });
    expect(stored).not.toBeNull();
    expect(stored!.deletedAt).toBeNull();
    expect(stored!.value).toBe("The Bold");
  });

  it("surfaces retired fields separately and can restore them", async () => {
    const templates = await listTemplates(owner);
    const character = templates.find((t) => t.cardType === "CHARACTER")!;
    expect(character.retired.map((r) => r.key)).toContain("aliases");

    await restoreField(owner, aliasesFieldId);
    expect(await liveKeys(f.seriesId)).toContain("aliases");
  });

  it("refuses to restore into a key a live field has taken", async () => {
    const t = await characterTemplate(f.seriesId);
    const status = await fieldByKey(f.seriesId, "status");
    await retireField(owner, status.id);
    await addField(owner, t.id, { key: "status", label: "Status (new)", fieldType: "TEXT" });
    await expect(restoreField(owner, status.id)).rejects.toBeInstanceOf(ConflictError);
  });
});
