/**
 * Bikram Sambat calendar support.
 *
 * BS month lengths are not algorithmic — they vary between 29 and 32 days and
 * are fixed by astronomical almanac, so conversion needs a vetted lookup table.
 * That table is deliberately NOT hand-maintained here: an incorrect row would
 * silently shift every date in that year with no error to notice. Conversion is
 * delegated to `nepali-date-converter` (MIT), and `nepali-date.test.ts` pins the
 * result against known Nepali New Year dates so a bad dependency upgrade fails
 * the build rather than corrupting dates quietly.
 *
 * Importing this module registers the BS calendar with `period.ts`. Until it is
 * imported, any BS period key throws rather than silently returning Gregorian
 * results.
 */

import NepaliDate from "nepali-date-converter";
import { parseDateOnly, registerCalendar, toDateOnly, type DateParts, type MonthCalendar } from "./period";

export const BS_MONTH_NAMES = [
  "Baishakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin",
  "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
] as const;

/** Shrawan. The Nepali fiscal year runs Shrawan 1 to the end of Ashadh. */
export const BS_FISCAL_START_MONTH = 4;

export const BS_MIN_YEAR = 2000;
export const BS_MAX_YEAR = 2090;

export function bsMonthName(month: number): string {
  return BS_MONTH_NAMES[month - 1] ?? "";
}

function assertSupportedBsYear(year: number): void {
  if (year < BS_MIN_YEAR || year > BS_MAX_YEAR) {
    throw new Error(`Bikram Sambat ${year} is outside the supported range (${BS_MIN_YEAR}-${BS_MAX_YEAR}).`);
  }
}

/**
 * Gregorian dates are carried through a local-midnight `Date` purely as a
 * value, never as "now", so no time zone can shift the calendar day.
 */
export function adToBs(iso: string): DateParts {
  const { year, month, day } = parseDateOnly(iso);
  const converted = new NepaliDate(new Date(year, month - 1, day));
  const bsYear = converted.getYear();
  assertSupportedBsYear(bsYear);
  return { year: bsYear, month: converted.getMonth() + 1, day: converted.getDate() };
}

export function bsToAd(parts: DateParts): string {
  assertSupportedBsYear(parts.year);
  if (parts.month < 1 || parts.month > 12) throw new Error(`Invalid Bikram Sambat month: ${parts.month}`);
  const converted = new NepaliDate(parts.year, parts.month - 1, parts.day).toJsDate();
  return toDateOnly({ year: converted.getFullYear(), month: converted.getMonth() + 1, day: converted.getDate() });
}

/**
 * Derived from the distance between the first of this month and the first of
 * the next, so it stays correct without a second table to keep in step.
 */
export function bsDaysInMonth(year: number, month: number): number {
  assertSupportedBsYear(year);
  const start = bsToAd({ year, month, day: 1 });
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  if (nextYear > BS_MAX_YEAR) throw new Error(`Bikram Sambat ${nextYear} is outside the supported range.`);
  const next = bsToAd({ year: nextYear, month: nextMonth, day: 1 });
  return Math.round((Date.parse(`${next}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

export function isSupportedAdDate(iso: string): boolean {
  try {
    adToBs(iso);
    return true;
  } catch {
    return false;
  }
}

export function formatBs(parts: DateParts, style: "long" | "short" | "numeric" = "long"): string {
  if (style === "numeric") return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const name = style === "short" ? bsMonthName(parts.month).slice(0, 3) : bsMonthName(parts.month);
  return `${name} ${parts.day}, ${parts.year}`;
}

const bikramSambat: MonthCalendar = {
  fromIso: adToBs,
  toIso: bsToAd,
  daysInMonth: bsDaysInMonth,
  monthName: bsMonthName,
  minYear: BS_MIN_YEAR,
  maxYear: BS_MAX_YEAR,
};

registerCalendar("BS", bikramSambat);
