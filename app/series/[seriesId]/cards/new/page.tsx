import Link from "next/link";
import { redirect } from "next/navigation";
import type { CardType } from "@prisma/client";
import { createCardAction } from "@/app/actions/cards";
import { FieldInput, type FieldInputContext } from "@/components/cards/field-input";
import { SectionSelect } from "@/components/cards/section-select";
import { CARD_TYPES } from "@/components/cards/type-colors";
import { ErrorNote } from "@/components/error-note";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getRequestViewer } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { getSeriesCalendar } from "@/lib/services/calendar-admin";
import { listCards, listSectionOptions } from "@/lib/visibility";

export default async function NewCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ seriesId: string }>;
  searchParams: Promise<{ type?: string; error?: string }>;
}) {
  const { seriesId } = await params;
  const sp = await searchParams;
  const viewer = await getRequestViewer(seriesId);
  if (viewer.role === "READER") redirect(`/series/${seriesId}/cards`);

  const type: CardType = (CARD_TYPES as string[]).includes(sp.type ?? "")
    ? (sp.type as CardType)
    : "CHARACTER";
  const [template, options, calendar, cardsPage] = await Promise.all([
    prisma.template.findUnique({
      where: { seriesId_cardType: { seriesId, cardType: type } },
      include: { fields: { where: { deletedAt: null }, orderBy: { order: "asc" } } },
    }),
    listSectionOptions(viewer),
    getSeriesCalendar(seriesId),
    listCards(viewer, { pageSize: 200 }),
  ]);
  const ctx: FieldInputContext = {
    eras: calendar?.eras ?? [],
    months: calendar?.months ?? [],
    cardOptions: cardsPage.items.flatMap((i) => (i.locked ? [] : [{ id: i.id, title: i.title }])),
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-3 text-2xl">New card</h1>
      <ErrorNote error={sp.error} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {CARD_TYPES.map((t) => (
          <Link
            key={t}
            href={`/series/${seriesId}/cards/new?type=${t}`}
            className={`capitalize ${t === type ? "font-medium text-accent" : "text-soft"}`}
          >
            {t.toLowerCase()}
          </Link>
        ))}
      </div>
      <Panel>
        <form action={createCardAction} className="space-y-4">
          <input type="hidden" name="seriesId" value={seriesId} />
          <input type="hidden" name="type" value={type} />
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required maxLength={300} />
          </div>
          <div>
            <Label htmlFor="summary">Summary</Label>
            <Textarea id="summary" name="summary" maxLength={2000} />
          </div>
          {type === "THEORY" && (
            <div>
              <Label htmlFor="confidence">Confidence (1–5)</Label>
              <Input id="confidence" name="confidence" type="number" min={1} max={5} defaultValue={3} />
            </div>
          )}
          <div>
            <Label>Reveal point — readers before this section see only a locked placeholder</Label>
            <SectionSelect name="revealSectionId" options={options} required />
          </div>

          {template && template.fields.length > 0 && (
            <fieldset className="space-y-3 border-t border-line pt-3">
              <legend className="pt-2 text-sm font-medium">Fields</legend>
              {template.fields.map((tf) => (
                <div key={tf.id} className="grid gap-2 sm:grid-cols-[1fr_220px]">
                  <div>
                    <Label>{tf.label}{tf.required ? " *" : ""}</Label>
                    <FieldInput tf={tf} ctx={ctx} />
                  </div>
                  <div>
                    <Label>Field reveal point</Label>
                    <SectionSelect
                      name={`fieldReveal_${tf.id}`}
                      options={options}
                      emptyLabel="same as card"
                    />
                  </div>
                </div>
              ))}
            </fieldset>
          )}
          <Button type="submit">Create card</Button>
        </form>
      </Panel>
    </div>
  );
}
