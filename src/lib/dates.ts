import { format, parseISO } from "date-fns";
import { formatMonthKey, isInPeriod, todayInAppZone, toStorageKey, type CalendarSystem, type PeriodKey } from "./period";
// Importing for the side effect registers the Bikram Sambat calendar with the
// period layer, so a BS period key resolves anywhere in the app.
import { adToBs, formatBs } from "./nepali-date";

/**
 * A selected month is represented in the UI as a `Date` marker. Only its
 * calendar fields matter — they carry the user's explicit choice, so they are
 * read directly rather than being re-interpreted in another time zone.
 */
export function monthKeyFor(month: Date): PeriodKey {
  return formatMonthKey({ system: "AD", year: month.getFullYear(), month: month.getMonth() + 1 });
}

/** The stored `Budget.monthKey` form (`YYYY-MM`) for a selected month. */
export function monthKey(date: Date): string {
  return toStorageKey(monthKeyFor(date));
}

export function isInMonth(dateString: string, month: Date): boolean {
  return isInPeriod(dateString, monthKeyFor(month));
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
