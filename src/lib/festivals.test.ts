import { describe, expect, it } from "vitest";
import {
  compareFestivalSpending,
  expensesBetween,
  festivalBounds,
  festivalById,
  festivalHeadsUp,
  festivalLabel,
  festivalMainDays,
  festivalMonthLabel,
  festivalOn,
  festivalPeriodKey,
  festivalSeasonsFrom,
  FESTIVALS,
  parseFestivalPeriodKey,
  upcomingFestival,
} from "./festivals";
import { adToBs, bsToAd } from "./nepali-date";
import { periodBounds, STORAGE_PERIOD_KEY } from "./period";

const dashainTihar = festivalById("dashain-tihar")!;
const holi = festivalById("holi")!;
const teej = festivalById("teej")!;
const bs = (iso: string) => { const parts = adToBs(iso); return `${parts.year}-${parts.month}-${parts.day}`; };

describe("festival definitions", () => {
  it("treats Dashain and Tihar as one Ashwin–Kartik season and Holi as Falgun–Chaitra", () => {
    expect(dashainTihar).toMatchObject({ name: "Dashain–Tihar", startMonth: 6, months: 2 });
    expect(festivalMonthLabel(dashainTihar)).toBe("Ashwin–Kartik");
    expect(festivalMonthLabel(holi)).toBe("Falgun–Chaitra");
    expect(festivalMonthLabel(teej)).toBe("Bhadra");
  });

  it("gives every festival a distinct id and non-overlapping months", () => {
    expect(new Set(FESTIVALS.map((festival) => festival.id)).size).toBe(FESTIVALS.length);
    const months = FESTIVALS.flatMap((festival) => Array.from({ length: festival.months }, (_, index) => festival.startMonth + index));
    expect(new Set(months).size).toBe(months.length);
  });

  it("returns null for an unknown id", () => {
    expect(festivalById("nope")).toBeNull();
    expect(festivalById("dashain")).toBeNull();
  });
});

describe("verified main days", () => {
  // Each date is pinned to its Bikram Sambat day through the app's own converter.
  it.each([
    ["dashain-tihar", 2080, "2023-10-15", "2080-6-28", "2023-11-15", "2080-7-29"],
    ["dashain-tihar", 2082, "2025-09-22", "2082-6-6", "2025-10-23", "2082-7-6"],
    ["dashain-tihar", 2083, "2026-10-11", "2083-6-25", "2026-11-11", "2083-7-25"],
    ["dashain-tihar", 2077, "2020-10-17", "2077-7-1", "2020-11-16", "2077-8-1"],
    ["holi", 2080, "2024-03-24", "2080-12-11", "2024-03-24", "2080-12-11"],
    ["holi", 2083, "2027-03-22", "2083-12-8", "2027-03-22", "2083-12-8"],
    ["teej", 2080, "2023-09-18", "2080-6-1", "2023-09-18", "2080-6-1"],
    ["teej", 2083, "2026-09-14", "2083-5-29", "2026-09-14", "2083-5-29"],
  ])("%s %i runs %s (%s) to %s (%s)", (id, year, start, startBs, end, endBs) => {
    const days = festivalMainDays(festivalById(id)!, year)!;

    expect(days).toEqual({ start, end });
    expect(bs(start)).toBe(startBs);
    expect(bs(end)).toBe(endBs);
  });

  it("knows Vijaya Dashami 2083 falls in Kartik, which a one-month Dashain would miss", () => {
    expect(bs("2026-10-20")).toBe("2083-7-3");
    const bounds = festivalBounds(dashainTihar, 2083);
    expect("2026-10-20" >= bounds.start && "2026-10-20" < bounds.endExclusive).toBe(true);
  });
});

