import { addDays, format, getDay, parseISO } from "date-fns";
import { countsAsIncomeOrSpending, getCategory } from "./categories";
import { formatLedgerMonth, periodKeyFor, periodRange, todayInput, type MonthRef } from "./dates";
import { dueRemaining } from "./dues";
import { summarizeLedger } from "./ledger";
import { addMonthsToKey, daysBetweenIso } from "./period";
import { recurringOccurrencesBetween, scheduledOccurrencesBetween } from "./recurrence";
import type { CalendarSystem, CurrencyCode, CustomCategory, DueItem, Insight, LedgerTransaction, RecurringEntry } from "../types";

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface InsightContext {
  recurringEntries?: readonly RecurringEntry[];
  dueItems?: readonly DueItem[];
  calendarSystem?: CalendarSystem;
  /** Kathmandu `YYYY-MM-DD`; defaults to now. */
  today?: string;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
/** 1-based day of the period a date falls on: the BS day in a BS month, the calendar day in an AD one. */
const dayIn = (date: string, start: string) => daysBetweenIso(start, date) + 1;
const dayBefore = (date: string) => format(addDays(parseISO(date), -1), "yyyy-MM-dd");
const isExpense = (item: { kind: string }) => item.kind === "expense";
const isIncome = (item: { kind: string }) => item.kind === "income";

/**
 * Where the current month is heading. Income and scheduled bills land once, so
 * only the remaining day-to-day spending is projected by pace: a salary on the
 * 1st or rent paid on day one is never stretched across the month.
 */
export function projectMonth(current: readonly LedgerTransaction[], recurringEntries: readonly RecurringEntry[], dueItems: readonly DueItem[], month: MonthRef, today: string) {
  const { start: monthStart, end: monthEnd, days: daysInMonth } = periodRange(month);
  const elapsed = dayIn(today, monthStart);
  const counted = current.filter(countsAsIncomeOrSpending);
  const loggedIncomeMinor = sum(counted.filter(isIncome).map((item) => item.amountMinor));
  const loggedExpensesMinor = sum(counted.filter(isExpense).map((item) => item.amountMinor));
  const recurring = recurringEntries.filter(countsAsIncomeOrSpending);
  // Occurrences before `nextDueOn` were confirmed, so they are already among the logged expenses.
  const scheduledSoFar = sum(recurring.filter(isExpense).flatMap((entry) => {
    const lastConfirmed = dayBefore(entry.nextDueOn);
    return scheduledOccurrencesBetween(entry, monthStart, lastConfirmed < today ? lastConfirmed : today).map(() => entry.amountMinor);
  }));
  const dayToDaySoFar = Math.max(0, sum(counted.filter((item) => isExpense(item) && item.occurredOn <= today).map((item) => item.amountMinor)) - scheduledSoFar);
  const pacedRestMinor = Math.round((dayToDaySoFar / elapsed) * (daysInMonth - elapsed));
  // Unconfirmed occurrences still count, but last month's land in last month when confirmed on their due date.
  const upcomingFrom = (entry: RecurringEntry) => {
    const from = entry.nextDueOn < today ? entry.nextDueOn : today;
    return from < monthStart ? monthStart : from;
  };
  const upcoming = recurring.flatMap((entry) => recurringOccurrencesBetween(entry, upcomingFrom(entry), monthEnd).map(() => entry));
  const dues = dueItems.filter((item) => item.status === "open" && item.dueOn >= monthStart && item.dueOn <= monthEnd);
  const upcomingIncomeMinor = sum(upcoming.filter(isIncome).map((entry) => entry.amountMinor)) + sum(dues.filter((item) => item.kind === "receivable").map(dueRemaining));
  const upcomingExpensesMinor = sum(upcoming.filter(isExpense).map((entry) => entry.amountMinor)) + sum(dues.filter((item) => item.kind === "payment").map(dueRemaining));
  const incomeMinor = loggedIncomeMinor + upcomingIncomeMinor;
  const expensesMinor = loggedExpensesMinor + upcomingExpensesMinor + pacedRestMinor;
  return { incomeMinor, expensesMinor, netMinor: incomeMinor - expensesMinor };
}

export function generateInsights(transactions: readonly LedgerTransaction[], month: MonthRef, currency: CurrencyCode, customCategories: readonly CustomCategory[] = [], context: InsightContext = {}): Insight[] {
  const today = context.today ?? todayInput();
  const period = periodKeyFor(month);
  const { start: monthStart, end: monthEnd } = periodRange(period);
  const isCurrent = today >= monthStart && today <= monthEnd;
  const isPast = monthEnd < today;
  const current = transactions.filter((item) => item.occurredOn >= monthStart && item.occurredOn <= monthEnd);
  const previousMonth = addMonthsToKey(period, -1);
  const previousRange = periodRange(previousMonth);
  const previous = transactions.filter((item) => item.occurredOn >= previousRange.start && item.occurredOn <= previousRange.end);
  const summary = summarizeLedger(current);
  // A Date marker names the previous month as before (a BS span in BS mode); a period key names its own month.
  const previousName = formatLedgerMonth(typeof month === "string" ? previousMonth : parseISO(previousRange.start), context.calendarSystem);
  // Like for like: mid-month, last month only counts up to the same day.
  const throughDay = isCurrent ? Math.min(dayIn(today, monthStart), previousRange.days) : 32;
  const expensesToDate = summarizeLedger(isCurrent ? current.filter((item) => item.occurredOn <= today) : current).expenses;
  const previousExpenses = summarizeLedger(previous.filter((item) => dayIn(item.occurredOn, previousRange.start) <= throughDay)).expenses;
  const insights: Insight[] = [];

  if (summary.categories[0]) {
    const top = summary.categories[0];
    insights.push({ id: "top-category", tone: "neutral", title: `${getCategory(top.category, customCategories).label} leads spending`, detail: `${top.percentage}% of this month’s expenses went there.` });
  }

  if ((isCurrent || isPast) && previousExpenses > 0) {
    const change = Math.round(((expensesToDate - previousExpenses) / previousExpenses) * 100);
    insights.push({ id: "month-change", tone: change <= 0 ? "positive" : "attention", title: change <= 0 ? `Spending is down ${Math.abs(change)}%` : `Spending is up ${change}%`, detail: isCurrent ? `Compared with ${previousName} up to the same day.` : `Compared with all of ${previousName}.` });
  }

  if (isCurrent) {
    const projection = projectMonth(current, context.recurringEntries ?? [], context.dueItems ?? [], month, today);
    const amountMinor = Math.round(Math.abs(projection.netMinor) / 100) * 100;
    if (projection.incomeMinor > 0 && amountMinor > 0) insights.push(projection.netMinor > 0
      ? { id: "projection", tone: "positive", title: "On track to save", amountMinor, detail: "By month end, if day-to-day spending keeps its pace and scheduled bills and income arrive." }
      : { id: "projection", tone: "attention", title: "Heading for a shortfall of", amountMinor, detail: "Day-to-day spending at this pace, plus scheduled bills, would pass this month’s income." });
  } else if (isPast && summary.saved > 0) {
    insights.push({ id: "projection", tone: "positive", title: "You saved", amountMinor: summary.saved, detail: `${summary.savedPercentage}% of ${formatLedgerMonth(month, context.calendarSystem)} income.` });
  }

  // Shown last: the dashboard keeps the first three, so the projection is never crowded out.
  const byDay = new Map<number, number>();
  current.filter((item) => item.kind === "expense" && countsAsIncomeOrSpending(item)).forEach((item) => byDay.set(getDay(parseISO(item.occurredOn)), (byDay.get(getDay(parseISO(item.occurredOn))) ?? 0) + item.amountMinor));
  const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  const spentMinor = sum([...byDay.values()]);
  if (busiest && spentMinor > 0) insights.push({ id: "spend-day", tone: "neutral", title: `${dayNames[busiest[0]]} is your costliest day`, detail: `${Math.round((busiest[1] / spentMinor) * 100)}% of this month’s spending was logged on ${dayNames[busiest[0]]}s.` });

  return insights.slice(0, 4);
}
