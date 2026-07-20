import { AppError } from "@/lib/errors";
import { getValidInvite, isBootstrap } from "@/lib/services/invites";
import { RegisterForm } from "@/components/auth/register-form";
import { Panel } from "@/components/ui/card";

/**
 * Registration is CLOSED: reachable only through a valid invite link — except
 * the very first account (empty User table), which bootstraps the install.
 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const bootstrap = await isBootstrap();

  let inviteError: string | null = null;
  let seriesTitle: string | null = null;
  if (!bootstrap) {
    if (!code) {
      inviteError = "Registration is invite-only. Ask your series owner for an invite link.";
    } else {
      try {
        seriesTitle = (await getValidInvite(code)).seriesTitle;
      } catch (e) {
        inviteError = e instanceof AppError ? e.message : "Invalid invite";
      }
    }
  }

  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-1 text-3xl">{bootstrap ? "Welcome" : "Join TheoryTracker"}</h1>
      <p className="mb-6 text-sm text-soft">
        {bootstrap
          ? "Create the first account for this install. You'll then set up your first series as its owner."
          : seriesTitle
            ? `You've been invited to “${seriesTitle}”.`
            : "Spoiler-safe worldbuilding for book clubs."}
      </p>
      {inviteError ? (
        <Panel>
          <p className="text-sm text-danger">{inviteError}</p>
        </Panel>
      ) : (
        <Panel>
          <RegisterForm inviteCode={bootstrap ? undefined : code} />
        </Panel>
      )}
    </main>
  );
}
