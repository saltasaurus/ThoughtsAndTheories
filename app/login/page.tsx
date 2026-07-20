import { redirect } from "next/navigation";
import { isBootstrap } from "@/lib/services/invites";
import { LoginForm } from "@/components/auth/login-form";
import { Panel } from "@/components/ui/card";

export default async function LoginPage() {
  if (await isBootstrap()) redirect("/register"); // first run: create the founding account

  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-1 text-3xl">TheoryTracker</h1>
      <p className="mb-6 text-sm text-soft">Spoiler-safe worldbuilding for book clubs.</p>
      <Panel>
        <LoginForm />
      </Panel>
      <p className="mt-4 text-xs text-soft">
        No account? Registration is invite-only — ask your series owner for an invite link.
      </p>
    </main>
  );
}
