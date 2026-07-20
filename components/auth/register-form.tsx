"use client";

import { useActionState } from "react";
import { registerAction, type AuthFormState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RegisterForm({ inviteCode }: { inviteCode?: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(registerAction, {});
  return (
    <form action={action} className="space-y-3">
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {inviteCode && <input type="hidden" name="inviteCode" value={inviteCode} />}
      <div>
        <Label htmlFor="name">Display name</Label>
        <Input id="name" name="name" required maxLength={80} />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div>
        <Label htmlFor="password">Password (min 8 characters)</Label>
        <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
