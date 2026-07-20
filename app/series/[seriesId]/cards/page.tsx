import { Lock, Plus } from "lucide-react";
import Link from "next/link";
import type { CardType } from "@prisma/client";
import { restoreCardAction } from "@/app/actions/cards";
import { CARD_TYPES, TYPE_BADGE, TYPE_EDGE } from "@/components/cards/type-colors";
import { ErrorNote } from "@/components/error-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getRequestViewer } from "@/lib/auth-helpers";
import { listDeletedCards } from "@/lib/services/cards";
import { listCards } from "@/lib/visibility";

function isCardType(s: string | undefined): s is CardType {
  return s !== undefined && (CARD_TYPES as string[]).includes(s);
}

export default async function CardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ seriesId: string }>;
  searchParams: Promise<{ type?: string; cursor?: string; error?: string }>;
}) {
  const { seriesId } = await params;
  const sp = await searchParams;
  const viewer = await getRequestViewer(seriesId);
  const type = isCardType(sp.type) ? sp.type : undefined;
  const { items, nextCursor } = await listCards(viewer, { type, cursor: sp.cursor });
  const deleted = viewer.peek && viewer.role !== "READER" ? await listDeletedCards(viewer) : [];
  const base = `/series/${seriesId}/cards`;

  return (
    <div>
      <ErrorNote error={sp.error} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={base} className={`text-sm ${type ? "text-soft" : "font-medium"}`}>
          All
        </Link>
        {CARD_TYPES.map((t) => (
          <Link
            key={t}
            href={`${base}?type=${t}`}
            className={`text-sm capitalize ${type === t ? "font-medium" : "text-soft"} hover:text-ink`}
          >
            {t.toLowerCase()}
          </Link>
        ))}
        {viewer.role !== "READER" && (
          <Link href={`${base}/new${type ? `?type=${type}` : ""}`} className="ml-auto">
            <Button size="sm">
              <Plus className="size-3.5" /> New card
            </Button>
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-soft">No cards yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) =>
            item.locked ? (
              // Locked placeholder: uniform grey, lock icon, NOTHING else.
              // Not clickable, no tooltip. Count disclosure is deliberate.
              <div
                key={item.id}
                aria-label="Locked card"
                className="flex h-28 items-center justify-center rounded-lg border border-line bg-raised/60"
              >
                <Lock className="size-5 text-soft" aria-hidden />
              </div>
            ) : (
              <Link key={item.id} href={`${base}/${item.id}`}>
                <div
                  className={`h-28 overflow-hidden rounded-lg border border-line border-l-4 bg-surface p-3 hover:bg-raised ${TYPE_EDGE[item.type]}`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate font-display font-medium">{item.title}</span>
                    <Badge className={TYPE_BADGE[item.type]}>{item.type.toLowerCase()}</Badge>
                  </div>
                  {item.summary && <p className="line-clamp-2 text-xs text-soft">{item.summary}</p>}
                  {item.type === "THEORY" && item.confidence !== null && (
                    <p className="mt-1 text-xs text-theory">confidence {"●".repeat(item.confidence)}</p>
                  )}
                </div>
              </Link>
            ),
          )}
        </div>
      )}

      {nextCursor && (
        <div className="mt-4">
          <Link
            href={`${base}?${type ? `type=${type}&` : ""}cursor=${nextCursor}`}
            className="text-sm text-accent underline"
          >
            Next page →
          </Link>
        </div>
      )}

      {deleted.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm text-soft">
            Deleted cards ({deleted.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {deleted.map((c) => (
              <li key={c.id} className="flex items-center gap-3 text-sm">
                <span className="text-soft line-through">{c.title}</span>
                <form action={restoreCardAction}>
                  <input type="hidden" name="seriesId" value={seriesId} />
                  <input type="hidden" name="cardId" value={c.id} />
                  <Button variant="outline" size="sm">Restore</Button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
