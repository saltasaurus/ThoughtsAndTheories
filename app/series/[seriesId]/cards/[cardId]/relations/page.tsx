import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TYPE_BADGE } from "@/components/cards/type-colors";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/card";
import { getRequestViewer } from "@/lib/auth-helpers";
import { getCardDetail, type RelationView } from "@/lib/visibility";

/**
 * Relations board: a card's visible edges grouped by relation type. Both
 * endpoints of every edge are already visible (relationWhere gates on the live
 * endpoint columns) — gated relations are omitted entirely, never placeholdered.
 */
export default async function RelationsBoardPage({
  params,
}: {
  params: Promise<{ seriesId: string; cardId: string }>;
}) {
  const { seriesId, cardId } = await params;
  const viewer = await getRequestViewer(seriesId);
  const card = await getCardDetail(viewer, cardId);
  if (!card) notFound();

  const base = `/series/${seriesId}/cards`;
  const groups = new Map<string, RelationView[]>();
  for (const r of card.relations) {
    const list = groups.get(r.type) ?? [];
    list.push(r);
    groups.set(r.type, list);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`${base}/${cardId}`} className="text-xs text-accent underline">
        ← {card.title}
      </Link>
      <h1 className="mb-1 mt-1 text-2xl">Relations board</h1>
      <p className="mb-4 text-xs text-soft">
        {card.relations.length} visible relation{card.relations.length === 1 ? "" : "s"} across{" "}
        {groups.size} type{groups.size === 1 ? "" : "s"}. Gated relations are omitted entirely.
      </p>

      {card.relations.length === 0 ? (
        <Panel>
          <p className="text-sm text-soft">No visible relations at your reading position.</p>
        </Panel>
      ) : (
        <div className="space-y-3">
          {sortedGroups.map(([type, rels]) => (
            <Panel key={type}>
              <h2 className="mb-2 text-sm font-medium italic text-soft">{type}</h2>
              <ul className="space-y-2">
                {rels.map((r) => {
                  const isFrom = r.fromCard.id === card.id;
                  const other = isFrom ? r.toCard : r.fromCard;
                  return (
                    <li key={r.id} className="flex items-center gap-2 text-sm">
                      <span className="w-4 shrink-0 text-soft">
                        {!r.directed ? (
                          "—"
                        ) : isFrom ? (
                          <ArrowRight className="size-3.5" />
                        ) : (
                          <ArrowLeft className="size-3.5" />
                        )}
                      </span>
                      <Link href={`${base}/${other.id}`} className="text-accent underline">
                        {other.title}
                      </Link>
                      <Badge className={TYPE_BADGE[other.type]}>{other.type.toLowerCase()}</Badge>
                      <div className="ml-auto flex items-center gap-1.5">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
                          <div
                            className="h-full bg-accent"
                            style={{ width: `${Math.round(r.weight * 100)}%` }}
                          />
                        </div>
                        <span className="tnum w-8 text-right text-xs text-soft">
                          {r.weight.toFixed(2)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
