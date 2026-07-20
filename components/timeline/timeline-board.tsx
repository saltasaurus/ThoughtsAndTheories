"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * Custom in-world time axis. vis-timeline models the axis as real JS Dates and
 * cannot accept a plain integer/bigint axis; per SPEC we build our own rather
 * than coerce fictional dates into real Date objects. Entries are positioned by
 * absoluteSortKey (in-world time) on a horizontally scrollable canvas. The
 * reveal clamp is enforced server-side — entries beyond progress are simply
 * absent — so the "your progress" boundary and the session goal are rendered as
 * legend/state indicators, NOT axis positions (narrative time and in-world time
 * do not share a scale).
 */
export type BoardEntry = {
  id: string;
  label: string;
  dateText: string;
  cardId: string | null;
  sortKey: string; // bigint serialized
};

const PAD = 28; // px inset at both ends so end labels never clip
const LABEL_W = 156; // px reserved per label
const LANE_H = 46; // px per stacked lane
const TOP = 10; // px top inset
const AXIS_GAP = 28; // px between the lowest lane and the axis

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

  const { placed, width, laneCount } = useMemo(() => {
    const nums = entries.map((e) => Number(e.sortKey));
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    // Canvas is at least this wide; grows with entry count so clusters spread
    // and the strip scrolls instead of cropping.
    const w = Math.max(560, entries.length * 185);
    const usable = w - 2 * PAD - LABEL_W; // anchor range keeps every label inside
    const laneLastX: number[] = [];
    const out = entries.map((e, i) => {
      const leftPx = PAD + ((nums[i]! - min) / span) * usable;
      // stack vertically when labels would overlap horizontally
      let lane = laneLastX.findIndex((last) => leftPx - last >= LABEL_W * 0.6);
      if (lane === -1) {
        lane = laneLastX.length;
        laneLastX.push(leftPx);
      } else {
        laneLastX[lane] = leftPx;
      }
      return { ...e, leftPx, lane };
    });
    return { placed: out, width: w, laneCount: Math.max(1, laneLastX.length) };
  }, [entries]);

  const height = TOP + laneCount * LANE_H + AXIS_GAP + 22;
  const axisY = height - 22;

  return (
    <div className="mb-4">
      <div className="overflow-x-auto overflow-y-hidden rounded-md border border-line bg-surface">
        <div className="relative" style={{ width, height }}>
          <div className="absolute h-px bg-line" style={{ left: PAD, right: PAD, top: axisY }} />
          {placed.map((p) => {
            const top = TOP + p.lane * LANE_H;
            const active = hover === p.id;
            const body = (
              <>
                <span
                  className={`block truncate text-[11px] ${active ? "text-ink" : "text-soft"}`}
                  title={p.label}
                >
                  {p.label}
                </span>
                <span className="tnum block text-[10px] text-accent">{p.dateText}</span>
              </>
            );
            return (
              <div
                key={p.id}
                className="absolute"
                style={{ left: p.leftPx, top, width: LABEL_W }}
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover(null)}
              >
                {/* stem down to the axis */}
                <div
                  className="absolute w-px bg-line"
                  style={{ left: 0, top: 30, height: Math.max(0, axisY - top - 30) }}
                />
                {/* dot sitting on the axis */}
                <div
                  className="absolute size-2 rounded-full bg-accent"
                  style={{ left: -3, top: axisY - top - 4 }}
                />
                {p.cardId ? (
                  <Link href={`/series/${seriesId}/cards/${p.cardId}`} className="block">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </div>
            );
          })}
          <span className="tnum absolute text-[10px] text-soft" style={{ left: PAD, top: axisY + 6 }}>
            {placed[0]?.dateText}
          </span>
          <span
            className="tnum absolute text-[10px] text-soft"
            style={{ right: PAD, top: axisY + 6 }}
          >
            {placed[placed.length - 1]?.dateText}
          </span>
        </div>
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
          entries past your progress are withheld entirely. Scroll horizontally for later dates.
        </span>
      </div>
    </div>
  );
}
