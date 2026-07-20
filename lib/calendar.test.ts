import { describe, expect, it } from "vitest";
import { computeAbsoluteSortKey, formatInWorldDate, type CalendarLike } from "@/lib/calendar";

const calendar: CalendarLike = {
  eras: [
    { id: "fa", yearOffset: 0, abbreviation: "FA" },
    { id: "ta", yearOffset: 6462, abbreviation: "TA" },
  ],
  months: [
    { name: "Frostwane", order: 1 },
    { name: "Rethe", order: 3 },
  ],
};

describe("formatInWorldDate", () => {
  it("renders DAY precision as '14th of Rethe, TA 3019'", () => {
    expect(
      formatInWorldDate(
        { eraId: "ta", year: 3019, monthOrder: 3, day: 14, precision: "DAY", displayOverride: null },
        calendar,
      ),
    ).toBe("14th of Rethe, TA 3019");
  });

  it("renders MONTH precision without a day", () => {
    expect(
      formatInWorldDate(
        { eraId: "ta", year: 3019, monthOrder: 3, day: null, precision: "MONTH", displayOverride: null },
        calendar,
      ),
    ).toBe("Rethe, TA 3019");
  });

  it("renders YEAR precision as era + year", () => {
    expect(
      formatInWorldDate(
        { eraId: "ta", year: 3019, monthOrder: null, day: null, precision: "YEAR", displayOverride: null },
        calendar,
      ),
    ).toBe("TA 3019");
  });

  it("prefers displayOverride over everything", () => {
    expect(
      formatInWorldDate(
        { eraId: "ta", year: 3019, monthOrder: 3, day: 14, precision: "DAY", displayOverride: "the Long Winter" },
        calendar,
      ),
    ).toBe("the Long Winter");
  });

  it("renders UNKNOWN precision as 'Unknown'", () => {
    expect(
      formatInWorldDate(
        { eraId: null, year: null, monthOrder: null, day: null, precision: "UNKNOWN", displayOverride: null },
        calendar,
      ),
    ).toBe("Unknown");
  });

  it("falls back gracefully when the era is missing", () => {
    expect(
      formatInWorldDate(
        { eraId: "nope", year: 55, monthOrder: null, day: null, precision: "YEAR", displayOverride: null },
        calendar,
      ),
    ).toBe("Year 55");
  });

  it("gets English ordinals right", () => {
    const at = (day: number): string =>
      formatInWorldDate(
        { eraId: "fa", year: 1, monthOrder: 1, day, precision: "DAY", displayOverride: null },
        calendar,
      );
    expect(at(1)).toContain("1st");
    expect(at(2)).toContain("2nd");
    expect(at(3)).toContain("3rd");
    expect(at(4)).toContain("4th");
    expect(at(11)).toContain("11th");
    expect(at(12)).toContain("12th");
    expect(at(13)).toContain("13th");
    expect(at(21)).toContain("21st");
  });
});

describe("computeAbsoluteSortKey", () => {
  it("applies the documented formula", () => {
    expect(
      computeAbsoluteSortKey(
        { year: 3019, monthOrder: 3, day: 14, precision: "DAY" },
        { yearOffset: 6462 },
      ),
    ).toBe(9481n * 1_000_000n + 3n * 10_000n + 14n);
  });

  it("sorts YEAR precision to the start of its year", () => {
    expect(
      computeAbsoluteSortKey({ year: 100, monthOrder: null, day: null, precision: "YEAR" }, { yearOffset: 0 }),
    ).toBe(100_000_000n);
  });

  it("truncates stray finer components by precision", () => {
    // e.g. a leftover month/day after downgrading DAY -> YEAR must not skew order
    expect(
      computeAbsoluteSortKey({ year: 100, monthOrder: 6, day: 12, precision: "YEAR" }, { yearOffset: 0 }),
    ).toBe(100_000_000n);
    expect(
      computeAbsoluteSortKey({ year: 100, monthOrder: 6, day: 12, precision: "MONTH" }, { yearOffset: 0 }),
    ).toBe(100_000_000n + 60_000n);
  });

  it("returns null for UNKNOWN precision or missing era/year", () => {
    expect(
      computeAbsoluteSortKey({ year: 1, monthOrder: null, day: null, precision: "UNKNOWN" }, { yearOffset: 0 }),
    ).toBeNull();
    expect(
      computeAbsoluteSortKey({ year: null, monthOrder: null, day: null, precision: "YEAR" }, { yearOffset: 0 }),
    ).toBeNull();
    expect(
      computeAbsoluteSortKey({ year: 1, monthOrder: null, day: null, precision: "YEAR" }, null),
    ).toBeNull();
  });
});
