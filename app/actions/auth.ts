"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/lib/auth";
import { parseOr400 } from "@/lib/action-run";
import { AppError } from "@/lib/errors";
import { loginSchema, registerSchema } from "@/lib/schemas";
import { registerUser } from "@/lib/services/invites";

export type AuthFormState = { error?: string };

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter a valid email and password" };
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/",
    });
    return {};
  } catch (e) {
    if (e instanceof AuthError) return { error: "Invalid email or password" };
    throw e; // NEXT_REDIRECT on success
  }
}

export async function registerAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const code = formData.get("inviteCode");
  let dest = "/";
  try {
    const input = parseOr400(registerSchema, {
      email: formData.get("email"),
      name: formData.get("name"),
      password: formData.get("password"),
      inviteCode: typeof code === "string" && code !== "" ? code : undefined,
    });
    const { seriesId } = await registerUser(input);
    dest = seriesId ? `/series/${seriesId}` : "/series/new";
    await signIn("credentials", {
      email: input.email,
      password: input.password,
      redirectTo: dest,
    });
    return {};
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    if (e instanceof AuthError) return { error: "Account created — please log in" };
    throw e;
  }
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
