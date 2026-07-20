import { notFound, redirect } from "next/navigation";
import { setFieldAction, updateCardAction } from "@/app/actions/cards";
import { createRelationAction, restoreRelationAction } from "@/app/actions/relations";
import { FieldInput, type FieldInputContext } from "@/components/cards/field-input";
import { SectionSelect } from "@/components/cards/section-select";
import { ErrorNote } from "@/components/error-note";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getRequestViewer } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { getSeriesCalendar } from "@/lib/services/calendar-admin";
import { getCardDetail, listCards, listSectionOptions } from "@/lib/visibility";

export default async function EditCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ seriesId: string; cardId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { seriesId, cardId } = await params;
  const { error } = await searchParams;
  const viewer = await getRequestViewer(seriesId);
  if (viewer.role === "READER") redirect(`/series/${seriesId}/cards/${cardId}`);
  const card = await getCardDetail(viewer, cardId);
  if (!card) notFound();

  const [template, options, calendar, cardsPage, deletedRelations] = await Promise.all([
    prisma.template.findUnique({
      where: { seriesId_cardType: { seriesId, cardType: card.type } },
      include: { fields: { where: { deletedAt: null }, orderBy: { order: "asc" } } },
    }),
    listSectionOptions(viewer),
    getSeriesCalendar(seriesId),
    listCards(viewer, { pageSize: 200 }),
    viewer.peek
      ? prisma.cardRelation.findMany({
          where: {
            OR: [{ fromCardId: cardId }, { toCardId: cardId }],
            deletedAt: { not: null },
          },
          select: { id: true, type: true },
        })
      : Promise.resolve([]),
  ]);
  const ctx: FieldInputContext = {
    eras: calendar?.eras ?? [],
    months: calendar?.months ?? [],
    cardOptions: cardsPage.items.flatMap((i) =>
      i.locked || i.id === cardId ? [] : [{ id: i.id, title: i.title }],
    ),
  };
  const valueByTemplateField = new Map(card.fields.map((f) => [f.templateFieldId, f]));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl">Edit “{card.title}”</h1>
      <ErrorNote error={error} />

      <Panel>
        <form action={updateCardAction} className="space-y-3">
          <input type="hidden" name="seriesId" value={seriesId} />
          <input type="hidden" name="cardId" value={cardId} />
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" defaultValue={card.title} required maxLength={300} />
          </div>
          <div>
            <Label htmlFor="summary">Summary</Label>
            <Textarea id="summary" name="summary" defaultValue={card.summary ?? ""} maxLength={2000} />
          </div>
          {card.type === "THEORY" && (
            <div>
              <Label htmlFor="confidence">Confidence (1–5)</Label>
              <Input id="confidence" name="confidence" type="number" min={1} max={5} defaultValue={card.confidence ?? 3} />
            </div>
          )}
          <div>
            <Label>Reveal point (raising also raises earlier fields &amp; relations; lowering never cascades)</Label>
            <SectionSelect name="revealSectionId" options={options} defaultValue={card.revealSectionId} required />
          </div>
          <Button type="submit">Save card</Button>
        </form>
      </Panel>

      {template && template.fields.length > 0 && (
        <Panel>
          <h2 className="mb-3 text-lg">Fields</h2>
          <p className="mb-3 text-xs text-soft">
            Each field saves independently and carries its own reveal point. Fields gated above
            your progress are hidden here unless spoiler peek is on — leave empty to clear.
          </p>
          <div className="space-y-4">
            {template.fields.map((tf) => {
              const existing = valueByTemplateField.get(tf.id);
              return (
                <form key={tf.id} action={setFieldAction} className="grid gap-2 border-b border-line pb-3 last:border-0 sm:grid-cols-[1fr_200px_70px]">
                  <input type="hidden" name="seriesId" value={seriesId} />
                  <input type="hidden" name="cardId" value={cardId} />
                  <input type="hidden" name="templateFieldId" value={tf.id} />
                  <div>
                    <Label>{tf.label}</Label>
                    <FieldInput tf={tf} ctx={ctx} defaultValue={existing?.value} />
                  </div>
                  <div>
                    <Label>Reveal point</Label>
                    <SectionSelect
                      name={`fieldReveal_${tf.id}`}
                      options={options}
                      defaultValue={existing?.revealSectionId}
                      emptyLabel={existing ? "keep current" : "same as card"}
                    />
                  </div>
                  <div className="self-end">
                    <Button type="submit" variant="outline" size="sm">Save</Button>
                  </div>
                </form>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel>
        <h2 className="mb-3 text-lg">Add relation</h2>
        <form action={createRelationAction} className="grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="seriesId" value={seriesId} />
          <input type="hidden" name="fromCardId" value={cardId} />
          <div>
            <Label>To card</Label>
            <select name="toCardId" required className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm">
              <option value="">choose…</option>
              {ctx.cardOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Type (e.g. “sibling of”, “betrays”)</Label>
            <Input name="type" required maxLength={100} />
          </div>
          <div>
            <Label>Weight (0–1)</Label>
            <Input name="weight" type="number" min={0} max={1} step={0.05} defaultValue={0.5} />
          </div>
          <div>
            <Label>Reveal point</Label>
            <SectionSelect name="revealSectionId" options={options} required />
          </div>
          <div className="sm:col-span-2">
            <Label>Notes</Label>
            <Input name="notes" maxLength={2000} />
          </div>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="directed" /> directed
          </label>
          <div className="text-right">
            <Button type="submit" size="sm">Add relation</Button>
          </div>
        </form>
        {deletedRelations.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-soft">
              Deleted relations ({deletedRelations.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {deletedRelations.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-sm">
                  <span className="text-soft line-through">{r.type}</span>
                  <form action={restoreRelationAction}>
                    <input type="hidden" name="seriesId" value={seriesId} />
                    <input type="hidden" name="cardId" value={cardId} />
                    <input type="hidden" name="relationId" value={r.id} />
                    <Button variant="outline" size="sm">Restore</Button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Panel>
    </div>
  );
}
