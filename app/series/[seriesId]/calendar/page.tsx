import { redirect } from "next/navigation";
import { Panel } from "@/components/ui/card";
import { getRequestViewer } from "@/lib/auth-helpers";
import { getSeriesCalendar } from "@/lib/services/calendar-admin";

/**
 * TODO (Phase 3): visual calendar editor. Schema, seed, era-offset
 * recomputation, and formatInWorldDate are real (Phase 1); this page is a
 * read-only view until then.
 */
export default async function CalendarPage({
  params,
}: {
  params: Promise<{ seriesId: string }>;
}) {
  const { seriesId } = await params;
  const viewer = await getRequestViewer(seriesId);
  if (viewer.role !== "OWNER") redirect(`/series/${seriesId}/cards`);
  const calendar = await getSeriesCalendar(seriesId);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl">Calendar</h1>
      <p className="mb-3 text-xs text-soft">
        Read-only for now — the visual calendar editor ships in Phase 3. Changing an era&apos;s
        year offset already recomputes every derived timeline sort key transactionally.
      </p>
      {!calendar ? (
        <Panel>
          <p className="text-sm text-soft">This series has no calendar yet (create one via seed or Phase 3 editor).</p>
        </Panel>
      ) : (
        <Panel>
          <h2 className="mb-1 text-lg">{calendar.name}</h2>
          {calendar.epochLabel && <p className="mb-2 text-sm text-soft">{calendar.epochLabel}</p>}
          <h3 className="mt-3 text-sm font-medium">Eras</h3>
          <ul className="text-sm text-soft">
            {calendar.eras.map((e) => (
              <li key={e.id} className="tnum">
                {e.name} ({e.abbreviation}) — year offset {e.yearOffset}
              </li>
            ))}
          </ul>
          <h3 className="mt-3 text-sm font-medium">Months</h3>
          <p className="text-sm text-soft">{calendar.months.map((m) => m.name).join(", ")}</p>
          <h3 className="mt-3 text-sm font-medium">Week</h3>
          <p className="text-sm text-soft">
            {calendar.daysPerWeek} days:{" "}
            {Array.isArray(calendar.weekdayNames) ? (calendar.weekdayNames as string[]).join(", ") : ""}
          </p>
        </Panel>
      )}
    </div>
  );
}
