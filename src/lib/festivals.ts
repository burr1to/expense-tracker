/**
 * Festival spending periods.
 *
 * The exact day of Dashain or Tihar is lunar and almanac-determined, so it
 * cannot be computed and a hardcoded date table would go stale silently. It is
 * also not what a budget actually needs: festival spending builds over the
 * whole month around the festival, not on one day.
 *
 * So a festival period here is the Bikram Sambat month it falls in — Dashain is
 * Ashwin, Tihar is Kartik — which is exact, needs no extra data, and reuses the
 * BS month machinery for bounds, budgets and comparison. "Dashain 2083" is
 * simply the period key `BS:2083-06`.
 */

import { bsMonthName, BS_MAX_YEAR, BS_MIN_YEAR } from "./nepali-date";
import { adToBs } from "./nepali-date";
import { formatMonthKey, monthBounds, type PeriodBounds, type PeriodKey } from "./period";

export interface Festival {
  id: string;
  name: string;
  /** Bikram Sambat month the festival falls in, 1-12. */
  bsMonth: number;
  description: string;
}

export const FESTIVALS: readonly Festival[] = [
  { id: "teej", name: "Teej", bsMonth: 5, description: "Bhadra — fasting, gatherings and gifts." },
  { id: "dashain", name: "Dashain", bsMonth: 6, description: "Ashwin — the largest spending month of the year." },
  { id: "tihar", name: "Tihar", bsMonth: 7, description: "Kartik — lights, sweets and Bhai Tika gifts." },
  { id: "holi", name: "Holi", bsMonth: 11, description: "Falgun — colours and celebrations." },
] as const;

export function festivalById(id: string): Festival | null {
  return FESTIVALS.find((festival) => festival.id === id) ?? null;
}

/** The period key covering a festival in a given Bikram Sambat year. */
export function festivalPeriodKey(festival: Festival, bsYear: number): PeriodKey {
  if (bsYear < BS_MIN_YEAR || bsYear > BS_MAX_YEAR) {
    throw new Error(`Bikram Sambat ${bsYear} is outside the supported range.`);
  }
  return formatMonthKey({ system: "BS", year: bsYear, month: festival.bsMonth });
}

export function festivalBounds(festival: Festival, bsYear: number): PeriodBounds {
  return monthBounds(festivalPeriodKey(festival, bsYear));
}

export function festivalLabel(festival: Festival, bsYear: number): string {
  return `${festival.name} ${bsYear}`;
}

export function festivalMonthLabel(festival: Festival): string {
  return bsMonthName(festival.bsMonth);
}

/** The festival whose month contains this Gregorian date, if any. */
export function festivalOn(iso: string): { festival: Festival; bsYear: number } | null {
  const bs = adToBs(iso);
  const festival = FESTIVALS.find((item) => item.bsMonth === bs.month);
  return festival ? { festival, bsYear: bs.year } : null;
}

export interface UpcomingFestival {
  festival: Festival;
  bsYear: number;
  bounds: PeriodBounds;
  /** Days from `today` until the festival month opens; 0 while it is running. */
  daysAway: number;
}

/**
 * The next festival starting within `withinDays`, or the one currently running.
 * Used to prompt planning before the spending starts rather than after.
 */
export function upcomingFestival(today: string, withinDays = 60): UpcomingFestival | null {
  const bs = adToBs(today);
  const candidates: UpcomingFestival[] = [];

  for (const bsYear of [bs.year, bs.year + 1]) {
    if (bsYear > BS_MAX_YEAR) continue;
    for (const festival of FESTIVALS) {
      const bounds = festivalBounds(festival, bsYear);
      if (bounds.endExclusive <= today) continue;
      const daysAway = bounds.start <= today ? 0 : dayGap(today, bounds.start);
      candidates.push({ festival, bsYear, bounds, daysAway });
    }
  }

  return candidates
    .filter((candidate) => candidate.daysAway <= withinDays)
    .sort((a, b) => a.bounds.start.localeCompare(b.bounds.start))[0] ?? null;
}

export interface FestivalComparison {
  festival: Festival;
  bsYear: number;
  periodKey: PeriodKey;
  spentMinor: number;
  previousBsYear: number;
  previousPeriodKey: PeriodKey | null;
  previousSpentMinor: number | null;
  changePercentage: number | null;
}

/**
 * This year's festival spending against the same festival last year. Returns a
 * null comparison rather than a misleading zero when there is no prior year in
 * range, so the UI can say "no history yet" instead of "down 100%".
 */
export function compareFestivalSpending(
  festival: Festival,
  bsYear: number,
  spentFor: (periodKey: PeriodKey) => number,
): FestivalComparison {
  const periodKey = festivalPeriodKey(festival, bsYear);
  const spentMinor = spentFor(periodKey);
  const previousBsYear = bsYear - 1;
  const hasPrevious = previousBsYear >= BS_MIN_YEAR;
  const previousPeriodKey = hasPrevious ? festivalPeriodKey(festival, previousBsYear) : null;
  const previousSpentMinor = previousPeriodKey ? spentFor(previousPeriodKey) : null;

  return {
    festival,
    bsYear,
    periodKey,
    spentMinor,
    previousBsYear,
    previousPeriodKey,
    previousSpentMinor,
    changePercentage: previousSpentMinor && previousSpentMinor > 0
      ? Math.round(((spentMinor - previousSpentMinor) / previousSpentMinor) * 100)
      : null,
  };
}

function dayGap(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
