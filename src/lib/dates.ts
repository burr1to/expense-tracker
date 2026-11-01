import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { daysInPeriod, formatMonthKey, isInPeriod, lastDayOf, monthBounds, monthLabel, parseMonthKey, todayInAppZone, toStorageKey, type CalendarSystem, type PeriodKey } from "./period";
// Importing for the side effect registers the Bikram Sambat calendar with the
// period layer, so a BS period key resolves anywhere in the app.
import { adToBs, formatBs, formatBsMonthSpan } from "./nepali-date";

/**
 * A selected month is represented in the UI as a `Date` marker. Only its
 * calendar fields matter — they carry the user's explicit choice, so they are
 * read directly rather than being re-interpreted in another time zone.
 */
export function monthKeyFor(month: Date): PeriodKey {
  return formatMonthKey({ system: "AD", year: month.getFullYear(), month: month.getMonth() + 1 });
}

/**
 * A month as the views hold it: a period key (`AD:2026-09`, `BS:2083-06`), or
 * a legacy Gregorian `Date` marker, which is read as its AD month.
 */
export type MonthRef = PeriodKey | Date;

export function periodKeyFor(month: MonthRef): PeriodKey {
  return typeof month === "string" ? month : monthKeyFor(month);
}

export interface PeriodRange {
  /** Inclusive first day, `YYYY-MM-DD`. */
  start: string;
  /** Inclusive last day, `YYYY-MM-DD`. */
  end: string;
  endExclusive: string;
  days: number;
}

/** First and last day of a month in its own calendar: Ashwin's days for `BS:2083-06`. */
export function periodRange(month: MonthRef): PeriodRange {
  const key = periodKeyFor(month);
  const bounds = monthBounds(key);
  return { start: bounds.start, end: lastDayOf(bounds), endExclusive: bounds.endExclusive, days: daysInPeriod(key) };
}

/** The stored `Budget.monthKey` form: bare `YYYY-MM` for AD, `BS:YYYY-MM` for Bikram Sambat. */
export function monthKey(month: MonthRef): string {
  return toStorageKey(periodKeyFor(month));
}

export function isInMonth(dateString: string, month: MonthRef): boolean {
  return isInPeriod(dateString, periodKeyFor(month));
}

export function formatTransactionDate(dateString: string): string {
  return format(parseISO(dateString), "MMM d, yyyy");
}

export function toDateInput(date = new Date()): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Today as `YYYY-MM-DD` in Kathmandu. Every "is this due yet" and "what is
 * today's date" check must use this: the server validates against Kathmandu
 * (see `dateOnlyInTimeZone` in the ledger route), so a client using its own
 * local date can offer actions the server will reject.
 */
export function todayInput(now = new Date()): string {
  return todayInAppZone(now);
}

/** A month marker for the current month in Kathmandu. */
export function currentMonthMarker(now = new Date()): Date {
  const [year, month, day] = todayInAppZone(now).split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * A transaction date in the user's chosen calendar. Bikram Sambat is shown
 * alongside the Gregorian date rather than replacing it, because receipts,
 * bank statements and card records are all Gregorian — a user reconciling
 * against them needs both.
 *
 * Falls back to the Gregorian date alone outside the supported BS range
 * instead of throwing in the middle of a list render.
 */
export function formatLedgerDate(dateString: string, system: CalendarSystem = "AD"): string {
  const gregorian = formatTransactionDate(dateString);
  if (system !== "BS") return gregorian;
  try {
    return `${formatBs(adToBs(dateString), "short")} · ${gregorian}`;
  } catch {
    return gregorian;
  }
}

/**
 * Month heading. A BS period is named as itself ("Ashwin 2083"); a Gregorian
 * month shown in BS mode leads with the Nepali months it covers.
 */
export function formatLedgerMonth(month: MonthRef, system: CalendarSystem = "AD"): string {
  if (typeof month === "string") {
    const label = monthLabel(month);
    if (system !== "BS" || parseMonthKey(month).system === "BS") return label;
    const { start, end } = periodRange(month);
    return formatBsMonthSpan(start, end) ?? label;
  }
  const gregorian = format(month, "MMMM yyyy");
  if (system !== "BS") return gregorian;
  return formatBsMonthSpan(toDateInput(startOfMonth(month)), toDateInput(endOfMonth(month))) ?? gregorian;
}

/** "Sep 17 – Oct 17, 2026": the Gregorian days a period covers, for a BS month's subtitle. */
export function formatGregorianSpan(month: MonthRef): string {
  const { start, end } = periodRange(month);
  const [first, last] = [parseISO(start), parseISO(end)];
  return `${format(first, first.getFullYear() === last.getFullYear() ? "MMM d" : "MMM d, yyyy")} – ${format(last, "MMM d, yyyy")}`;
}

/** A local-midnight `Date` for a `YYYY-MM-DD`, for date pickers and date-fns. */
export function localDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Day heading. Weekday is shared by both calendars; BS still keeps a short AD date. */
export function formatLedgerDay(value: string | Date, system: CalendarSystem = "AD", style: "weekday" | "date" = "weekday"): string {
  const iso = typeof value === "string" ? value : toDateInput(value);
  const [year, month, day] = iso.split("-").map(Number);
  const local = new Date(year, month - 1, day);
  const gregorian = format(local, style === "weekday" ? "EEEE, MMMM d" : "MMMM d, yyyy");
  if (system !== "BS") return gregorian;
  try {
    const bs = formatBs(adToBs(iso), "long");
    return style === "weekday" ? `${format(local, "EEEE")}, ${bs} · ${format(local, "MMM d")}` : `${bs} · ${format(local, "MMM d")}`;
  } catch {
    return gregorian;
  }
}
