/**
 * The single source of truth for "what period does this date belong to".
 *
 * Everything here operates on `YYYY-MM-DD` strings and never constructs a Date
 * in the browser's local zone. Period boundaries are anchored to Kathmandu, so
 * a user travelling abroad still files transactions into the same month the
 * server would pick.
 *
 * Period keys are prefixed so a key always carries its own calendar system:
 *   "AD:2026-08"          Gregorian month
 *   "BS:2083-04"          Bikram Sambat month
 *   "FY:2083-84"          Nepali fiscal year (Shrawan -> Ashadh)
 *   "FEST:dashain-2083"   festival envelope
 *
 * Bare "YYYY-MM" is accepted everywhere as a legacy alias for "AD:YYYY-MM" and
 * is what already-stored Budget and AccountReconciliation rows contain.
 */

export type CalendarSystem = "AD" | "BS";
export type PeriodKey = string;

export const APP_TIME_ZONE = "Asia/Kathmandu";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LEGACY_MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const PREFIXED_MONTH_KEY = /^(AD|BS):(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * What may be written to `Budget.monthKey`. Gregorian months keep their bare
 * legacy shape; Bikram Sambat months and festival envelopes carry a prefix.
 *
 * `AccountReconciliation.monthKey` deliberately does NOT use this — a
 * reconciliation is checked against a real bank statement, which is always a
 * Gregorian month, and its `checkedOn` refinement assumes the bare form.
 */
export const STORAGE_PERIOD_KEY = /^(\d{4}-(0[1-9]|1[0-2])|BS:\d{4}-(0[1-9]|1[0-2])|FEST:[a-z0-9]+(?:-[a-z0-9]+)*)$/;

const AD_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export interface PeriodMonth {
  system: CalendarSystem;
  year: number;
  month: number;
}

export interface PeriodBounds {
  /** Inclusive first day, `YYYY-MM-DD`. */
  start: string;
  /** Exclusive last day, `YYYY-MM-DD`. */
  endExclusive: string;
}

const pad2 = (value: number) => String(value).padStart(2, "0");
const pad4 = (value: number) => String(value).padStart(4, "0");

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value);
}

