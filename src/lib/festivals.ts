/**
 * Festival spending seasons.
 *
 * Dashain, Tihar, Teej and Holi follow the lunar calendar, so they drift
 * across Bikram Sambat months: Ghatasthapana 2083 is Ashwin 25 (2026-10-11)
 * but Vijaya Dashami is Kartik 3 (2026-10-20), and Holi lands in Falgun some
 * years and Chaitra in others. "Dashain = Ashwin" therefore split one festival
 * across two cards.
 *
 * A festival here is a SEASON of whole BS months that always contains it —
 * Dashain–Tihar is Ashwin + Kartik, Holi is Falgun + Chaitra — which also
 * matches how the spending builds up. A small table of verified main days
 * widens a season in the rare year a festival spills past it (Bhai Tika 2077
 * fell on Mangsir 1, Teej 2080 on Ashwin 1) and lets the app say when the main
 * days begin. Years outside the table simply use the month window.
 *
 * A season's period key is `FEST:<id>-<bsYear>` (e.g. `FEST:dashain-tihar-2083`)
 * and is registered with period.ts, so a festival budget resolves its bounds
 * through `periodBounds` like any other period.
 */

import { addDays, format, parseISO } from "date-fns";
import { isLoanCategory } from "./categories";
import { adToBs, bsMonthName, bsToAd, BS_MAX_YEAR, BS_MIN_YEAR } from "./nepali-date";
import { registerPeriodResolver, type PeriodBounds, type PeriodKey } from "./period";

export interface Festival {
  id: string;
  name: string;
  /** First Bikram Sambat month of the season, 1-12. */
  startMonth: number;
  /** How many BS months the season spans. */
  months: number;
  /** What the first main day is called, e.g. "Ghatasthapana". */
  mainDayName: string;
  description: string;
}

export const FESTIVALS: readonly Festival[] = [
  { id: "teej", name: "Teej", startMonth: 5, months: 1, mainDayName: "Teej", description: "Bhadra — fasting, gatherings and gifts." },
  { id: "dashain-tihar", name: "Dashain–Tihar", startMonth: 6, months: 2, mainDayName: "Ghatasthapana", description: "Ashwin and Kartik — the biggest spending season of the year." },
  { id: "holi", name: "Holi", startMonth: 11, months: 2, mainDayName: "Holi", description: "Falgun and Chaitra — colours and celebrations." },
] as const;

/**
 * First and last main day (Gregorian) by BS year: Haritalika Teej; Ghatasthapana
 * to Bhai Tika; hill Holi (Fagu Purnima). Each date's BS conversion is pinned in
 * festivals.test.ts against the app's own converter.
 */
const MAIN_DAYS: Readonly<Record<string, Readonly<Record<number, readonly [string, string]>>>> = {
  teej: {
    2077: ["2020-08-21", "2020-08-21"], 2078: ["2021-09-09", "2021-09-09"], 2079: ["2022-08-30", "2022-08-30"], 2080: ["2023-09-18", "2023-09-18"],
    2081: ["2024-09-06", "2024-09-06"], 2082: ["2025-08-26", "2025-08-26"], 2083: ["2026-09-14", "2026-09-14"],
  },
  "dashain-tihar": {
    2077: ["2020-10-17", "2020-11-16"], 2078: ["2021-10-07", "2021-11-06"], 2079: ["2022-09-26", "2022-10-27"], 2080: ["2023-10-15", "2023-11-15"],
    2081: ["2024-10-03", "2024-11-03"], 2082: ["2025-09-22", "2025-10-23"], 2083: ["2026-10-11", "2026-11-11"],
  },
  holi: {
    2077: ["2021-03-28", "2021-03-28"], 2078: ["2022-03-17", "2022-03-17"], 2079: ["2023-03-06", "2023-03-06"], 2080: ["2024-03-24", "2024-03-24"],
    2081: ["2025-03-13", "2025-03-13"], 2082: ["2026-03-02", "2026-03-02"], 2083: ["2027-03-21", "2027-03-21"],
  },
};

export function festivalById(id: string): Festival | null {
  return FESTIVALS.find((festival) => festival.id === id) ?? null;
}

function assertSupportedYear(bsYear: number): void {
  if (!Number.isInteger(bsYear) || bsYear < BS_MIN_YEAR || bsYear > BS_MAX_YEAR) {
    throw new Error(`Bikram Sambat ${bsYear} is outside the supported range.`);
  }
}

/** The period key of a festival season in a given Bikram Sambat year. */
export function festivalPeriodKey(festival: Festival, bsYear: number): PeriodKey {
  assertSupportedYear(bsYear);
  return `FEST:${festival.id}-${bsYear}`;
}