describe("festival seasons", () => {
  it("keys a season by festival and Bikram Sambat year, in the stored budget key format", () => {
    expect(festivalPeriodKey(dashainTihar, 2083)).toBe("FEST:dashain-tihar-2083");
    expect(STORAGE_PERIOD_KEY.test(festivalPeriodKey(dashainTihar, 2083))).toBe(true);
    expect(parseFestivalPeriodKey("FEST:dashain-tihar-2083")).toMatchObject({ bsYear: 2083, festival: { id: "dashain-tihar" } });
    expect(parseFestivalPeriodKey("FEST:dashain-2083")).toBeNull();
  });

  it("spans Ashwin 1 to the end of Kartik for Dashain–Tihar 2083, containing Ghatasthapana through Bhai Tika", () => {
    expect(festivalBounds(dashainTihar, 2083)).toEqual({ start: bsToAd({ year: 2083, month: 6, day: 1 }), endExclusive: bsToAd({ year: 2083, month: 8, day: 1 }) });
    expect(festivalBounds(dashainTihar, 2083)).toEqual({ start: "2026-09-17", endExclusive: "2026-11-17" });
  });

  it("contains Dashain 2080, whose Vijaya Dashami fell in Kartik", () => {
    const bounds = festivalBounds(dashainTihar, 2080);

    expect(bs("2023-10-24")).toBe("2080-7-7");
    expect(bounds.start <= "2023-10-15" && "2023-11-15" < bounds.endExclusive).toBe(true);
  });

  it("puts Holi in Falgun–Chaitra, so a Chaitra Holi (2080, 2083) is inside the window", () => {
    expect(festivalBounds(holi, 2080)).toEqual({ start: bsToAd({ year: 2080, month: 11, day: 1 }), endExclusive: bsToAd({ year: 2081, month: 1, day: 1 }) });
    const holi2083 = festivalBounds(holi, 2083);
    expect(holi2083.start <= "2027-03-22" && "2027-03-22" < holi2083.endExclusive).toBe(true);
  });

  it("widens a season when a verified main day spills past its months", () => {
    // Bhai Tika 2077 was Mangsir 1; Teej 2080 was Ashwin 1.
    expect(festivalBounds(dashainTihar, 2077).endExclusive).toBe("2020-11-17");
    expect(festivalBounds(teej, 2080)).toEqual({ start: bsToAd({ year: 2080, month: 5, day: 1 }), endExclusive: "2023-09-19" });
  });

  it("falls back to the month window for a year the table does not know", () => {
    expect(festivalMainDays(dashainTihar, 2090)).toBeNull();
    expect(festivalBounds(dashainTihar, 2089)).toEqual({ start: bsToAd({ year: 2089, month: 6, day: 1 }), endExclusive: bsToAd({ year: 2089, month: 8, day: 1 }) });
  });

  it("resolves a festival key through periodBounds, so a festival budget finds its window", () => {
    expect(periodBounds("FEST:dashain-tihar-2083")).toEqual(festivalBounds(dashainTihar, 2083));
  });

  it("labels a festival with its year", () => {
    expect(festivalLabel(dashainTihar, 2083)).toBe("Dashain–Tihar 2083");
  });

  it("refuses a year outside the supported range", () => {
    expect(() => festivalPeriodKey(dashainTihar, 1999)).toThrow(/supported range/);
    expect(() => festivalBounds(holi, 2090)).toThrow(/supported range/);
  });
});

describe("festivalOn", () => {
  it("identifies the season containing a date", () => {
    expect(festivalOn("2026-10-20")).toMatchObject({ bsYear: 2083, festival: { id: "dashain-tihar" } });
    expect(festivalOn("2027-03-22")).toMatchObject({ bsYear: 2083, festival: { id: "holi" } });
  });

  it("returns null outside every season", () => {
    // Shrawan (month 4) carries no festival in this list.
    expect(festivalOn(bsToAd({ year: 2083, month: 4, day: 10 }))).toBeNull();
  });
});

