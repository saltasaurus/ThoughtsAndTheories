"use server";

import { optStr, parseOr400, runAndRedirect, str } from "@/lib/action-run";
import { getRequestViewer } from "@/lib/auth-helpers";
import { templateFieldCreateSchema, templateFieldUpdateSchema } from "@/lib/schemas";
import {
  addField,
  moveField,
  restoreField,
  retireField,
  updateField,
} from "@/lib/services/templates";

/** Roles are enforced inside lib/services/templates.ts — one boundary per mutation. */
async function ctx(formData: FormData) {
  const seriesId = str(formData, "seriesId");
  return {
    viewer: await getRequestViewer(seriesId),
    returnTo: `/series/${seriesId}/templates`,
  };
}

/** SELECT/MULTISELECT choices arrive as one comma-separated input. */
function parseChoices(formData: FormData): { choices: string[] } | null {
  const raw = optStr(formData, "choices");
  if (raw === undefined) return null;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return list.length > 0 ? { choices: list } : null;
}

export async function addFieldAction(formData: FormData): Promise<void> {
  const { viewer, returnTo } = await ctx(formData);
  await runAndRedirect(returnTo, async () => {
    const input = parseOr400(templateFieldCreateSchema, {
      key: str(formData, "key").trim().toLowerCase(),
      label: str(formData, "label").trim(),
      fieldType: str(formData, "fieldType"),
      options: parseChoices(formData),
      required: formData.has("required"),
      defaultRevealBehavior: str(formData, "defaultRevealBehavior") || "CARD",
    });
    await addField(viewer, str(formData, "templateId"), input);
  });
}

export async function updateFieldAction(formData: FormData): Promise<void> {
  const { viewer, returnTo } = await ctx(formData);
  await runAndRedirect(returnTo, async () => {
    // fieldType/options inputs are only rendered when the field has no stored
    // values; when absent we must not send them at all, or we would trip the
    // retype guard against the field's own current type.
    const fieldType = optStr(formData, "fieldType");
    const patch = parseOr400(templateFieldUpdateSchema, {
      label: str(formData, "label").trim(),
      required: formData.has("required"),
      defaultRevealBehavior: str(formData, "defaultRevealBehavior") || "CARD",
      ...(fieldType ? { fieldType } : {}),
      ...(formData.has("choices") ? { options: parseChoices(formData) } : {}),
    });
    await updateField(viewer, str(formData, "fieldId"), patch);
  });
}

export async function moveFieldAction(formData: FormData): Promise<void> {
  const { viewer, returnTo } = await ctx(formData);
  const delta = str(formData, "direction") === "up" ? -1 : 1;
  await runAndRedirect(returnTo, () => moveField(viewer, str(formData, "fieldId"), delta));
}

export async function retireFieldAction(formData: FormData): Promise<void> {
  const { viewer, returnTo } = await ctx(formData);
  await runAndRedirect(returnTo, () => retireField(viewer, str(formData, "fieldId")));
}

export async function restoreFieldAction(formData: FormData): Promise<void> {
  const { viewer, returnTo } = await ctx(formData);
  await runAndRedirect(returnTo, () => restoreField(viewer, str(formData, "fieldId")));
}
