import type { DatePrecision } from "@prisma/client";

/** The embedded InWorldDate value — columns on TimelineEntry, JSONB in CardFields. */
export type InWorldDate = {
  eraId: string | null;
  year: number | null;
  monthOrder: number | null;
  day: number | null;
  precision: DatePrecision;
  displayOverride: string | null;
};

export type EraLike = { id: string; yearOffset: number; abbreviation: string };
export type MonthLike = { name: string; order: number };
export type CalendarLike = { eras: EraLike[]; months: MonthLike[] };

/**
 * absoluteYear = era.yearOffset + year
 * absoluteSortKey = absoluteYear * 1_000_000 + (monthOrder ?? 0) * 10_000 + (day ?? 0)
 * YEAR precision sorts to the start of its year. UNKNOWN has no sort key.
 */
export function computeAbsoluteSortKey(
  date: Pick<InWorldDate, "year" | "monthOrder" | "day" | "precision">,
  era: Pick<EraLike, "yearOffset"> | null,
): bigint | null {
  if (date.precision === "UNKNOWN" || date.year === null || era === null) return null;
  const absoluteYear = BigInt(era.yearOffset + date.year);
  // Precision truncates: a YEAR date sorts to the start of its year, a MONTH
  // date to the start of its month — stray finer components (e.g. left over
  // from a precision downgrade) must not skew ordering.
  const month = date.precision === "YEAR" ? 0 : (date.monthOrder ?? 0);
  const day = date.precision === "DAY" ? (date.day ?? 0) : 0;
  return absoluteYear * 1_000_000n + BigInt(month) * 10_000n + BigInt(day);
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "14th of Rethe, TA 3019" | "Rethe, TA 3019" | "TA 3019" | displayOverride | "Unknown" */
export function formatInWorldDate(date: InWorldDate, calendar: CalendarLike): string {
  if (date.displayOverride) return date.displayOverride;
  if (date.precision === "UNKNOWN" || date.year === null) return "Unknown";

  const era = calendar.eras.find((e) => e.id === date.eraId);
  const yearPart = era ? `${era.abbreviation} ${date.year}` : `Year ${date.year}`;
  if (date.precision === "YEAR" || date.monthOrder === null) return yearPart;

  const month = calendar.months.find((m) => m.order === date.monthOrder);
  const monthName = month?.name ?? `Month ${date.monthOrder}`;
  if (date.precision === "MONTH" || date.day === null) return `${monthName}, ${yearPart}`;

  return `${ordinal(date.day)} of ${monthName}, ${yearPart}`;
}
