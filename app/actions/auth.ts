"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/lib/auth";
import { parseOr400 } from "@/lib/action-run";
import { AppError } from "@/lib/errors";
import { LIMITS, clientIp, rateLimit } from "@/lib/rate-limit";
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
    // Two buckets, because they stop different attacks: per-IP caps one source
    // (and the bcrypt CPU burn it causes), per-account stops one victim being
    // ground down from many addresses. Both run BEFORE signIn, so a blocked
    // attempt never reaches a password hash.
    const ip = await clientIp();
    rateLimit(`login:ip:${ip}`, LIMITS.login.limit, LIMITS.login.windowMs);
    rateLimit(
      `login:acct:${parsed.data.email.toLowerCase()}`,
      LIMITS.loginPerAccount.limit,
      LIMITS.loginPerAccount.windowMs,
    );

    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/",
    });
    return {};
  } catch (e) {
    if (e instanceof AppError) return { error: e.message }; // includes 429
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
    // Registration is invite-gated, but it still runs bcrypt and takes an
    // advisory lock, so an unauthenticated flood is a DoS regardless.
    const ip = await clientIp();
    rateLimit(`register:ip:${ip}`, LIMITS.register.limit, LIMITS.register.windowMs);

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
