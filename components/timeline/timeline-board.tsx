"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * Custom in-world time axis. vis-timeline models the axis as real JS Dates and
 * cannot accept a plain integer/bigint axis; per SPEC we build our own rather
 * than coerce fictional dates into real Date objects. Entries are positioned by
 * absoluteSortKey (in-world time). The reveal clamp is enforced server-side —
 * entries beyond progress are simply absent — so the "your progress" boundary
 * and the session goal are rendered as legend/state indicators, NOT axis
 * positions (narrative time and in-world time do not share a scale).
 */
export type BoardEntry = {
  id: string;
  label: string;
  dateText: string;
  cardId: string | null;
  sortKey: string; // bigint serialized
};

const MIN_GAP = 9; // percent — lane-stacking threshold
const LANE_H = 44; // px

export function TimelineBoard({
  entries,
  progressLabel,
  goalLabel,
  seriesId,
}: {
  entries: BoardEntry[];
  progressLabel: string;
  goalLabel: string | null;
  seriesId: string;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const placed = useMemo(() => {
    const nums = entries.map((e) => Number(e.sortKey));
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const laneLastX: number[] = [];
    return entries.map((e, i) => {
      const x = ((nums[i]! - min) / span) * 100;
      let lane = laneLastX.findIndex((last) => x - last >= MIN_GAP);
      if (lane === -1) {
        lane = laneLastX.length;
        laneLastX.push(x);
      } else {
        laneLastX[lane] = x;
      }
      return { ...e, x, lane };
    });
  }, [entries]);

  const laneCount = Math.max(1, ...placed.map((p) => p.lane + 1));
  const height = laneCount * LANE_H + 28;

  return (
    <div className="mb-4">
      <div
        className="relative w-full overflow-hidden rounded-md border border-line bg-surface px-2"
        style={{ height }}
      >
        {/* baseline axis */}
        <div className="absolute inset-x-2 bottom-6 h-px bg-line" />
        {placed.map((p) => {
          const top = p.lane * LANE_H + 6;
          const active = hover === p.id;
          const marker = (
            <div
              className="flex flex-col items-start gap-0.5"
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover(null)}
            >
              <span
                className={`max-w-[160px] truncate text-[11px] ${active ? "text-ink" : "text-soft"}`}
              >
                {p.label}
              </span>
              <span className="tnum text-[10px] text-accent">{p.dateText}</span>
            </div>
          );
          return (
            <div
              key={p.id}
              className="absolute"
              style={{ left: `calc(${p.x}% )`, top, transform: "translateX(-2px)" }}
            >
              {p.cardId ? (
                <Link href={`/series/${seriesId}/cards/${p.cardId}`}>{marker}</Link>
              ) : (
                marker
              )}
              {/* stem to the axis */}
              <div
                className="absolute w-px bg-line"
                style={{ left: 1, top: 28, height: height - top - 28 - 6 }}
              />
              <div
                className="absolute size-2 rounded-full bg-accent"
                style={{ left: -3, bottom: -(height - top - 28) + 22 }}
              />
            </div>
          );
        })}
        {/* end anchors */}
        <span className="tnum absolute bottom-1 left-2 text-[10px] text-soft">
          {placed[0]?.dateText}
        </span>
        <span className="tnum absolute bottom-1 right-2 text-[10px] text-soft">
          {placed[placed.length - 1]?.dateText}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-soft">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-accent" /> in-world event
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full border border-location" /> your progress:{" "}
          <span className="text-location">{progressLabel}</span>
        </span>
        {goalLabel && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full border border-theory" /> session goal:{" "}
            <span className="text-theory">{goalLabel}</span>
          </span>
        )}
        <span>
          Axis is in-world time; the reveal clamp is a server-side filter, not an axis position —
          entries past your progress are withheld entirely.
        </span>
      </div>
    </div>
  );
}
