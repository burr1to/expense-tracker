import { dueRemaining } from "./dues";
import { recurringOccurrencesBetween, scheduledOccurrencesBetween } from "./recurrence";
import type { DueItem, LedgerTransaction, RecurringEntry } from "../types";

export interface CashForecastDay {
  date: string;
  balanceMinor: number;
  incomeMinor: number;
  billsMinor: number;
  duesMinor: number;
  paceMinor: number;
}

export interface CashForecast {
  startingBalanceMinor: number;
  dailyPaceMinor: number;
  days: CashForecastDay[];
  lowest: CashForecastDay;
  day30: CashForecastDay;
}

function shiftDate(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function isInflow(kind: DueItem["kind"]) {
  return kind === "receivable" || kind === "lent";
}

/** Occurrences already confirmed, i.e. before `nextDueOn`; anything from `nextDueOn` on has not reached the ledger. */
function confirmedOccurrences(entry: RecurringEntry, start: string, end: string) {
  if (!entry.active) return [];
  const lastConfirmed = shiftDate(entry.nextDueOn, -1);
  return scheduledOccurrencesBetween(entry, start, lastConfirmed < end ? lastConfirmed : end);
}

/**
 * Projects tracked-account cash for the next 30 days.
 * The start is today's tracked balance. Future days add scheduled income and
 * money owed to you, then subtract scheduled bills, open dues, and a daily
 * pace from recent online spending that is not already a scheduled bill.
 * Bills and dues that are due but not settled yet land on the first day.
 */
export function forecastCash(input: {
  startingBalanceMinor: number;
  transactions: readonly Pick<LedgerTransaction, "kind" | "amountMinor" | "occurredOn" | "paymentMode">[];
  recurringEntries: readonly RecurringEntry[];
  dueItems: readonly DueItem[];
  today: string;
  days?: number;
}): CashForecast {
  const horizon = input.days ?? 30;
  const today = input.today;
  const windowStart = shiftDate(today, -(horizon - 1));
  const firstDay = shiftDate(today, 1);

  let recentOnline = 0;
  for (const item of input.transactions) {
    if (item.kind !== "expense" || item.paymentMode !== "online") continue;
    if (item.occurredOn < windowStart || item.occurredOn > today) continue;
    recentOnline += item.amountMinor;
  }

  let recentScheduled = 0;
  for (const entry of input.recurringEntries) {
    if (entry.kind !== "expense" || !entry.paymentAccountId) continue;
    recentScheduled += confirmedOccurrences(entry, windowStart, today).length * entry.amountMinor;
  }

  const dailyPaceMinor = Math.max(0, Math.round((recentOnline - recentScheduled) / horizon));
  let balance = input.startingBalanceMinor;
  const days: CashForecastDay[] = [];

  for (let offset = 1; offset <= horizon; offset += 1) {
    const date = shiftDate(today, offset);
    let incomeMinor = 0;
    let billsMinor = 0;
    for (const entry of input.recurringEntries) {
      if (!entry.active) continue;
      // Due but not confirmed yet: the money has not left the balance, so it lands on the first day.
      const from = date === firstDay && entry.nextDueOn < date ? entry.nextDueOn : date;
      const hits = recurringOccurrencesBetween(entry, from, date).length;
      if (!hits) continue;
      const amount = hits * entry.amountMinor;
      if (entry.kind === "income") incomeMinor += amount;
      else billsMinor += amount;
    }

    let duesMinor = 0;
    for (const due of input.dueItems) {
      if (due.status !== "open") continue;
      if (due.snoozedUntil && due.snoozedUntil > today) continue;
      const remaining = dueRemaining(due);
      if (!remaining) continue;
      const dueDate = due.dueOn < firstDay ? firstDay : due.dueOn;
      if (dueDate !== date) continue;
      if (isInflow(due.kind)) incomeMinor += remaining;
      else duesMinor += remaining;
    }

    balance += incomeMinor - billsMinor - duesMinor - dailyPaceMinor;
    days.push({ date, balanceMinor: balance, incomeMinor, billsMinor, duesMinor, paceMinor: dailyPaceMinor });
  }

  const lowest = days.reduce((low, day) => day.balanceMinor < low.balanceMinor ? day : low);
  return {
    startingBalanceMinor: input.startingBalanceMinor,
    dailyPaceMinor,
    days,
    lowest,
    day30: days[days.length - 1],
  };
}