describe("upcomingFestival", () => {
  it("finds the next season within the window", () => {
    // Shrawan 1, 2083 — Teej (Bhadra) is the next month.
    const result = upcomingFestival(bsToAd({ year: 2083, month: 4, day: 1 }), 60);

    expect(result?.festival.id).toBe("teej");
    expect(result?.bsYear).toBe(2083);
    expect(result!.daysAway).toBeGreaterThan(0);
  });

  it("reports zero days away while a season runs, with the main day still ahead (2026-10-07)", () => {
    const result = upcomingFestival("2026-10-07", 60);

    expect(result).toMatchObject({ festival: { id: "dashain-tihar" }, bsYear: 2083, daysAway: 0, mainDay: "2026-10-11", periodKey: "FEST:dashain-tihar-2083" });
  });

  it("counts the days until a season opens", () => {
    // Bhadra 2084: Teej is running and Dashain–Tihar opens on Ashwin 1 (2027-09-18).
    expect(upcomingFestival("2027-09-08", 30)).toMatchObject({ festival: { id: "teej" }, daysAway: 0 });
    expect(festivalSeasonsFrom("2027-09-08").find((season) => season.festival.id === "dashain-tihar")).toMatchObject({ bsYear: 2084, daysAway: 10 });
  });

  it("returns null when nothing falls inside the window", () => {
    // Poush (month 9) — the next season opens in Falgun, well beyond 10 days.
    expect(upcomingFestival(bsToAd({ year: 2083, month: 9, day: 1 }), 10)).toBeNull();
  });

  it("rolls into the next Bikram Sambat year once Holi is over", () => {
    const result = upcomingFestival(bsToAd({ year: 2084, month: 1, day: 1 }), 200);

    expect(result?.bsYear).toBe(2084);
    expect(result?.festival.id).toBe("teej");
  });

  it("lists every open or coming season in start order", () => {
    const seasons = festivalSeasonsFrom(bsToAd({ year: 2083, month: 12, day: 20 }));

    expect(seasons.map((season) => season.periodKey)).toEqual(["FEST:holi-2083", "FEST:teej-2084", "FEST:dashain-tihar-2084", "FEST:holi-2084"]);
    expect(seasons[0].daysAway).toBe(0);
  });
});

describe("festivalHeadsUp", () => {
  it("prompts for Dashain–Tihar 2083 while its season runs and Ghatasthapana is 4 days away (2026-10-07)", () => {
    expect(festivalHeadsUp("2026-10-07")).toMatchObject({ periodKey: "FEST:dashain-tihar-2083", daysAway: 0, mainDay: "2026-10-11", daysToMainDay: 4 });
  });

  it("counts down to a season that has not opened yet", () => {
    // Teej 2083's main day (2026-09-14) is over; Dashain–Tihar opens on Ashwin 1 (2026-09-17).
    expect(festivalHeadsUp("2026-09-15")).toMatchObject({ periodKey: "FEST:dashain-tihar-2083", daysAway: 2, daysToMainDay: 26 });
  });

  it("keeps prompting through the main days, then lets the season go", () => {
    expect(festivalHeadsUp("2026-10-15")).toMatchObject({ periodKey: "FEST:dashain-tihar-2083", daysToMainDay: null });
    expect(festivalHeadsUp("2026-11-11")?.periodKey).toBe("FEST:dashain-tihar-2083");
    // After Bhai Tika the season still runs to Kartik's end, but there is nothing left to plan; Holi is months away.
    expect(festivalHeadsUp("2026-11-12")).toBeNull();
    expect(festivalHeadsUp("2026-11-12", 120)?.periodKey).toBe("FEST:holi-2083");
  });

  it("stays quiet when the next season is beyond the window", () => {
    expect(festivalHeadsUp("2026-08-01", 10)).toBeNull();
    expect(festivalHeadsUp("2026-08-01", 30)).toMatchObject({ periodKey: "FEST:teej-2083", daysAway: 16 });
  });

  it("keeps a running season without verified main days for its whole window", () => {
    // Teej 2084 is outside the main-day table.
    expect(festivalHeadsUp("2027-09-08")).toMatchObject({ periodKey: "FEST:teej-2084", daysAway: 0, mainDay: null, daysToMainDay: null });
  });
});

