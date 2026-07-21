"use server";

import { optInt, optStr, parseOr400, runAndRedirect, str } from "@/lib/action-run";
import { getRequestViewer } from "@/lib/auth-helpers";
import { calendarCreateSchema, calendarWeekSchema, eraSchema, monthSchema } from "@/lib/schemas";
import {
  addEra,
  addMonth,
  createCalendar,
  deleteEra,
  deleteMonth,
  updateCalendar,
  updateEra,
  updateMonth,
} from "@/lib/services/calendar-admin";

/** Roles are enforced inside lib/services/calendar-admin.ts. */
async function ctx(formData: FormData) {
  const seriesId = str(formData, "seriesId");
  return {
    viewer: await getRequestViewer(seriesId),
    returnTo: `/series/${seriesId}/calendar`,
  };
}

function weekdayNames(formData: FormData): string[] {
  return str(formData, "weekdayNames")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export async function createCalendarAction(formData: FormData): Promise<void> {
  const { viewer, returnTo } = await ctx(formData);
  await runAndRedirect(returnTo, async () => {
    const input = parseOr400(calendarCreateSchema, {
      name: str(formData, "name").trim(),
      epochLabel: optStr(formData, "epochLabel") ?? null,
      daysPerWeek: optInt(formData, "daysPerWeek") ?? 7,
      weekdayNames: weekdayNames(formData),
    });
    await createCalendar(viewer, input);
  });
}

export async function updateCalendarAction(formData: FormData): Promise<void> {
  const { viewer, returnTo } = await ctx(formData);
  await runAndRedirect(returnTo, async () => {
    const patch = parseOr400(calendarWeekSchema, {
      name: str(formData, "name").trim(),
      epochLabel: optStr(formData, "epochLabel") ?? null,
      daysPerWeek: optInt(formData, "daysPerWeek") ?? 7,
      weekdayNames: weekdayNames(formData),
    });
    await updateCalendar(viewer, str(formData, "calendarId"), patch);
  });
}

export async function addEraAction(formData: FormData): Promise<void> {
  const { viewer, returnTo } = await ctx(formData);
  await runAndRedirect(returnTo, async () => {
    const input = parseOr400(eraSchema, {
      name: str(formData, "name").trim(),
      abbreviation: str(formData, "abbreviation").trim(),
      yearOffset: optInt(formData, "yearOffset") ?? 0,
    });
    await addEra(viewer, str(formData, "calendarId"), input);
  });
}

export async function updateEraAction(formData: FormData): Promise<void> {
  const { viewer, returnTo } = await ctx(formData);
  await runAndRedirect(returnTo, async () => {
    const patch = parseOr400(eraSchema, {
      name: str(formData, "name").trim(),
      abbreviation: str(formData, "abbreviation").trim(),
      yearOffset: optInt(formData, "yearOffset") ?? 0,
    });
    await updateEra(viewer, str(formData, "eraId"), patch);
  });
}

export async function deleteEraAction(formData: FormData): Promise<void> {
  const { viewer, returnTo } = await ctx(formData);
  await runAndRedirect(returnTo, () => deleteEra(viewer, str(formData, "eraId")));
}

export async function addMonthAction(formData: FormData): Promise<void> {
  const { viewer, returnTo } = await ctx(formData);
  await runAndRedirect(returnTo, async () => {
    const input = parseOr400(monthSchema, {
      name: str(formData, "name").trim(),
      dayCount: optInt(formData, "dayCount") ?? 30,
    });
    await addMonth(viewer, str(formData, "calendarId"), input);
  });
}

export async function updateMonthAction(formData: FormData): Promise<void> {
  const { viewer, returnTo } = await ctx(formData);
  await runAndRedirect(returnTo, async () => {
    const patch = parseOr400(monthSchema, {
      name: str(formData, "name").trim(),
      dayCount: optInt(formData, "dayCount") ?? 30,
    });
    await updateMonth(viewer, str(formData, "monthId"), patch);
  });
}

export async function deleteMonthAction(formData: FormData): Promise<void> {
  const { viewer, returnTo } = await ctx(formData);
  await runAndRedirect(returnTo, () => deleteMonth(viewer, str(formData, "monthId")));
}
