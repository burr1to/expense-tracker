import { describe, expect, it } from "vitest";
import {
  compareFestivalSpending,
  festivalBounds,
  festivalById,
  festivalLabel,
  festivalMonthLabel,
  festivalOn,
  festivalPeriodKey,
  FESTIVALS,
  upcomingFestival,
} from "./festivals";
import { bsToAd } from "./nepali-date";
import { monthBounds } from "./period";

const dashain = festivalById("dashain")!;
const tihar = festivalById("tihar")!;

describe("festival definitions", () => {
  it("knows the Bikram Sambat month each festival falls in", () => {
    expect(dashain.bsMonth).toBe(6);
    expect(festivalMonthLabel(dashain)).toBe("Ashwin");
    expect(tihar.bsMonth).toBe(7);
    expect(festivalMonthLabel(tihar)).toBe("Kartik");
  });

  it("gives every festival a distinct id and month", () => {
    expect(new Set(FESTIVALS.map((festival) => festival.id)).size).toBe(FESTIVALS.length);
    expect(new Set(FESTIVALS.map((festival) => festival.bsMonth)).size).toBe(FESTIVALS.length);
  });

  it("returns null for an unknown id", () => {
    expect(festivalById("nope")).toBeNull();
  });
});

describe("festival periods", () => {
  it("maps a festival to its Bikram Sambat month key", () => {
    expect(festivalPeriodKey(dashain, 2083)).toBe("BS:2083-06");
    expect(festivalPeriodKey(tihar, 2083)).toBe("BS:2083-07");
  });

  it("resolves bounds identical to the underlying BS month", () => {
    expect(festivalBounds(dashain, 2083)).toEqual(monthBounds("BS:2083-06"));
  });

  it("puts Dashain 2083 in the Gregorian autumn", () => {
    const { start } = festivalBounds(dashain, 2083);

    expect(start.slice(0, 4)).toBe("2026");
    expect(["09", "10"]).toContain(start.slice(5, 7));
  });

  it("labels a festival with its year", () => {
    expect(festivalLabel(dashain, 2083)).toBe("Dashain 2083");
  });

  it("refuses a year outside the supported range", () => {
    expect(() => festivalPeriodKey(dashain, 1999)).toThrow(/supported range/);
  });
});

describe("festivalOn", () => {
  it("identifies the festival whose month contains a date", () => {
    const insideDashain = bsToAd({ year: 2083, month: 6, day: 5 });

    expect(festivalOn(insideDashain)).toMatchObject({ bsYear: 2083, festival: { id: "dashain" } });
  });

  it("returns null in a month with no festival", () => {
    // Shrawan (month 4) carries no festival in this list.
    expect(festivalOn(bsToAd({ year: 2083, month: 4, day: 10 }))).toBeNull();
  });
});

describe("upcomingFestival", () => {
  it("finds the next festival within the window", () => {
    // Shrawan 1, 2083 — Teej (Bhadra) is the next month.
    const result = upcomingFestival(bsToAd({ year: 2083, month: 4, day: 1 }), 60);

    expect(result?.festival.id).toBe("teej");
    expect(result?.bsYear).toBe(2083);
    expect(result!.daysAway).toBeGreaterThan(0);
  });

  it("reports zero days away while a festival month is running", () => {
    const result = upcomingFestival(bsToAd({ year: 2083, month: 6, day: 3 }), 60);

    expect(result?.festival.id).toBe("dashain");
    expect(result?.daysAway).toBe(0);
  });

  it("returns null when nothing falls inside the window", () => {
    // Poush (month 9) — the next festival is Falgun, well beyond 10 days.
    expect(upcomingFestival(bsToAd({ year: 2083, month: 9, day: 1 }), 10)).toBeNull();
  });

  it("rolls into the next Bikram Sambat year near the year end", () => {
    // Chaitra (month 12) — the next festival is Teej in the following year.
    const result = upcomingFestival(bsToAd({ year: 2083, month: 12, day: 1 }), 200);

    expect(result?.bsYear).toBe(2084);
    expect(result?.festival.id).toBe("teej");
  });
});

describe("year-over-year comparison", () => {
  const spend = (values: Record<string, number>) => (key: string) => values[key] ?? 0;

  it("compares against the same festival last year", () => {
    const result = compareFestivalSpending(dashain, 2083, spend({ "BS:2083-06": 4_820_000, "BS:2082-06": 4_300_000 }));

    expect(result).toMatchObject({
      periodKey: "BS:2083-06",
      spentMinor: 4_820_000,
      previousPeriodKey: "BS:2082-06",
      previousSpentMinor: 4_300_000,
      changePercentage: 12,
    });
  });

  it("reports a decrease as a negative percentage", () => {
    const result = compareFestivalSpending(dashain, 2083, spend({ "BS:2083-06": 2_000_000, "BS:2082-06": 4_000_000 }));

    expect(result.changePercentage).toBe(-50);
  });

  it("returns a null change rather than a misleading figure when last year had no spending", () => {
    const result = compareFestivalSpending(dashain, 2083, spend({ "BS:2083-06": 4_820_000 }));

    expect(result.previousSpentMinor).toBe(0);
    expect(result.changePercentage).toBeNull();
  });

  it("has no previous period at the start of the supported range", () => {
    const result = compareFestivalSpending(dashain, 2000, spend({}));

    expect(result.previousPeriodKey).toBeNull();
    expect(result.previousSpentMinor).toBeNull();
    expect(result.changePercentage).toBeNull();
  });
});
