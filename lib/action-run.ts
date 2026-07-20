import { redirect } from "next/navigation";
import type { z } from "zod";
import { AppError } from "@/lib/errors";

/** Zod parse that surfaces the first issue as a user-facing AppError. */
export function parseOr400<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AppError(issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid input");
  }
  return result.data;
}

/**
 * Run a mutation; on AppError redirect back with ?error=, on success redirect
 * to the returned path (or returnTo). Non-AppErrors (incl. NEXT_REDIRECT)
 * propagate untouched.
 */
export async function runAndRedirect(
  returnTo: string,
  fn: () => Promise<string | void>,
): Promise<never> {
  let dest = returnTo;
  try {
    const target = await fn();
    if (typeof target === "string") dest = target;
  } catch (e) {
    if (e instanceof AppError) {
      const sep = returnTo.includes("?") ? "&" : "?";
      redirect(`${returnTo}${sep}error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
  redirect(dest);
}

export function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

export function optStr(formData: FormData, key: string): string | undefined {
  const v = str(formData, key).trim();
  return v === "" ? undefined : v;
}

export function optInt(formData: FormData, key: string): number | undefined {
  const v = optStr(formData, key);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isInteger(n) ? n : undefined;
}
