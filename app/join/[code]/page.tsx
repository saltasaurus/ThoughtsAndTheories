import Link from "next/link";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { getValidInvite } from "@/lib/services/invites";
import { joinInviteAction } from "@/app/actions/invites";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";

/** Invite landing: logged out → register; logged in → join directly. */
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { code } = await params;
  const { error } = await searchParams;
  const session = await auth();

  let invite: { seriesTitle: string; role: string } | null = null;
  let inviteError: string | null = null;
  try {
    invite = await getValidInvite(code);
  } catch (e) {
    inviteError = e instanceof AppError ? e.message : "Invalid invite";
  }

  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-4 text-3xl">Join a series</h1>
      <Panel>
        {inviteError ? (
          <p className="text-sm text-danger">{inviteError}</p>
        ) : invite ? (
          <>
            <p className="mb-4 text-sm">
              You&apos;re invited to <span className="font-medium">“{invite.seriesTitle}”</span> as
              a {invite.role.toLowerCase()}.
            </p>
            {error && <p className="mb-2 text-sm text-danger">{error}</p>}
            {session?.user?.id ? (
              <form action={joinInviteAction}>
                <input type="hidden" name="code" value={code} />
                <Button type="submit" className="w-full">Join series</Button>
              </form>
            ) : (
              <div className="space-y-2 text-sm">
                <Link href={`/register?code=${encodeURIComponent(code)}`} className="block">
                  <Button className="w-full">Create an account</Button>
                </Link>
                <p className="text-center text-soft">
                  Already have an account?{" "}
                  <Link href="/login" className="text-accent underline">
                    Log in first
                  </Link>
                  , then reopen this link.
                </p>
              </div>
            )}
          </>
        ) : null}
      </Panel>
    </main>
  );
}
