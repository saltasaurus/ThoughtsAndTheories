import { Trash2 } from "lucide-react";
import {
  createSessionAction,
  deleteSessionAction,
  setSessionStatusAction,
  updateSessionGoalAction,
} from "@/app/actions/sessions";
import { SectionSelect } from "@/components/cards/section-select";
import { ErrorNote } from "@/components/error-note";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getRequestViewer } from "@/lib/auth-helpers";
import { getRosterAnalytics, listMembers } from "@/lib/services/memberships";
import { listSessions, listSectionOptions } from "@/lib/visibility";
import { TiptapContent } from "@/lib/tiptap-render";

const STATE_LABEL = { behind: "behind", at_goal: "at goal", ahead: "ahead" } as const;
const STATE_CLASS = {
  behind: "bg-character/20 text-character",
  at_goal: "bg-location/20 text-location",
  ahead: "bg-event/20 text-event",
} as const;

export default async function SessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ seriesId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { seriesId } = await params;
  const { error } = await searchParams;
  const viewer = await getRequestViewer(seriesId);
  const [sessions, members, options, analytics] = await Promise.all([
    listSessions(viewer),
    listMembers(viewer),
    listSectionOptions(viewer),
    getRosterAnalytics(viewer),
  ]);
  const isEditor = viewer.role !== "READER";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-3 text-2xl">Sessions</h1>
      <ErrorNote error={error} />

      <div className="mb-4 space-y-3">
        {sessions.length === 0 && <p className="text-sm text-soft">No sessions yet.</p>}
        {sessions.map((s) => (
          <Panel key={s.id}>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg">{s.title}</h2>
              <Badge
                className={
                  s.status === "ACTIVE"
                    ? "border-location/50 text-location"
                    : s.status === "COMPLETED"
                      ? "border-line text-soft"
                      : "border-event/50 text-event"
                }
              >
                {s.status.toLowerCase()}
              </Badge>
              {isEditor && (
                <div className="ml-auto flex gap-1.5">
                  {s.status !== "ACTIVE" && (
                    <form action={setSessionStatusAction}>
                      <input type="hidden" name="seriesId" value={seriesId} />
                      <input type="hidden" name="sessionId" value={s.id} />
                      <input type="hidden" name="status" value="ACTIVE" />
                      <Button variant="outline" size="sm">Make active</Button>
                    </form>
                  )}
                  {s.status === "ACTIVE" && (
                    <form action={setSessionStatusAction}>
                      <input type="hidden" name="seriesId" value={seriesId} />
                      <input type="hidden" name="sessionId" value={s.id} />
                      <input type="hidden" name="status" value="COMPLETED" />
                      <Button variant="outline" size="sm">Complete</Button>
                    </form>
                  )}
                  <form action={deleteSessionAction}>
                    <input type="hidden" name="seriesId" value={seriesId} />
                    <input type="hidden" name="sessionId" value={s.id} />
                    {/* Icon-only: without aria-label a screen reader announces
                        nothing at all for this button. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete session ${s.title}`}
                      title="Delete session"
                    >
                      <Trash2 className="size-3" aria-hidden="true" />
                    </Button>
                  </form>
                </div>
              )}
            </div>
            <p className="mb-1 text-sm">
              <span className="text-soft">Goal: </span>
              <span className="tnum">
                {s.goalSection.label}
                {s.goalSection.title ? ` — ${s.goalSection.title}` : ""}
              </span>
            </p>
            {isEditor && (
              <form
                action={updateSessionGoalAction}
                className="mb-2 flex flex-wrap items-end gap-1.5"
              >
                <input type="hidden" name="seriesId" value={seriesId} />
                <input type="hidden" name="sessionId" value={s.id} />
                <SectionSelect
                  name="goalSectionId"
                  options={options}
                  defaultValue={s.goalSection.id}
                  ariaLabel={`Goal section for ${s.title}`}
                  required
                />
                <Button variant="outline" size="sm" aria-label={`Move goal for ${s.title}`}>
                  Move goal
                </Button>
              </form>
            )}
            {s.scheduledAt && (
              <p className="mb-1 text-xs text-soft">Scheduled {s.scheduledAt.toLocaleString()}</p>
            )}
            {s.notes !== null && s.notes !== undefined && <TiptapContent doc={s.notes} />}
          </Panel>
        ))}
      </div>

      <Panel className="mb-4">
        <h2 className="mb-2 text-lg">Roster</h2>

        {analytics.goalRevealIndex === null ? (
          <p className="mb-2 text-sm text-soft">
            No active session — pacing is measured against the active session&apos;s goal.
          </p>
        ) : (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            {(["behind", "at_goal", "ahead"] as const).map((k) => (
              <span key={k} className={`rounded-full px-2 py-0.5 text-[11px] ${STATE_CLASS[k]}`}>
                <span className="tnum font-medium">{analytics.counts[k]}</span> {STATE_LABEL[k]}
              </span>
            ))}
            <span className="tnum text-[11px] text-soft">
              of {analytics.totalMembers} member{analytics.totalMembers === 1 ? "" : "s"}
            </span>
          </div>
        )}

        <ul className="space-y-1">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2 text-sm">
              <span>{m.name}</span>
              <span className="text-[11px] uppercase text-soft">{m.role.toLowerCase()}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-soft">
          Pacing is shown as counts only, never per member. How far someone has read is their
          business — and because the goal can be moved at will, a per-name badge would let it be
          narrowed down by moving the goal and watching who changes.
        </p>
      </Panel>

      {isEditor && (
        <Panel>
          <h2 className="mb-3 text-lg">New session</h2>
          <form action={createSessionAction} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="seriesId" value={seriesId} />
            <div>
              <Label>Title</Label>
              <Input name="title" required maxLength={200} />
            </div>
            <div>
              <Label>Scheduled at</Label>
              <Input name="scheduledAt" type="datetime-local" />
            </div>
            <div>
              <Label>Goal section (never gated — labels only)</Label>
              <SectionSelect name="goalSectionId" options={options} required />
            </div>
            <div>
              <Label>Status</Label>
              <Select name="status" defaultValue="UPCOMING">
                <option value="UPCOMING">Upcoming</option>
                <option value="ACTIVE">Active</option>
                <option value="COMPLETED">Completed</option>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Notes</Label>
              <p className="mb-1 text-[11px] text-danger">
                Notes are free text and visible to ALL members regardless of their progress — the
                system cannot gate what you write here. Mind spoilers.
              </p>
              <RichTextEditor name="notes" />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">Create session</Button>
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}
