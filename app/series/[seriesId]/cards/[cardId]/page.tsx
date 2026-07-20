import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteCardAction } from "@/app/actions/cards";
import { deleteRelationAction } from "@/app/actions/relations";
import { FieldValue } from "@/components/cards/field-value";
import { TYPE_BADGE } from "@/components/cards/type-colors";
import { ErrorNote } from "@/components/error-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { getRequestViewer } from "@/lib/auth-helpers";
import { getSeriesCalendar } from "@/lib/services/calendar-admin";
import {
  getCardDetail,
  getTheoryRevealWarning,
  getVisibleCardTitles,
  listSectionOptions,
} from "@/lib/visibility";

export default async function CardDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ seriesId: string; cardId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { seriesId, cardId } = await params;
  const { error } = await searchParams;
  const viewer = await getRequestViewer(seriesId);
  const card = await getCardDetail(viewer, cardId);
  if (!card) notFound(); // gated or absent — detail views have no placeholder

  const refIds = card.fields
    .filter((f) => f.fieldType === "CARD_REF")
    .map((f) =>
      typeof f.value === "object" && f.value !== null && "cardId" in f.value
        ? String((f.value as { cardId: unknown }).cardId)
        : "",
    )
    .filter(Boolean);
  const [calendar, refTitles, sections, warning] = await Promise.all([
    getSeriesCalendar(seriesId),
    getVisibleCardTitles(viewer, refIds),
    listSectionOptions(viewer),
    card.type === "THEORY" ? getTheoryRevealWarning(viewer, cardId) : Promise.resolve(null),
  ]);
  const sectionLabel = (id: string): string => sections.find((s) => s.id === id)?.label ?? "?";
  const calendarLike = { eras: calendar?.eras ?? [], months: calendar?.months ?? [] };
  const base = `/series/${seriesId}/cards`;

  return (
    <div className="mx-auto max-w-2xl">
      <ErrorNote error={error} />
      {warning && (
        <p className="mb-3 rounded-md border border-theory/50 bg-theory/10 px-3 py-2 text-sm text-theory">
          This theory cites a card revealed later (index {warning.citedMaxRevealIndex}) than the
          theory itself (index {warning.storedRevealIndex}). Consider raising its reveal point.
        </p>
      )}
      <div className="mb-1 flex items-center gap-2">
        <Badge className={TYPE_BADGE[card.type]}>{card.type.toLowerCase()}</Badge>
        <span className="text-xs text-soft tnum">revealed at {sectionLabel(card.revealSectionId)}</span>
      </div>
      <h1 className="mb-2 text-3xl">{card.title}</h1>
      {card.type === "THEORY" && card.confidence !== null && (
        <p className="mb-2 text-sm text-theory">confidence {"●".repeat(card.confidence)}{"○".repeat(5 - card.confidence)}</p>
      )}
      {card.summary && <p className="mb-4 text-soft">{card.summary}</p>}

      {card.fields.length > 0 && (
        <Panel className="mb-4">
          <dl className="space-y-3">
            {card.fields.map((f) => (
              <div key={f.id}>
                <dt className="text-xs font-medium uppercase tracking-wide text-soft">{f.label}</dt>
                <dd className="mt-0.5 text-sm">
                  <FieldValue
                    fieldType={f.fieldType}
                    value={f.value}
                    calendar={calendarLike}
                    refTitles={refTitles}
                    seriesId={seriesId}
                  />
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}

      <h2 className="mb-2 text-lg">Relations</h2>
      {card.relations.length === 0 ? (
        <p className="mb-4 text-sm text-soft">No visible relations.</p>
      ) : (
        <ul className="mb-4 space-y-1.5">
          {card.relations.map((r) => {
            const isFrom = r.fromCard.id === card.id;
            const other = isFrom ? r.toCard : r.fromCard;
            return (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <span className="text-soft">{r.directed && !isFrom ? "←" : ""}</span>
                <span className="italic text-soft">{r.type}</span>
                {r.directed && isFrom && <ArrowRight className="size-3.5 text-soft" />}
                <Link href={`${base}/${other.id}`} className="text-accent underline">
                  {other.title}
                </Link>
                <span className="tnum text-xs text-soft">w {r.weight.toFixed(2)}</span>
                {viewer.role !== "READER" && (
                  <form action={deleteRelationAction}>
                    <input type="hidden" name="seriesId" value={seriesId} />
                    <input type="hidden" name="cardId" value={card.id} />
                    <input type="hidden" name="relationId" value={r.id} />
                    <Button variant="ghost" size="sm" title="Delete relation">
                      <Trash2 className="size-3" />
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {viewer.role !== "READER" && (
        <div className="flex gap-2 border-t border-line pt-3">
          <Link href={`${base}/${card.id}/edit`}>
            <Button variant="outline" size="sm">
              <Pencil className="size-3.5" /> Edit
            </Button>
          </Link>
          <form action={deleteCardAction}>
            <input type="hidden" name="seriesId" value={seriesId} />
            <input type="hidden" name="cardId" value={card.id} />
            <Button variant="destructive" size="sm">
              <Trash2 className="size-3.5" /> Delete
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