const FESTIVAL_KEY = /^FEST:([a-z]+(?:-[a-z]+)*)-(\d{4})$/;

/** A known season in a year the calendar can resolve; anything else (`FEST:holi-2090`, `FEST:teej-1999`) is null. */
export function parseFestivalPeriodKey(key: PeriodKey): { festival: Festival; bsYear: number } | null {
  const match = FESTIVAL_KEY.exec(key);
  const festival = match ? festivalById(match[1]) : null;
  if (!festival || !match) return null;
  const bsYear = Number(match[2]);
  try { festivalBounds(festival, bsYear); } catch { return null; }
  return { festival, bsYear };
}

/** The verified first and last main day, when the table knows this year. */
export function festivalMainDays(festival: Festival, bsYear: number): { start: string; end: string } | null {
  const days = MAIN_DAYS[festival.id]?.[bsYear];
  return days ? { start: days[0], end: days[1] } : null;
}

const nextDay = (iso: string) => format(addDays(parseISO(iso), 1), "yyyy-MM-dd");

/** The season window: its BS months, widened to contain the verified main days. */
export function festivalBounds(festival: Festival, bsYear: number): PeriodBounds {
  assertSupportedYear(bsYear);
  const last = festival.startMonth + festival.months;
  const endYear = bsYear + Math.floor((last - 1) / 12);
  const endMonth = ((last - 1) % 12) + 1;
  if (endYear > BS_MAX_YEAR) throw new Error(`Bikram Sambat ${endYear} is outside the supported range.`);
  let start = bsToAd({ year: bsYear, month: festival.startMonth, day: 1 });
  let endExclusive = bsToAd({ year: endYear, month: endMonth, day: 1 });
  const main = festivalMainDays(festival, bsYear);
  if (main && main.start < start) start = main.start;
  if (main && main.end >= endExclusive) endExclusive = nextDay(main.end);
  return { start, endExclusive };
}

export function festivalLabel(festival: Festival, bsYear: number): string {
  return `${festival.name} ${bsYear}`;
}

/** "Ashwin–Kartik", "Bhadra". */
export function festivalMonthLabel(festival: Festival): string {
  const months = Array.from({ length: festival.months }, (_, index) => bsMonthName(((festival.startMonth + index - 1) % 12) + 1));
  return months.length > 1 ? `${months[0]}–${months[months.length - 1]}` : months[0];
}

/** The festival season containing this Gregorian date, if any. */
export function festivalOn(iso: string): { festival: Festival; bsYear: number } | null {
  const bs = adToBs(iso);
  for (const bsYear of [bs.year, bs.year - 1]) {
    if (bsYear < BS_MIN_YEAR) continue;
    for (const festival of FESTIVALS) {
      try {
        const bounds = festivalBounds(festival, bsYear);
        if (iso >= bounds.start && iso < bounds.endExclusive) return { festival, bsYear };
      } catch { continue; }
    }
  }
  return null;
}

export interface UpcomingFestival {
  festival: Festival;
  bsYear: number;
  periodKey: PeriodKey;
  bounds: PeriodBounds;
  /** The first main day when known, e.g. Ghatasthapana. */
  mainDay: string | null;
  /** Days from `today` until the season opens; 0 while it is running. */
  daysAway: number;
}

/** Every season still open on `today` or yet to come in this and the next BS year, earliest first. */
export function festivalSeasonsFrom(today: string): UpcomingFestival[] {
  const bs = adToBs(today);
  const seasons: UpcomingFestival[] = [];
  for (const bsYear of [bs.year - 1, bs.year, bs.year + 1]) {
    if (bsYear < BS_MIN_YEAR || bsYear > BS_MAX_YEAR) continue;
    for (const festival of FESTIVALS) {
      let bounds: PeriodBounds;
      try { bounds = festivalBounds(festival, bsYear); } catch { continue; }
      if (bounds.endExclusive <= today) continue;
      seasons.push({ festival, bsYear, periodKey: festivalPeriodKey(festival, bsYear), bounds, mainDay: festivalMainDays(festival, bsYear)?.start ?? null, daysAway: bounds.start <= today ? 0 : dayGap(today, bounds.start) });
    }
  }
  return seasons.sort((a, b) => a.bounds.start.localeCompare(b.bounds.start));
}

/**
 * The season running today, or the next one starting within `withinDays`.
 * Used to prompt planning before the spending starts rather than after.
 */
export function upcomingFestival(today: string, withinDays = 60): UpcomingFestival | null {
  return festivalSeasonsFrom(today).find((season) => season.daysAway <= withinDays) ?? null;
}

