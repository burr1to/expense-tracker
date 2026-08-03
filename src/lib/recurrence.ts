import type { RecurrenceUnit, RecurringEntry } from "../types";

export interface RecurrenceSchedule {
  recurrenceUnit: RecurrenceUnit;
  recurrenceInterval: number;
  anchorDate: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parts(value: string) {
  if (!DATE_ONLY.test(value)) throw new Error("Expected a date in YYYY-MM-DD format.");
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function dateOnly(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(value: string, count: number) {
  const { year, month, day } = parts(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + count);
  return dateOnly(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function targetMonth(year: number, month: number, offset: number) {
  const zeroBased = year * 12 + month - 1 + offset;
  return { year: Math.floor(zeroBased / 12), month: zeroBased % 12 + 1 };
}

export function nextRecurringOccurrence(schedule: RecurrenceSchedule, after: string) {
  const interval = Math.max(1, Math.trunc(schedule.recurrenceInterval));
  if (schedule.recurrenceUnit === "day") return addDays(after, interval);
  if (schedule.recurrenceUnit === "week") return addDays(after, interval * 7);

  const anchor = parts(schedule.anchorDate);
  const current = parts(after);
  if (schedule.recurrenceUnit === "month") {
    const target = targetMonth(current.year, current.month, interval);
    return dateOnly(target.year, target.month, Math.min(anchor.day, daysInMonth(target.year, target.month)));
  }

  const year = current.year + interval;
  return dateOnly(year, anchor.month, Math.min(anchor.day, daysInMonth(year, anchor.month)));
}

export function firstRecurringOccurrence(schedule: RecurrenceSchedule, today: string) {
  let occurrence = schedule.anchorDate;
  let guard = 0;
  while (occurrence < today) {
    occurrence = nextRecurringOccurrence(schedule, occurrence);
    guard += 1;
    if (guard > 10_000) throw new Error("Could not calculate the first recurring date.");
  }
  return occurrence;
}

export function recurringOccurrencesBetween(
  entry: Pick<RecurringEntry, "active" | "nextDueOn" | "recurrenceUnit" | "recurrenceInterval" | "anchorDate">,
  start: string,
  end: string,
) {
  if (!entry.active || start > end) return [];
  const schedule: RecurrenceSchedule = entry;
  const occurrences: string[] = [];
  let occurrence = entry.nextDueOn;
  let guard = 0;
  while (occurrence < start) {
    occurrence = nextRecurringOccurrence(schedule, occurrence);
    guard += 1;
    if (guard > 10_000) throw new Error("Could not calculate recurring dates.");
  }
  while (occurrence <= end) {
    occurrences.push(occurrence);
    occurrence = nextRecurringOccurrence(schedule, occurrence);
    guard += 1;
    if (guard > 10_000) throw new Error("Could not calculate recurring dates.");
  }
  return occurrences;
}

export function recurrenceLabel(schedule: Pick<RecurrenceSchedule, "recurrenceUnit" | "recurrenceInterval">) {
  const count = schedule.recurrenceInterval;
  const unit = schedule.recurrenceUnit;
  if (count === 1) return unit === "day" ? "Daily" : unit === "week" ? "Weekly" : unit === "month" ? "Monthly" : "Yearly";
  return `Every ${count} ${unit}s`;
}

export function dateOnlyInTimeZone(timeZone: string, now = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