describe("year-over-year comparison", () => {
  const expense = (occurredOn: string, amountMinor: number, category = "shopping") => ({ kind: "expense", category, amountMinor, occurredOn });
  // Dashain–Tihar 2082 runs 2025-09-17 to 2025-11-16; 2083 runs 2026-09-17 to 2026-11-16.
  const history = [expense("2025-09-25", 1_200_000), expense("2025-10-08", 3_100_000)];

  it("compares a finished season with the whole of last year's", () => {
    const result = compareFestivalSpending(dashainTihar, 2083, expensesBetween([...history, expense("2026-10-15", 4_820_000)]), "2027-01-01");

    expect(result).toMatchObject({
      periodKey: "FEST:dashain-tihar-2083",
      status: "done",
      spentMinor: 4_820_000,
      previousPeriodKey: "FEST:dashain-tihar-2082",
      previousSpentMinor: 4_300_000,
      previousComparableMinor: 4_300_000,
      changePercentage: 12,
    });
  });

  it("compares a running season with last year up to the same day of the season", () => {
    // 2026-10-07 is day 21 of the season, so last year counts up to 2025-10-07.
    const result = compareFestivalSpending(dashainTihar, 2083, expensesBetween([...history, expense("2026-09-20", 1_000_000), expense("2026-10-07", 500_000), expense("2026-10-08", 99_999)]), "2026-10-07");

    expect(result).toMatchObject({ status: "running", daysElapsed: 21, seasonDays: 61, spentMinor: 1_500_000, previousSpentMinor: 4_300_000, previousComparableMinor: 1_200_000, changePercentage: 25 });
  });

  it("shows an upcoming season as last year's total instead of −100%", () => {
    const result = compareFestivalSpending(dashainTihar, 2083, expensesBetween(history), "2026-09-01");

    expect(result).toMatchObject({ status: "upcoming", spentMinor: 0, daysElapsed: 0, previousSpentMinor: 4_300_000, previousComparableMinor: null, changePercentage: null });
  });

  it("counts Vijaya Dashami 2080 (Kartik 7) in Dashain–Tihar 2080, not in a separate Tihar", () => {
    const result = compareFestivalSpending(dashainTihar, 2080, expensesBetween([expense("2023-10-24", 750_000)]), "2026-10-07");

    expect(result.spentMinor).toBe(750_000);
  });

  it("puts a Chaitra Holi (2083) in this year's Holi season", () => {
    const result = compareFestivalSpending(holi, 2083, expensesBetween([expense("2027-03-22", 300_000), expense("2026-03-02", 200_000)]), "2027-04-20");

    expect(result).toMatchObject({ status: "done", spentMinor: 300_000, previousSpentMinor: 200_000, changePercentage: 50 });
  });

  it("reports a decrease as a negative percentage", () => {
    const result = compareFestivalSpending(dashainTihar, 2083, expensesBetween([expense("2025-10-01", 4_000_000), expense("2026-10-15", 2_000_000)]), "2027-01-01");

    expect(result.changePercentage).toBe(-50);
  });

  it("returns a null change rather than a misleading figure when last year had no spending", () => {
    const result = compareFestivalSpending(dashainTihar, 2083, expensesBetween([expense("2026-10-15", 4_820_000)]), "2027-01-01");

    expect(result.previousSpentMinor).toBe(0);
    expect(result.changePercentage).toBeNull();
  });

  it("has no previous period at the start of the supported range", () => {
    const result = compareFestivalSpending(dashainTihar, 2000, expensesBetween([]), "2026-10-07");

    expect(result.previousPeriodKey).toBeNull();
    expect(result.previousSpentMinor).toBeNull();
    expect(result.changePercentage).toBeNull();
  });

  it("sums only expenses, never income or loan movements", () => {
    const spent = expensesBetween([expense("2026-10-01", 100), { ...expense("2026-10-01", 50), kind: "income" }, expense("2026-10-01", 70, "loan")]);

    expect(spent("2026-10-01", "2026-10-02")).toBe(100);
  });
});