export interface FestivalHeadsUp extends UpcomingFestival {
  /** Days from `today` to the first main day (e.g. Ghatasthapana) while it is still ahead; null when unknown or already here. */
  daysToMainDay: number | null;
}

/**
 * The season worth a dashboard heads-up on `today`: one opening within
 * `withinDays`, or one already running whose main days are not over yet. A
 * season whose main days have passed has nothing left to plan, so the next
 * one is considered instead.
 */
export function festivalHeadsUp(today: string, withinDays = 30): FestivalHeadsUp | null {
  for (const season of festivalSeasonsFrom(today)) {
    if (season.daysAway > withinDays) return null;
    const main = festivalMainDays(season.festival, season.bsYear);
    if (season.daysAway === 0 && main && main.end < today) continue;
    return { ...season, daysToMainDay: main && main.start > today ? dayGap(today, main.start) : null };
  }
  return null;
}

export type FestivalStatus = "upcoming" | "running" | "done";

export interface FestivalComparison {
  festival: Festival;
  bsYear: number;
  periodKey: PeriodKey;
  bounds: PeriodBounds;
  status: FestivalStatus;
  /** Spending so far while running, the whole season once done, 0 while upcoming. */
  spentMinor: number;
  /** Day of the season `today` is (1-based); 0 while upcoming, the full length once done. */
  daysElapsed: number;
  seasonDays: number;
  previousBsYear: number;
  previousPeriodKey: PeriodKey | null;
  /** Last year's whole season. */
  previousSpentMinor: number | null;
  /** Last year up to the same day of its season — what `spentMinor` is compared with. */
  previousComparableMinor: number | null;
  /** Null while upcoming or without last year's spending, never a misleading −100%. */
  changePercentage: number | null;
}

/**
 * This year's season against the same season last year. An upcoming season is
 * not compared at all (it has not started, so "down 100%" would be noise); a
 * running one is compared with last year up to the same day of the season.
 * `spentBetween` sums spending for `start <= date < endExclusive`.
 */
export function compareFestivalSpending(
  festival: Festival,
  bsYear: number,
  spentBetween: (start: string, endExclusive: string) => number,
  today: string,
): FestivalComparison {
  const periodKey = festivalPeriodKey(festival, bsYear);
  const bounds = festivalBounds(festival, bsYear);
  const seasonDays = dayGap(bounds.start, bounds.endExclusive);
  const status: FestivalStatus = today < bounds.start ? "upcoming" : today >= bounds.endExclusive ? "done" : "running";
  const daysElapsed = status === "upcoming" ? 0 : status === "done" ? seasonDays : dayGap(bounds.start, today) + 1;
  const spentMinor = status === "upcoming" ? 0 : spentBetween(bounds.start, status === "done" ? bounds.endExclusive : nextDay(today));

  const previousBsYear = bsYear - 1;
  let previousPeriodKey: PeriodKey | null = null;
  let previousSpentMinor: number | null = null;
  let previousComparableMinor: number | null = null;
  if (previousBsYear >= BS_MIN_YEAR) {
    const previous = festivalBounds(festival, previousBsYear);
    previousPeriodKey = festivalPeriodKey(festival, previousBsYear);
    previousSpentMinor = spentBetween(previous.start, previous.endExclusive);
    if (status === "done") previousComparableMinor = previousSpentMinor;
    else if (status === "running") {
      const cutoff = format(addDays(parseISO(previous.start), daysElapsed), "yyyy-MM-dd");
      previousComparableMinor = spentBetween(previous.start, cutoff < previous.endExclusive ? cutoff : previous.endExclusive);
    }
  }

  return {
    festival,
    bsYear,
    periodKey,
    bounds,
    status,
    spentMinor,
    daysElapsed,
    seasonDays,
    previousBsYear,
    previousPeriodKey,
    previousSpentMinor,
    previousComparableMinor,
    changePercentage: status !== "upcoming" && previousComparableMinor && previousComparableMinor > 0
      ? Math.round(((spentMinor - previousComparableMinor) / previousComparableMinor) * 100)
      : null,
  };
}

/** A `spentBetween` over logged expenses, for `compareFestivalSpending`. Loan movements are not spending. */
export function expensesBetween(transactions: readonly { kind: string; category: string; amountMinor: number; occurredOn: string }[]) {
  return (start: string, endExclusive: string) => transactions.reduce((total, item) =>
    item.kind === "expense" && !isLoanCategory(item.category) && item.occurredOn >= start && item.occurredOn < endExclusive ? total + item.amountMinor : total, 0);
}

function dayGap(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

registerPeriodResolver((key) => {
  const parsed = parseFestivalPeriodKey(key);
  if (!parsed) throw new Error("Not a festival key.");
  return festivalBounds(parsed.festival, parsed.bsYear);
});
