import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isBootstrap } from "@/lib/services/invites";
import { listSeriesForUser } from "@/lib/services/series";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";

export default async function Home() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect((await isBootstrap()) ? "/register" : "/login");
  }
  const series = await listSeriesForUser(session.user.id);
  const only = series.length === 1 ? series[0] : undefined;
  if (only) redirect(`/series/${only.id}/cards`);

  return (
    <main className="mx-auto max-w-xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl">TheoryTracker</h1>
        <form action={logoutAction}>
          <Button variant="ghost" size="sm">Log out</Button>
        </form>
      </div>
      {series.length === 0 ? (
        <Panel>
          <p className="mb-3 text-sm text-soft">You have no series yet.</p>
          <Link href="/series/new" className="text-accent underline">
            Create your first series
          </Link>
        </Panel>
      ) : (
        <div className="space-y-2">
          {series.map((s) => (
            <Link key={s.id} href={`/series/${s.id}/cards`} className="block">
              <Panel className="flex items-center justify-between hover:bg-raised">
                <span className="font-display text-lg">{s.title}</span>
                <span className="text-xs uppercase text-soft">{s.role}</span>
              </Panel>
            </Link>
          ))}
          <Link href="/series/new" className="block text-sm text-accent underline">
            New series
          </Link>
        </div>
      )}
    </main>
  );
}
