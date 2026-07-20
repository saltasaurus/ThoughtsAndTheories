import { BookOpen, Target } from "lucide-react";
import { jumpToGoalAction, setProgressAction } from "@/app/actions/progress";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { SectionOption, SessionView, Viewer } from "@/lib/visibility";

/**
 * The app's defining mechanic, always visible in the shell: where I am, where
 * the group should be, and a one-click jump between them.
 */
export function ReadingPosition({
  viewer,
  options,
  active,
  currentSectionId,
}: {
  viewer: Viewer;
  options: SectionOption[];
  active: SessionView | null;
  currentSectionId: string | null;
}) {
  const returnTo = `/series/${viewer.seriesId}/cards`;
  const current = options.find((o) => o.id === currentSectionId);
  const state =
    active === null
      ? null
      : viewer.revealIndex < active.goalRevealIndex
        ? "behind"
        : viewer.revealIndex === active.goalRevealIndex
          ? "at goal"
          : "ahead";

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-surface px-4 py-2">
      <form action={setProgressAction} className="flex items-center gap-2">
        <BookOpen className="size-4 shrink-0 text-accent" aria-hidden />
        <span className="text-xs font-medium text-soft">I&apos;m at</span>
        <input type="hidden" name="seriesId" value={viewer.seriesId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <Select name="sectionId" defaultValue={currentSectionId ?? ""} className="w-auto min-w-48">
          <option value="">Not started</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
              {o.title ? ` — ${o.title}` : ""}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline" size="sm">
          Set
        </Button>
      </form>

      {active && (
        <div className="flex items-center gap-2 text-sm">
          <Target className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="text-xs font-medium text-soft">Session goal</span>
          <span className="tnum">
            {active.goalSection.label}
            {active.goalSection.title ? ` — ${active.goalSection.title}` : ""}
          </span>
          {state && (
            <span
              className={
                state === "behind"
                  ? "rounded-full bg-character/20 px-2 py-0.5 text-[11px] text-character"
                  : state === "at goal"
                    ? "rounded-full bg-location/20 px-2 py-0.5 text-[11px] text-location"
                    : "rounded-full bg-event/20 px-2 py-0.5 text-[11px] text-event"
              }
            >
              {state}
            </span>
          )}
          {current?.id !== active.goalSection.id && (
            <form action={jumpToGoalAction}>
              <input type="hidden" name="seriesId" value={viewer.seriesId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <Button type="submit" variant="ghost" size="sm">
                Jump to goal
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
