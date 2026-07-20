import Link from "next/link";
import { TYPE_BADGE } from "@/components/cards/type-colors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRequestViewer } from "@/lib/auth-helpers";
import { searchCards } from "@/lib/visibility";

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ seriesId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { seriesId } = await params;
  const { q } = await searchParams;
  const viewer = await getRequestViewer(seriesId);
  const results = q ? await searchCards(viewer, q) : null;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl">Search</h1>
      <p className="mb-3 text-xs text-soft">
        Searches card titles and summaries only — field contents are deliberately excluded, since a
        match against a gated field would leak that the term exists. Gated cards are omitted
        entirely.
      </p>
      <form className="mb-4 flex gap-2">
        <Input name="q" defaultValue={q ?? ""} placeholder="Search cards…" />
        <Button type="submit">Search</Button>
      </form>
      {results && (
        <ul className="space-y-2">
          {results.items.length === 0 && <p className="text-sm text-soft">No matches.</p>}
          {results.items.map((c) => (
            <li key={c.id}>
              <Link
                href={`/series/${seriesId}/cards/${c.id}`}
                className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 hover:bg-raised"
              >
                <span className="font-medium">{c.title}</span>
                <Badge className={TYPE_BADGE[c.type]}>{c.type.toLowerCase()}</Badge>
                {c.summary && <span className="truncate text-xs text-soft">{c.summary}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
