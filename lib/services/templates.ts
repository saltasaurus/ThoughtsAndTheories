import { Prisma, type DefaultRevealBehavior, type FieldType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { requireOwner } from "@/lib/permissions";
import type { Viewer } from "@/lib/visibility";

type Tx = Prisma.TransactionClient;

export type FieldOptions = { choices?: string[] } | null;

/**
 * Editing a template never rewrites card data: per-field reveal points and
 * values live on the CardField row, so add/edit/reorder/retire only changes
 * what FUTURE cards are offered. That property is what makes this safe without
 * a data migration — and it is exactly what forces the two guards below.
 */

/** The choice strings a stored SELECT/MULTISELECT value depends on. */
function valueChoices(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

function optionsData(
  options: FieldOptions | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (options === undefined) return undefined; // leave untouched
  if (options === null) return Prisma.DbNull;
  return options as Prisma.InputJsonValue;
}

async function requireTemplate(
  tx: Tx,
  templateId: string,
  seriesId: string,
): Promise<{ id: string }> {
  const template = await tx.template.findFirst({
    where: { id: templateId, seriesId },
    select: { id: true },
  });
  if (!template) throw new NotFoundError("Template not found in this series");
  return template;
}

export type TemplateFieldInput = {
  key: string;
  label: string;
  fieldType: FieldType;
  options?: FieldOptions;
  required?: boolean;
  defaultRevealBehavior?: DefaultRevealBehavior;
};

export async function addField(
  viewer: Viewer,
  templateId: string,
  input: TemplateFieldInput,
): Promise<string> {
  requireOwner(viewer.role);
  return prisma.$transaction(async (tx) => {
    await requireTemplate(tx, templateId, viewer.seriesId);
    // The schema carries only @@index([templateId]) — there is no unique
    // constraint on (templateId, key), so nothing but this check stops a
    // duplicate key from shadowing an existing field.
    const clash = await tx.templateField.findFirst({
      where: { templateId, key: input.key, deletedAt: null },
      select: { id: true },
    });
    if (clash) throw new ConflictError(`A field with key "${input.key}" already exists here`);

    const last = await tx.templateField.findFirst({
      where: { templateId, deletedAt: null },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const created = await tx.templateField.create({
      data: {
        templateId,
        key: input.key,
        label: input.label,
        fieldType: input.fieldType,
        options: optionsData(input.options),
        required: input.required ?? false,
        order: (last?.order ?? 0) + 1,
        defaultRevealBehavior: input.defaultRevealBehavior ?? "CARD",
      },
      select: { id: true },
    });
    return created.id;
  });
}

/**
 * `key` is immutable after creation (it is the stable identifier); `fieldType`
 * and `options` are only mutable while no live value would be invalidated.
 */
export async function updateField(
  viewer: Viewer,
  fieldId: string,
  patch: {
    label?: string;
    required?: boolean;
    defaultRevealBehavior?: DefaultRevealBehavior;
    fieldType?: FieldType;
    options?: FieldOptions;
  },
): Promise<void> {
  requireOwner(viewer.role);
  await prisma.$transaction(async (tx) => {
    const field = await tx.templateField.findFirst({
      where: { id: fieldId, deletedAt: null, template: { seriesId: viewer.seriesId } },
    });
    if (!field) throw new NotFoundError("Template field not found in this series");

    // Deliberately NOT filtered by `card: { deletedAt: null }`. A soft-deleted
    // card is restorable, and restoreCard re-validates nothing — so ignoring
    // its values here would let an owner soft-delete a card, retype the field
    // (or drop a choice the card still uses), then restore it and end up with
    // exactly the malformed state the guards below exist to prevent.
    const liveValues = await tx.cardField.findMany({
      where: { templateFieldId: fieldId, deletedAt: null },
      select: { value: true },
    });

    // "Never touches existing data" cuts both ways: retyping TEXT → NUMBER
    // would leave every stored Json value malformed under the new type, and
    // nothing would ever re-validate it. Retyping is only safe with no data.
    if (
      patch.fieldType !== undefined &&
      patch.fieldType !== field.fieldType &&
      liveValues.length > 0
    ) {
      throw new ConflictError(
        `Cannot change the type of "${field.label}" — ${liveValues.length} card(s) already store a value for it. Retire this field and add a new one instead.`,
      );
    }

    // Narrowing choices would strand stored values outside the option set.
    const nextType = patch.fieldType ?? field.fieldType;
    if (patch.options !== undefined && (nextType === "SELECT" || nextType === "MULTISELECT")) {
      const choices = new Set(patch.options?.choices ?? []);
      const stranded = new Set<string>();
      for (const row of liveValues) {
        for (const v of valueChoices(row.value)) if (!choices.has(v)) stranded.add(v);
      }
      if (stranded.size > 0) {
        throw new ConflictError(
          `Cannot remove choice(s) still in use: ${[...stranded].sort().join(", ")}`,
        );
      }
    }

    await tx.templateField.update({
      where: { id: fieldId },
      data: {
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.required !== undefined ? { required: patch.required } : {}),
        ...(patch.defaultRevealBehavior !== undefined
          ? { defaultRevealBehavior: patch.defaultRevealBehavior }
          : {}),
        ...(patch.fieldType !== undefined ? { fieldType: patch.fieldType } : {}),
        ...(patch.options !== undefined ? { options: optionsData(patch.options) } : {}),
      },
    });
  });
}

/**
 * Write order 1..n following orderedFieldIds. Any live field the caller omits
 * keeps its relative order after the listed ones, so a partial list can never
 * silently drop a field out of the form.
 */
export async function reorderFields(
  viewer: Viewer,
  templateId: string,
  orderedFieldIds: string[],
): Promise<void> {
  requireOwner(viewer.role);
  await prisma.$transaction(async (tx) => {
    await requireTemplate(tx, templateId, viewer.seriesId);
    const live = await tx.templateField.findMany({
      where: { templateId, deletedAt: null },
      select: { id: true },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    });
    const liveIds = new Set(live.map((f) => f.id));
    for (const id of orderedFieldIds) {
      if (!liveIds.has(id)) throw new NotFoundError("Field does not belong to this template");
    }
    const listed = new Set(orderedFieldIds);
    const finalOrder = [
      ...orderedFieldIds,
      ...live.map((f) => f.id).filter((id) => !listed.has(id)),
    ];
    for (let i = 0; i < finalOrder.length; i++) {
      const id = finalOrder[i];
      if (id === undefined) continue;
      await tx.templateField.update({ where: { id }, data: { order: i + 1 } });
    }
  });
}

/** Move one field up (-1) or down (+1) among its live siblings — the UI primitive. */
export async function moveField(viewer: Viewer, fieldId: string, delta: number): Promise<void> {
  requireOwner(viewer.role);
  const field = await prisma.templateField.findFirst({
    where: { id: fieldId, deletedAt: null, template: { seriesId: viewer.seriesId } },
    select: { id: true, templateId: true },
  });
  if (!field) throw new NotFoundError("Template field not found in this series");
  const live = await prisma.templateField.findMany({
    where: { templateId: field.templateId, deletedAt: null },
    select: { id: true },
    orderBy: [{ order: "asc" }, { id: "asc" }],
  });
  const ids = live.map((f) => f.id);
  const from = ids.indexOf(fieldId);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return; // already at the edge — no-op
  ids.splice(to, 0, ...ids.splice(from, 1));
  await reorderFields(viewer, field.templateId, ids);
}

/**
 * Soft-retire a field: it disappears from card forms and card detail, but every
 * stored CardField row is left exactly as it was, so the data survives and the
 * field can be restored.
 */
export async function retireField(viewer: Viewer, fieldId: string): Promise<void> {
  requireOwner(viewer.role);
  const field = await prisma.templateField.findFirst({
    where: { id: fieldId, deletedAt: null, template: { seriesId: viewer.seriesId } },
    select: { id: true },
  });
  if (!field) throw new NotFoundError("Template field not found in this series");
  await prisma.templateField.update({ where: { id: fieldId }, data: { deletedAt: new Date() } });
}

export async function restoreField(viewer: Viewer, fieldId: string): Promise<void> {
  requireOwner(viewer.role);
  const field = await prisma.templateField.findFirst({
    where: { id: fieldId, deletedAt: { not: null }, template: { seriesId: viewer.seriesId } },
    select: { id: true, templateId: true, key: true },
  });
  if (!field) throw new NotFoundError("Retired field not found in this series");
  // A live field may have taken the key while this one was retired.
  const clash = await prisma.templateField.findFirst({
    where: { templateId: field.templateId, key: field.key, deletedAt: null },
    select: { id: true },
  });
  if (clash) throw new ConflictError(`A live field already uses the key "${field.key}"`);
  await prisma.templateField.update({ where: { id: fieldId }, data: { deletedAt: null } });
}

export type TemplateFieldView = {
  id: string;
  key: string;
  label: string;
  fieldType: FieldType;
  options: FieldOptions;
  required: boolean;
  order: number;
  defaultRevealBehavior: DefaultRevealBehavior;
  /** live CardField rows using this field — drives the "can't retype" hint */
  valueCount: number;
};

export type TemplateView = {
  id: string;
  cardType: string;
  fields: TemplateFieldView[];
  retired: Array<{ id: string; key: string; label: string; fieldType: FieldType }>;
};

/** Templates are authoring structure, not gated content — OWNER only. */
export async function listTemplates(viewer: Viewer): Promise<TemplateView[]> {
  requireOwner(viewer.role);
  const templates = await prisma.template.findMany({
    where: { seriesId: viewer.seriesId },
    include: { fields: { orderBy: [{ order: "asc" }, { id: "asc" }] } },
    orderBy: { cardType: "asc" },
  });
  // Counts soft-deleted cards too, so the "type is locked" hint in the UI
  // agrees with what updateField will actually enforce.
  const counts = await prisma.cardField.groupBy({
    by: ["templateFieldId"],
    where: { deletedAt: null, card: { seriesId: viewer.seriesId } },
    _count: { _all: true },
  });
  const countBy = new Map(counts.map((c) => [c.templateFieldId, c._count._all]));
  return templates.map((t) => ({
    id: t.id,
    cardType: t.cardType,
    fields: t.fields
      .filter((f) => f.deletedAt === null)
      .map((f) => ({
        id: f.id,
        key: f.key,
        label: f.label,
        fieldType: f.fieldType,
        options: f.options as FieldOptions,
        required: f.required,
        order: f.order,
        defaultRevealBehavior: f.defaultRevealBehavior,
        valueCount: countBy.get(f.id) ?? 0,
      })),
    retired: t.fields
      .filter((f) => f.deletedAt !== null)
      .map((f) => ({ id: f.id, key: f.key, label: f.label, fieldType: f.fieldType })),
  }));
}
