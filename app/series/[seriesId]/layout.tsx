import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { togglePeekAction } from "@/app/actions/progress";
import { ReadingPosition } from "@/components/shell/reading-position";
import { Button } from "@/components/ui/button";
import { getRequestViewer } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { getActiveSession, listSectionOptions } from "@/lib/visibility";

export default async function SeriesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ seriesId: string }>;
}) {
  const { seriesId } = await params;
  const viewer = await getRequestViewer(seriesId);
  const [series, options, active, membership] = await Promise.all([
    prisma.series.findUnique({ where: { id: seriesId }, select: { title: true } }),
    listSectionOptions(viewer),
    getActiveSession(viewer),
    prisma.membership.findUnique({
      where: { userId_seriesId: { userId: viewer.userId, seriesId } },
      select: { currentSectionId: true },
    }),
  ]);
  if (!series) notFound();

  const base = `/series/${seriesId}`;
  const nav: Array<[string, string]> = [
    [`${base}/cards`, "Cards"],
    [`${base}/timeline`, "Timeline"],
    [`${base}/sessions`, "Sessions"],
    [`${base}/search`, "Search"],
    [`${base}/graph`, "Graph"],
  ];
  if (viewer.role === "OWNER") {
    nav.push([`${base}/structure`, "Structure"], [`${base}/templates`, "Templates"], [`${base}/calendar`, "Calendar"]);
  }
  if (viewer.role !== "READER") nav.push([`${base}/settings`, "Settings"]);

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line bg-surface px-4 py-2.5">
        <Link href="/" className="font-display text-lg font-semibold text-accent">
          {series.title}
        </Link>
        <nav className="flex flex-wrap gap-x-4 text-sm text-soft">
          {nav.map(([href, label]) => (
            <Link key={href} href={href} className="hover:text-ink">
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {viewer.role !== "READER" && (
            <form action={togglePeekAction}>
              <input type="hidden" name="seriesId" value={seriesId} />
              <Button
                variant={viewer.peek ? "destructive" : "ghost"}
                size="sm"
                title="Spoiler peek temporarily lifts the reveal gate so you can author gated content"
              >
                {viewer.peek ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {viewer.peek ? "Peek on" : "Peek"}
              </Button>
            </form>
          )}
          <form action={logoutAction}>
            <Button variant="ghost" size="sm">Log out</Button>
          </form>
        </div>
      </header>

      {viewer.peek && (
        <div className="bg-theory px-4 py-1.5 text-center text-sm font-semibold text-canvas">
          SPOILER PEEK ACTIVE — you are seeing content beyond your reading position
        </div>
      )}

      <ReadingPosition
        viewer={viewer}
        options={options}
        active={active}
        currentSectionId={membership?.currentSectionId ?? null}
      />

      {membership?.currentSectionId === null && options.length > 0 && (
        <div className="border-b border-accent/40 bg-accent/10 px-4 py-2 text-sm">
          Welcome! Set your reading position above — everything you&apos;ve already read will
          unlock.
        </div>
      )}

      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}
