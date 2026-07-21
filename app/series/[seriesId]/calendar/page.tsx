import { redirect } from "next/navigation";
import {
  addEraAction,
  addMonthAction,
  createCalendarAction,
  deleteEraAction,
  deleteMonthAction,
  updateCalendarAction,
  updateEraAction,
  updateMonthAction,
} from "@/app/actions/calendar";
import { ErrorNote } from "@/components/error-note";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getRequestViewer } from "@/lib/auth-helpers";
import { getSeriesCalendar } from "@/lib/services/calendar-admin";

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ seriesId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { seriesId } = await params;
  const { error } = await searchParams;
  const viewer = await getRequestViewer(seriesId);
  if (viewer.role !== "OWNER") redirect(`/series/${seriesId}/cards`);
  const calendar = await getSeriesCalendar(seriesId);
  const weekdays = Array.isArray(calendar?.weekdayNames) ? (calendar.weekdayNames as string[]) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl">Calendar</h1>
      <ErrorNote error={error} />

      {!calendar ? (
        <Panel>
          <h2 className="mb-1 text-lg">Create a calendar</h2>
          <p className="mb-2 text-xs text-soft">
            A series has at most one calendar. Add eras and months after creating it.
          </p>
          <form action={createCalendarAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="seriesId" value={seriesId} />
            <div>
              <Label>Name</Label>
              <Input name="name" placeholder="Reckoning of the Vale" className="w-52" required />
            </div>
            <div>
              <Label>Epoch label</Label>
              <Input name="epochLabel" placeholder="Ages of the Vale" className="w-44" />
            </div>
            <div>
              <Label>Days per week</Label>
              <Input
                name="daysPerWeek"
                type="number"
                min={1}
                max={31}
                defaultValue={7}
                className="w-24"
              />
            </div>
            <div>
              <Label>Weekday names (comma-separated)</Label>
              <Input name="weekdayNames" placeholder="Moonday, Tidesday, …" className="w-64" />
            </div>
            <Button>Create calendar</Button>
          </form>
        </Panel>
      ) : (
        <>
          <Panel>
            <h2 className="mb-2 text-lg">Calendar &amp; week</h2>
            <form action={updateCalendarAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="seriesId" value={seriesId} />
              <input type="hidden" name="calendarId" value={calendar.id} />
              <div>
                <Label>Name</Label>
                <Input name="name" defaultValue={calendar.name} className="w-52" />
              </div>
              <div>
                <Label>Epoch label</Label>
                <Input name="epochLabel" defaultValue={calendar.epochLabel ?? ""} className="w-44" />
              </div>
              <div>
                <Label>Days per week</Label>
                <Input
                  name="daysPerWeek"
                  type="number"
                  min={1}
                  max={31}
                  defaultValue={calendar.daysPerWeek}
                  className="w-24"
                />
              </div>
              <div>
                <Label>Weekday names (comma-separated)</Label>
                <Input name="weekdayNames" defaultValue={weekdays.join(", ")} className="w-64" />
              </div>
              <Button>Save</Button>
            </form>
          </Panel>

          <Panel>
            <h2 className="mb-1 text-lg">Eras</h2>
            <p className="mb-2 text-xs text-soft">
              Changing a year offset recomputes every dated entry&apos;s sort key in one
              transaction. An era that dates any entry cannot be deleted.
            </p>
            <ul className="space-y-2">
              {calendar.eras.map((e) => (
                <li key={e.id} className="flex flex-wrap items-end gap-2">
                  <form action={updateEraAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="seriesId" value={seriesId} />
                    <input type="hidden" name="eraId" value={e.id} />
                    <div>
                      <Label>Name</Label>
                      <Input name="name" defaultValue={e.name} className="w-44" />
                    </div>
                    <div>
                      <Label>Abbr.</Label>
                      <Input name="abbreviation" defaultValue={e.abbreviation} className="w-20" />
                    </div>
                    <div>
                      <Label>Year offset</Label>
                      <Input
                        name="yearOffset"
                        type="number"
                        defaultValue={e.yearOffset}
                        className="w-28"
                      />
                    </div>
                    <Button size="sm">Save</Button>
                  </form>
                  <form action={deleteEraAction}>
                    <input type="hidden" name="seriesId" value={seriesId} />
                    <input type="hidden" name="eraId" value={e.id} />
                    <Button variant="outline" size="sm">
                      Delete
                    </Button>
                  </form>
                </li>
              ))}
            </ul>

            <form
              action={addEraAction}
              className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"
            >
              <input type="hidden" name="seriesId" value={seriesId} />
              <input type="hidden" name="calendarId" value={calendar.id} />
              <div>
                <Label>Name</Label>
                <Input name="name" placeholder="Third Age" className="w-44" required />
              </div>
              <div>
                <Label>Abbr.</Label>
                <Input name="abbreviation" placeholder="TA" className="w-20" required />
              </div>
              <div>
                <Label>Year offset</Label>
                <Input name="yearOffset" type="number" defaultValue={0} className="w-28" />
              </div>
              <Button size="sm">Add era</Button>
            </form>
          </Panel>

          <Panel>
            <h2 className="mb-1 text-lg">Months</h2>
            <p className="mb-2 text-xs text-soft">
              Months are append-only and never renumbered: timeline entries store the month&apos;s
              number, not a link to it, so reordering would silently re-date them.
            </p>
            <ul className="space-y-2">
              {calendar.months.map((m) => (
                <li key={m.id} className="flex flex-wrap items-end gap-2">
                  <span className="tnum w-8 pb-2 text-xs text-soft">{m.order}</span>
                  <form action={updateMonthAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="seriesId" value={seriesId} />
                    <input type="hidden" name="monthId" value={m.id} />
                    <div>
                      <Label>Name</Label>
                      <Input name="name" defaultValue={m.name} className="w-44" />
                    </div>
                    <div>
                      <Label>Days</Label>
                      <Input
                        name="dayCount"
                        type="number"
                        min={1}
                        defaultValue={m.dayCount}
                        className="w-20"
                      />
                    </div>
                    <Button size="sm">Save</Button>
                  </form>
                  <form action={deleteMonthAction}>
                    <input type="hidden" name="seriesId" value={seriesId} />
                    <input type="hidden" name="monthId" value={m.id} />
                    <Button variant="outline" size="sm">
                      Delete
                    </Button>
                  </form>
                </li>
              ))}
            </ul>

            <form
              action={addMonthAction}
              className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"
            >
              <input type="hidden" name="seriesId" value={seriesId} />
              <input type="hidden" name="calendarId" value={calendar.id} />
              <div>
                <Label>Name</Label>
                <Input name="name" placeholder="Harvestide" className="w-44" required />
              </div>
              <div>
                <Label>Days</Label>
                <Input name="dayCount" type="number" min={1} defaultValue={30} className="w-20" />
              </div>
              <Button size="sm">Add month</Button>
            </form>
          </Panel>
        </>
      )}
    </div>
  );
}
