"use server";

import { optInt, optStr, parseOr400, runAndRedirect, str } from "@/lib/action-run";
import { getRequestViewer } from "@/lib/auth-helpers";
import { requireOwner } from "@/lib/permissions";
import { partSchema, sectionCreateSchema } from "@/lib/schemas";
import {
  createBook,
  createPart,
  deleteBook,
  deletePart,
  deleteSection,
  insertSection,
  moveSection,
  updateSection,
} from "@/lib/services/structure";

async function ownerViewer(formData: FormData): Promise<{ seriesId: string; returnTo: string }> {
  const seriesId = str(formData, "seriesId");
  const viewer = await getRequestViewer(seriesId);
  requireOwner(viewer.role);
  return { seriesId, returnTo: `/series/${seriesId}/structure` };
}

export async function createBookAction(formData: FormData): Promise<void> {
  const { seriesId, returnTo } = await ownerViewer(formData);
  await runAndRedirect(returnTo, async () => {
    const title = str(formData, "title").trim();
    if (title === "") return;
    await createBook(seriesId, title);
  });
}

export async function deleteBookAction(formData: FormData): Promise<void> {
  const { seriesId, returnTo } = await ownerViewer(formData);
  await runAndRedirect(returnTo, () => deleteBook(seriesId, str(formData, "bookId")));
}

export async function createPartAction(formData: FormData): Promise<void> {
  const { seriesId, returnTo } = await ownerViewer(formData);
  await runAndRedirect(returnTo, async () => {
    const input = parseOr400(partSchema, {
      bookId: str(formData, "bookId"),
      number: optInt(formData, "number") ?? 1,
      title: optStr(formData, "title") ?? null,
    });
    await createPart(seriesId, input);
  });
}

export async function deletePartAction(formData: FormData): Promise<void> {
  const { seriesId, returnTo } = await ownerViewer(formData);
  await runAndRedirect(returnTo, () => deletePart(seriesId, str(formData, "partId")));
}

export async function insertSectionAction(formData: FormData): Promise<void> {
  const { seriesId, returnTo } = await ownerViewer(formData);
  await runAndRedirect(returnTo, async () => {
    const input = parseOr400(sectionCreateSchema, {
      bookId: str(formData, "bookId"),
      partId: optStr(formData, "partId") ?? null,
      type: str(formData, "type"),
      number: optInt(formData, "number") ?? null,
      title: optStr(formData, "title") ?? null,
      afterSectionId: optStr(formData, "afterSectionId") ?? null,
    });
    await insertSection(seriesId, input);
  });
}

export async function updateSectionAction(formData: FormData): Promise<void> {
  const { seriesId, returnTo } = await ownerViewer(formData);
  await runAndRedirect(returnTo, () =>
    updateSection(seriesId, str(formData, "sectionId"), {
      // When the title is gated for this (non-peek) owner, the form omits the
      // input and sets titleLocked — never silently wipe a hidden title.
      ...(formData.has("titleLocked") ? {} : { title: optStr(formData, "title") ?? null }),
      number: optInt(formData, "number") ?? null,
      partId: optStr(formData, "partId") ?? null,
    }),
  );
}

export async function moveSectionAction(formData: FormData): Promise<void> {
  const { seriesId, returnTo } = await ownerViewer(formData);
  await runAndRedirect(returnTo, () =>
    moveSection(seriesId, str(formData, "sectionId"), optStr(formData, "afterSectionId") ?? null),
  );
}

export async function deleteSectionAction(formData: FormData): Promise<void> {
  const { seriesId, returnTo } = await ownerViewer(formData);
  await runAndRedirect(returnTo, () => deleteSection(seriesId, str(formData, "sectionId")));
}
