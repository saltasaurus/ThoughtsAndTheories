"use server";

import { z } from "zod";
import { parseOr400, runAndRedirect, str } from "@/lib/action-run";
import { requireUser } from "@/lib/auth-helpers";
import { createSeries } from "@/lib/services/series";

const seriesSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export async function createSeriesAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await runAndRedirect("/series/new", async () => {
    const input = parseOr400(seriesSchema, {
      title: str(formData, "title"),
      description: str(formData, "description") || undefined,
    });
    const id = await createSeries(user.id, input);
    return `/series/${id}/structure`; // no sections yet — build the structure first
  });
}
