import { Trash2 } from "lucide-react";
import Link from "next/link";
import type { DatePrecision } from "@prisma/client";
import {
  createTimelineEntryAction,
  deleteTimelineEntryAction,
  restoreTimelineEntryAction,
} from "@/app/actions/timeline";
import { SectionSelect } from "@/components/cards/section-select";
import { ErrorNote } from "@/components/error-note";
import { TimelineBoard } from "@/components/timeline/timeline-board";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getRequestViewer } from "@/lib/auth-helpers";
import { formatInWorldDate } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { getSeriesCalendar } from "@/lib/services/calendar-admin";
import {
  getActiveSession,
  getVisibleCardTitles,
  listSectionOptions,
  listTimeline,
  type TimelineEntryView,
} from "@/lib/visibility";

export default async function TimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ seriesId: string }>;
  searchParams: Promise<{ error?: string; cursor?: string }>;
}) {
  const { seriesId } = await params;
  const sp = await searchParams;
  const viewer = await getRequestViewer(seriesId);
  const [{ dated, undated, nextCursor }, calendar, options, active] = await Promise.all([
    listTimeline(viewer, { cursor: sp.cursor }),
    getSeriesCalendar(seriesId),
    listSectionOptions(viewer),
    getActiveSession(viewer),
  ]);
  const calendarLike = { eras: calendar?.eras ?? [], months: calendar?.months ?? [] };
  const inWorld = (e: TimelineEntryView): string =>
    formatInWorldDate(
      {
        eraId: e.eraId,
        year: e.year,
        monthOrder: e.monthOrder,
        day: e.day,
        precision: e.precision as DatePrecision,
        displayOverride: e.displayOverride,
      },
      calendarLike,
    );
  // Board consumes only dated entries; bigint sortKey crosses the client
  // boundary as a string. In-world dates are formatted server-side.
  const boardEntries = dated
    .filter((e) => e.absoluteSortKey !== null)
    .map((e) => ({
      id: e.id,
      label: e.label,
      dateText: inWorld(e),
      cardId: e.cardId,
      sortKey: String(e.absoluteSortKey),
    }));
  const progressLabel =
    options.find((o) => o.position === viewer.revealIndex)?.label ?? "series start";
  const cardTitles = await getVisibleCardTitles(
    viewer,
    [...dated, ...undated].flatMap((e) => (e.cardId ? [e.cardId] : [])),
  );
  const deleted = viewer.peek
    ? await prisma.timelineEntry.findMany({
        where: { seriesId, deletedAt: { not: null } },
        select: { id: true, label: true },
      })
    : [];
  const sectionLabel = (position: number): string =>
    options.find((o) => o.position === position)?.label ?? "?";

  const row = (e: TimelineEntryView) => (
    <li key={e.id} className="flex items-start gap-3 border-b border-line py-2 last:border-0">
      <span className="tnum w-44 shrink-0 text-sm text-accent">{inWorld(e)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{e.label}</p>
        {e.description && <p className="text-xs text-soft">{e.description}</p>}
        <p className="text-[11px] text-soft">
          revealed at {sectionLabel(e.revealIndex)}
          {e.cardId && cardTitles.has(e.cardId) && (
            <>
              {" · "}
              <Link href={`/series/${seriesId}/cards/${e.cardId}`} className="text-accent underline">
                {cardTitles.get(e.cardId)}
              </Link>
            </>
          )}
        </p>
      </div>
      {viewer.role !== "READER" && (
        <form action={deleteTimelineEntryAction}>
          <input type="hidden" name="seriesId" value={seriesId} />
          <input type="hidden" name="entryId" value={e.id} />
          <Button variant="ghost" size="sm" title="Delete entry">
            <Trash2 className="size-3" />
          </Button>
        </form>
      )}
    </li>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl">Timeline</h1>
      <p className="mb-3 text-xs text-soft">
        Ordered by in-world time; entries beyond your reading position are withheld by the server.
      </p>
      <ErrorNote error={sp.error} />

      {boardEntries.length > 0 && (
        <TimelineBoard
          entries={boardEntries}
          progressLabel={progressLabel}
          goalLabel={active ? active.goalSection.label : null}
          seriesId={seriesId}
        />
      )}

      <Panel className="mb-4">
        {dated.length === 0 ? (
          <p className="text-sm text-soft">No dated entries within your progress.</p>
        ) : (
          <ul>{dated.map(row)}</ul>
        )}
        {nextCursor && (
          <Link
            href={`/series/${seriesId}/timeline?cursor=${nextCursor}`}
            className="mt-2 block text-sm text-accent underline"
          >
            Next page →
          </Link>
        )}
      </Panel>

      {undated.length > 0 && (
        <Panel className="mb-4">
          <h2 className="mb-2 text-sm font-medium text-soft">Undated (unknown precision)</h2>
          <ul>{undated.map(row)}</ul>
        </Panel>
      )}

      {viewer.role !== "READER" && (
        <Panel>
          <h2 className="mb-3 text-lg">New timeline entry</h2>
          <form action={createTimelineEntryAction} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="seriesId" value={seriesId} />
            <div className="sm:col-span-2">
              <Label>Label</Label>
              <Input name="label" required maxLength={300} />
            </div>
            <div className="sm:col-span-2">
              <Label>Description</Label>
              <Input name="description" maxLength={2000} />
            </div>
            <div>
              <Label>Reveal point (narrative time — when the reader learns it)</Label>
              <SectionSelect name="revealSectionId" options={options} required />
            </div>
            <div>
              <Label>Precision</Label>
              <Select name="date_precision" required>
                <option value="YEAR">Year</option>
                <option value="MONTH">Month</option>
                <option value="DAY">Day</option>
                <option value="UNKNOWN">Unknown</option>
              </Select>
            </div>
            <div>
              <Label>Era</Label>
              <Select name="date_era">
                <option value="">—</option>
                {(calendar?.eras ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.abbreviation})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Year (in-world time — when it happened)</Label>
              <Input name="date_year" type="number" />
            </div>
            <div>
              <Label>Month</Label>
              <Select name="date_month">
                <option value="">—</option>
                {(calendar?.months ?? []).map((m) => (
                  <option key={m.order} value={m.order}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Day</Label>
              <Input name="date_day" type="number" min={1} />
            </div>
            <div>
              <Label>Display override (e.g. “the Long Winter”)</Label>
              <Input name="date_override" maxLength={200} />
            </div>
            <div>
              <Label>Manual sort key (UNKNOWN precision only)</Label>
              <Input name="manualSortKey" type="number" />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">Add entry</Button>
            </div>
          </form>
        </Panel>
      )}

      {deleted.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-soft">Deleted entries ({deleted.length})</summary>
          <ul className="mt-2 space-y-1">
            {deleted.map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-sm">
                <span className="text-soft line-through">{e.label}</span>
                <form action={restoreTimelineEntryAction}>
                  <input type="hidden" name="seriesId" value={seriesId} />
                  <input type="hidden" name="entryId" value={e.id} />
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
