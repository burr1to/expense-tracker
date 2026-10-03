import { describe, expect, it } from "vitest";
import { adToBs, bsDaysInMonth, bsToAd, BS_MAX_YEAR, BS_MIN_YEAR, formatBs, formatBsMonthSpan, isSupportedAdDate } from "./nepali-date";
import { formatLedgerDay, formatLedgerMonth } from "./dates";
import { addMonthsToKey, daysInPeriod, monthBounds, monthKeyOf, monthLabel } from "./period";

/**
 * Nepali New Year (Baishakh 1) against its published Gregorian date. These are
 * the load-bearing assertions: a wrong conversion table shifts every date in
 * the affected year, and these anchors are the only thing that would catch it.
 */
const NEW_YEARS: ReadonlyArray<[number, string]> = [
  [2000, "1943-04-14"],
  [2050, "1993-04-13"],
  [2060, "2003-04-14"],
  [2070, "2013-04-14"],
  [2075, "2018-04-14"],
  [2076, "2019-04-14"],
  [2077, "2020-04-13"],
  [2078, "2021-04-14"],
  [2079, "2022-04-14"],
  [2080, "2023-04-14"],
  [2081, "2024-04-13"],
  [2082, "2025-04-14"],
  [2083, "2026-04-14"],
];

describe("Bikram Sambat anchors", () => {
  it.each(NEW_YEARS)("places Baishakh 1 of BS %i on %s", (year, iso) => {
    expect(bsToAd({ year, month: 1, day: 1 })).toBe(iso);
    expect(adToBs(iso)).toEqual({ year, month: 1, day: 1 });
  });
});

describe("conversion round trips", () => {
  it("round-trips every month boundary across the supported range", () => {
    for (let year = BS_MIN_YEAR; year < BS_MAX_YEAR; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const first = { year, month, day: 1 };
        expect(adToBs(bsToAd(first))).toEqual(first);
        const last = { year, month, day: bsDaysInMonth(year, month) };
        expect(adToBs(bsToAd(last))).toEqual(last);
      }
    }
  });

  it("round-trips a run of consecutive Gregorian days", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    for (let offset = 0; offset < 400; offset += 1) {
      const iso = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
      expect(bsToAd(adToBs(iso))).toBe(iso);
    }
  });
});

describe("month lengths", () => {
  it("only ever reports 29 to 32 days", () => {
    for (let year = BS_MIN_YEAR; year < BS_MAX_YEAR; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const days = bsDaysInMonth(year, month);
        expect(days).toBeGreaterThanOrEqual(29);
        expect(days).toBeLessThanOrEqual(32);
      }
    }
  });

  it("sums each year to a Gregorian year length", () => {
    for (let year = BS_MIN_YEAR; year < BS_MAX_YEAR; year += 1) {
      const total = Array.from({ length: 12 }, (_, index) => bsDaysInMonth(year, index + 1)).reduce((sum, days) => sum + days, 0);
      expect(total, `BS ${year} has ${total} days`).toBeGreaterThanOrEqual(365);
      expect(total, `BS ${year} has ${total} days`).toBeLessThanOrEqual(366);
    }
  });
});

describe("range guards", () => {
  it("refuses years outside the supported table rather than guessing", () => {
    expect(() => bsToAd({ year: BS_MIN_YEAR - 1, month: 1, day: 1 })).toThrow(/supported range/);
    expect(() => bsToAd({ year: BS_MAX_YEAR + 1, month: 1, day: 1 })).toThrow(/supported range/);
    expect(() => bsToAd({ year: 2083, month: 13, day: 1 })).toThrow(/Invalid Bikram Sambat month/);
  });

  it("reports whether a Gregorian date is convertible", () => {
    expect(isSupportedAdDate("2026-08-12")).toBe(true);
    expect(isSupportedAdDate("1850-01-01")).toBe(false);
  });
});

describe("formatting", () => {
  it("names the Bikram Sambat months inside a Gregorian month", () => {
    expect(formatBsMonthSpan("2026-09-01", "2026-09-30")).toBe("Bhadra–Ashwin 2083");
    expect(formatLedgerMonth(new Date(2026, 8, 1), "BS")).toBe("Bhadra–Ashwin 2083");
    expect(formatLedgerMonth(new Date(2026, 8, 1), "AD")).toBe("September 2026");
    expect(formatLedgerDay("2026-09-25", "BS", "date")).toBe("Ashwin 9, 2083 · Sep 25");
  });

  it("renders long, short and numeric styles", () => {
    const parts = { year: 2083, month: 4, day: 27 };
    expect(formatBs(parts)).toBe("Shrawan 27, 2083");
    expect(formatBs(parts, "short")).toBe("Shr 27, 2083");
    expect(formatBs(parts, "numeric")).toBe("2083-04-27");
  });
});

describe("integration with the period layer", () => {
  it("derives a BS month key from a Gregorian date", () => {
    // 12 August 2026 falls in Shrawan 2083.
    expect(monthKeyOf("2026-08-12", "BS")).toBe("BS:2083-04");
  });

  it("resolves BS month bounds back to Gregorian dates", () => {
    const bounds = monthBounds("BS:2083-04");
    expect(bounds.start).toBe(bsToAd({ year: 2083, month: 4, day: 1 }));
    expect(bounds.endExclusive).toBe(bsToAd({ year: 2083, month: 5, day: 1 }));
  });

  it("labels a BS month with its Nepali name", () => {
    expect(monthLabel("BS:2083-04")).toBe("Shrawan 2083");
  });

  it("counts BS month days through the period layer", () => {
    expect(daysInPeriod("BS:2083-04")).toBe(bsDaysInMonth(2083, 4));
  });

  it("steps BS months across the year boundary", () => {
    expect(addMonthsToKey("BS:2083-12", 1)).toBe("BS:2084-01");
    expect(addMonthsToKey("BS:2084-01", -1)).toBe("BS:2083-12");
  });
});