export function toDateOnly(parts: DateParts): string {
  return `${pad4(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function parseDateOnly(value: string): DateParts {
  if (!DATE_ONLY.test(value)) throw new Error("Expected a date in YYYY-MM-DD format.");
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

/** Today's date in Kathmandu, as `YYYY-MM-DD`. */
export function todayInAppZone(now = new Date()): string {
  return dateOnlyInTimeZone(APP_TIME_ZONE, now);
}

export function dateOnlyInTimeZone(timeZone: string, now = new Date()): string {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/* ------------------------------------------------------------------ */
/* Calendar adapters                                                    */
/* ------------------------------------------------------------------ */

export interface MonthCalendar {
  /** Convert a Gregorian `YYYY-MM-DD` into this calendar's parts. */
  fromIso(iso: string): DateParts;
  /** Convert this calendar's parts back into a Gregorian `YYYY-MM-DD`. */
  toIso(parts: DateParts): string;
  daysInMonth(year: number, month: number): number;
  monthName(month: number): string;
  minYear: number;
  maxYear: number;
}

function adDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const gregorian: MonthCalendar = {
  fromIso: parseDateOnly,
  toIso: toDateOnly,
  daysInMonth: adDaysInMonth,
  monthName: (month) => AD_MONTH_NAMES[month - 1] ?? "",
  minYear: 1900,
  maxYear: 2999,
};

/**
 * Placeholder so an unregistered calendar fails loudly instead of silently
 * returning Gregorian results, which would corrupt dates without any error.
 */
function unregistered(system: CalendarSystem): MonthCalendar {
  const fail = (): never => {
    throw new Error(`The ${system} calendar has not been registered. Import "./nepali-date" first.`);
  };
  return { fromIso: fail, toIso: fail, daysInMonth: fail, monthName: fail, minYear: 0, maxYear: 0 };
}

const calendars: Record<CalendarSystem, MonthCalendar> = {
  AD: gregorian,
  BS: unregistered("BS"),
};

/**
 * Registers a calendar implementation. `nepali-date.ts` calls this for "BS" so
 * that this module stays free of any calendar-specific lookup tables.
 */
export function registerCalendar(system: CalendarSystem, calendar: MonthCalendar): void {
  calendars[system] = calendar;
}

export function calendarFor(system: CalendarSystem): MonthCalendar {
  return calendars[system];
}

/* ------------------------------------------------------------------ */
/* Month period keys                                                    */
/* ------------------------------------------------------------------ */

export function parseMonthKey(key: PeriodKey): PeriodMonth {
  const prefixed = PREFIXED_MONTH_KEY.exec(key);
  if (prefixed) {
    return { system: prefixed[1] as CalendarSystem, year: Number(prefixed[2]), month: Number(prefixed[3]) };
  }
  const legacy = LEGACY_MONTH_KEY.exec(key);
  if (legacy) return { system: "AD", year: Number(legacy[1]), month: Number(legacy[2]) };
  throw new Error(`Invalid period key: ${key}`);
}

export function isMonthKey(key: string): boolean {
  return PREFIXED_MONTH_KEY.test(key) || LEGACY_MONTH_KEY.test(key);
}

export function formatMonthKey(period: PeriodMonth): PeriodKey {
  return `${period.system}:${pad4(period.year)}-${pad2(period.month)}`;
}

/** The month key a given date falls in, in the requested calendar system. */
export function monthKeyOf(date: string | Date, system: CalendarSystem = "AD"): PeriodKey {
  const iso = typeof date === "string" ? date : todayInAppZone(date);
  const parts = calendars[system].fromIso(iso);
  return formatMonthKey({ system, year: parts.year, month: parts.month });
}

/**
 * The form written to `Budget.monthKey`. Gregorian months keep their bare
 * `YYYY-MM` shape so existing rows and exported backups stay byte-identical;
 * every other calendar system keeps its prefix.
 */
export function toStorageKey(key: PeriodKey): string {
  const period = parseMonthKey(key);
  return period.system === "AD" ? `${pad4(period.year)}-${pad2(period.month)}` : formatMonthKey(period);
}

export function fromStorageKey(stored: string): PeriodKey {
  return formatMonthKey(parseMonthKey(stored));
}

/** True when two keys refer to the same period, ignoring legacy/prefixed form. */
export function isSameMonthKey(a: PeriodKey, b: PeriodKey): boolean {
  if (a === b) return true;
  if (!isMonthKey(a) || !isMonthKey(b)) return false;
  return formatMonthKey(parseMonthKey(a)) === formatMonthKey(parseMonthKey(b));
}

export function monthBounds(key: PeriodKey): PeriodBounds {
  const { system, year, month } = parseMonthKey(key);
  const calendar = calendars[system];
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: calendar.toIso({ year, month, day: 1 }),
    endExclusive: calendar.toIso({ year: nextYear, month: nextMonth, day: 1 }),
  };
}

export function daysInPeriod(key: PeriodKey): number {
  const { system, year, month } = parseMonthKey(key);
  return calendars[system].daysInMonth(year, month);
}

export function monthLabel(key: PeriodKey): string {
  const { system, year, month } = parseMonthKey(key);
  return `${calendars[system].monthName(month)} ${year}`;
}

export function addMonthsToKey(key: PeriodKey, delta: number): PeriodKey {
  const { system, year, month } = parseMonthKey(key);
  const zeroBased = year * 12 + (month - 1) + Math.trunc(delta);
  const nextYear = Math.floor(zeroBased / 12);
  const nextMonth = ((zeroBased % 12) + 12) % 12 + 1;
  const calendar = calendars[system];
  if (nextYear < calendar.minYear || nextYear > calendar.maxYear) {
    throw new Error(`${system} ${nextYear} is outside the supported range.`);
  }
  return formatMonthKey({ system, year: nextYear, month: nextMonth });
}

/** Whether a `YYYY-MM-DD` date falls inside the period. */
export function isInPeriod(dateString: string, key: PeriodKey): boolean {
  if (!DATE_ONLY.test(dateString)) return false;
  const { start, endExclusive } = periodBounds(key);
  return dateString >= start && dateString < endExclusive;
}

/** The current month key in Kathmandu. */
export function currentMonthKey(system: CalendarSystem = "AD", now = new Date()): PeriodKey {
  return monthKeyOf(todayInAppZone(now), system);
}

/* ------------------------------------------------------------------ */
/* Generic period bounds (months today, fiscal years and festivals later) */
/* ------------------------------------------------------------------ */

type BoundsResolver = (key: PeriodKey) => PeriodBounds;

const resolvers: BoundsResolver[] = [];

/**
 * Lets other modules (fiscal years, festivals) teach this module about their
 * own key prefixes without period.ts needing to know about them.
 */
export function registerPeriodResolver(resolver: BoundsResolver): void {
  resolvers.push(resolver);
}

export function periodBounds(key: PeriodKey): PeriodBounds {
  if (isMonthKey(key)) return monthBounds(key);
  for (const resolver of resolvers) {
    try {
      return resolver(key);
    } catch {
      continue;
    }
  }
  throw new Error(`Invalid period key: ${key}`);
}

/* ------------------------------------------------------------------ */
/* Day arithmetic on `YYYY-MM-DD` strings (UTC, never the local zone)  */
/* ------------------------------------------------------------------ */

const isoAtUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** `iso` moved by `days` calendar days. */
export function addDaysToIso(iso: string, days: number): string {
  return new Date(isoAtUtc(iso) + Math.trunc(days) * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetweenIso(from: string, to: string): number {
  return Math.round((isoAtUtc(to) - isoAtUtc(from)) / 86_400_000);
}

/** Inclusive last day of a period, `YYYY-MM-DD`. */
export function lastDayOf(bounds: PeriodBounds): string {
  return addDaysToIso(bounds.endExclusive, -1);
}

/**
 * The same stretch of time as a month key in another calendar. The current
 * month maps to the current month; any other month maps to the month holding
 * its middle day, which is where most of its days fall.
 */
export function convertMonthKey(key: PeriodKey, system: CalendarSystem, now = new Date()): PeriodKey {
  const from = parseMonthKey(key);
  if (from.system === system) return formatMonthKey(from);
  if (isSameMonthKey(key, currentMonthKey(from.system, now))) return currentMonthKey(system, now);
  const { start } = monthBounds(key);
  return monthKeyOf(addDaysToIso(start, Math.floor(daysInPeriod(key) / 2)), system);
}
