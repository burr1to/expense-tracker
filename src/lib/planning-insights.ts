import { addDays, compareAsc, endOfMonth, format, getDate, getDaysInMonth, isSameMonth, parseISO, startOfMonth } from "date-fns";
import { budgetCoversCategory, isAllSpendingBudget } from "./budgets";
import { isLoanCategory } from "./categories";
import { dueRemaining } from "./dues";
import { transactionCountsTowardBudget } from "./household";
import { isInMonth, monthKeyFor, todayInput } from "./dates";
import { isMonthKey, isSameMonthKey, type PeriodBounds } from "./period";
import { recurringOccurrencesBetween } from "./recurrence";
import type { Budget, DueItem, LedgerTransaction, RecurringEntry } from "../types";

export type BudgetPacingTone = "healthy" | "watch" | "warning" | "over";

export interface BudgetPacing {
  budget: Budget;
  spentMinor: number;
  upcomingRecurringMinor: number;
  upcomingDuesMinor: number;
  upcomingMinor: number;
  projectedMinor: number;
  spentPercentage: number;
  projectedPercentage: number;
  elapsedPercentage: number;
  remainingMinor: number;
  /** Days the remaining amount has to cover, today included; 0 once the period is over. */
  remainingDays: number;
  dailyAllowanceMinor: number;
  tone: BudgetPacingTone;
  alertTitle: string;
  alertDetail: string;
}

export interface MonthlyBreathingRoom {
  loggedIncomeMinor: number;
  loggedExpensesMinor: number;
  upcomingIncomeMinor: number;
  upcomingExpensesMinor: number;
  projectedIncomeMinor: number;
  projectedExpensesMinor: number;
  projectedNetMinor: number;
}

export function calculateSafeToSpend(currentBalanceMinor: number, breathingRoom: MonthlyBreathingRoom) {
  return currentBalanceMinor + breathingRoom.upcomingIncomeMinor - breathingRoom.upcomingExpensesMinor;
}

export type SpendingHorizonSource = "payday" | "incomePattern" | "periodEnd";

export interface SpendingHorizon {
  /** Inclusive last day this allowance has to cover, `YYYY-MM-DD`. */
  throughDate: string;
  /** Days from today to `throughDate` inclusive; never below 1. */
  daysRemaining: number;
  source: SpendingHorizonSource;
}

export interface SafeToSpend {
  /** Spendable after commitments and the buffer. May be negative. */
  totalMinor: number;
  perDayMinor: number;
  committedMinor: number;
  /** The part of `committedMinor` from recurring bills due on or before today that are not confirmed yet. */
  overdueRecurringMinor: number;
  bufferMinor: number;
  balanceMinor: number;
  horizon: SpendingHorizon;
}

const dayDifference = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function horizonTo(throughDate: string, today: string, source: SpendingHorizonSource): SpendingHorizon {
  return { throughDate, daysRemaining: Math.max(1, dayDifference(today, throughDate) + 1), source };
}

/**
 * The most common day of the month on which income was recorded, used only
 * when nothing is scheduled. Needs at least three income entries so a single
 * one-off payment never sets the horizon.
 */
function dominantIncomeDay(transactions: readonly LedgerTransaction[]): number | null {
  const counts = new Map<number, number>();
  for (const item of transactions) {
    if (item.kind !== "income" || isLoanCategory(item.category)) continue;
    const day = Number(item.occurredOn.slice(8, 10));
    if (!day) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const [day, count] = ranked[0] ?? [];
  return count && count >= 3 ? day : null;
}

function nextOccurrenceOfDay(day: number, today: string): string {
  const [year, month] = today.split("-").map(Number);
  const clamp = (y: number, m: number) => Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate());
  const thisMonth = `${year}-${String(month).padStart(2, "0")}-${String(clamp(year, month)).padStart(2, "0")}`;
  if (thisMonth >= today) return thisMonth;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(clamp(nextYear, nextMonth)).padStart(2, "0")}`;
}

/**
 * How far ahead the daily allowance has to stretch. A scheduled income entry is
 * the strongest signal — its `nextDueOn` is literally payday. Failing that, a
 * repeated income day in history is used, and failing that the period end.
 */
export function detectSpendingHorizon(
  recurringEntries: readonly RecurringEntry[],
  transactions: readonly LedgerTransaction[],
  month: Date,
  today = todayInput(),
): SpendingHorizon {
  const scheduled = recurringEntries
    .filter((entry) => entry.active && entry.kind === "income" && entry.nextDueOn >= today)
    .map((entry) => entry.nextDueOn)
    .sort()[0];
  if (scheduled) return horizonTo(scheduled, today, "payday");

  const day = dominantIncomeDay(transactions);
  if (day) return horizonTo(nextOccurrenceOfDay(day, today), today, "incomePattern");

  const monthEnd = format(endOfMonth(month), "yyyy-MM-dd");
  return horizonTo(monthEnd > today ? monthEnd : today, today, "periodEnd");
}

/**
 * Expenses already committed between today and the horizon, inclusive.
 * Recurring bills that fell due earlier but are not confirmed yet still count:
 * their money has not left the balance.
 */
export function committedBeforeHorizon(
  recurringEntries: readonly RecurringEntry[],
  dueItems: readonly DueItem[],
  horizon: SpendingHorizon,
  today = todayInput(),
): number {
  const recurring = sum(recurringEntries
    .filter((entry) => entry.kind === "expense")
    .flatMap((entry) => recurringOccurrencesBetween(entry, entry.nextDueOn < today ? entry.nextDueOn : today, horizon.throughDate).map(() => entry.amountMinor)));
  const dues = sum(dueItems
    .filter((item) => item.status === "open" && (item.kind === "payment" || item.kind === "borrowed") && item.dueOn <= horizon.throughDate)
    .map(dueRemaining));
  return recurring + dues;
}

/** Recurring bills due on or before today that are waiting to be confirmed. */
export function recurringAwaitingConfirmation(recurringEntries: readonly RecurringEntry[], today = todayInput()): number {
  return sum(recurringEntries
    .filter((entry) => entry.kind === "expense" && entry.nextDueOn <= today)
    .flatMap((entry) => recurringOccurrencesBetween(entry, entry.nextDueOn, today).map(() => entry.amountMinor)));
}

/**
 * What is genuinely free to spend, and at what daily rate.
 *
 * Deliberately excludes income that has not arrived yet: money due on payday
 * belongs to the next cycle, not this one. Counting it would inflate today's
 * allowance with cash the user does not have.
 */
export function calculateSafeToSpendV2(
  balanceMinor: number,
  committedMinor: number,
  horizon: SpendingHorizon,
  bufferMinor = 0,
  overdueRecurringMinor = 0,
): SafeToSpend {
  const totalMinor = balanceMinor - committedMinor - bufferMinor;
  return {
    totalMinor,
    perDayMinor: totalMinor > 0 ? Math.floor(totalMinor / horizon.daysRemaining) : 0,
    committedMinor,
    overdueRecurringMinor,
    bufferMinor,
    balanceMinor,
    horizon,
  };
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const percentage = (value: number, total: number) => total > 0 ? Math.round((value / total) * 100) : 0;

function monthTiming(month: Date, today: Date) {
  const monthStart = startOfMonth(month);
  const todayStart = startOfMonth(today);
  const daysInMonth = getDaysInMonth(month);
  if (compareAsc(monthStart, todayStart) < 0) return { elapsedPercentage: 100, remainingDays: 0 };
  if (compareAsc(monthStart, todayStart) > 0) return { elapsedPercentage: 0, remainingDays: daysInMonth };
  const elapsedDays = getDate(today);
  return {
    elapsedPercentage: Math.round((elapsedDays / daysInMonth) * 100),
    remainingDays: Math.max(1, daysInMonth - elapsedDays + 1),
  };
}

interface RecurringOccurrence {
  entry: RecurringEntry;
  occurredOn: string;
}

const upcomingRecurringForMonth = (entries: readonly RecurringEntry[], month: Date): RecurringOccurrence[] => {
  const start = format(startOfMonth(month), "yyyy-MM-dd");
  const end = format(endOfMonth(month), "yyyy-MM-dd");
  return entries.flatMap((entry) => recurringOccurrencesBetween(entry, start, end).map((occurredOn) => ({ entry, occurredOn })));
};

const upcomingDuesForMonth = (items: readonly DueItem[], month: Date) =>
  items.filter((item) => item.status === "open" && isInMonth(item.dueOn, month));

const upcomingRecurringForBreathingRoom = (entries: readonly RecurringEntry[], month: Date, today: Date) => {
  if (!isSameMonth(month, today)) return upcomingRecurringForMonth(entries, month);

  // The dashboard is a near-term cash-flow view. Include overdue entries and
  // the next 30 days so a payment due just after month-end is still visible.
  const through = format(addDays(today, 30), "yyyy-MM-dd");
  const todayKey = format(today, "yyyy-MM-dd");
  return entries.flatMap((entry) => recurringOccurrencesBetween(entry, entry.nextDueOn < todayKey ? entry.nextDueOn : todayKey, through).map((occurredOn) => ({ entry, occurredOn })));
};

interface PacingTiming { elapsedPercentage: number; remainingDays: number }

/**
 * Paces one budget against expenses, recurring occurrences and dues that are
 * already limited to the budget's period. Category budgets count their own
 * category; an "All spending" budget counts every non-loan expense.
 */
function paceBudget(
  budget: Budget,
  expenses: readonly LedgerTransaction[],
  recurring: readonly RecurringOccurrence[],
  dues: readonly DueItem[],
  timing: PacingTiming,
  periodNoun: "month" | "season",
): BudgetPacing {
  const spentMinor = sum(expenses.filter((item) => budgetCoversCategory(budget, item.category) && transactionCountsTowardBudget(item, budget)).map((item) => item.amountMinor));
  const upcomingRecurringMinor = sum(recurring.filter(({ entry }) => budgetCoversCategory(budget, entry.category)).map(({ entry }) => entry.amountMinor));
  const upcomingDuesMinor = sum(dues.filter((item) => budgetCoversCategory(budget, item.category)).map(dueRemaining));
  const upcomingMinor = upcomingRecurringMinor + upcomingDuesMinor;
  const projectedMinor = spentMinor + upcomingMinor;
  const spentPercentage = percentage(spentMinor, budget.amountMinor);
  const projectedPercentage = percentage(projectedMinor, budget.amountMinor);
  const remainingMinor = Math.max(0, budget.amountMinor - projectedMinor);
  const dailyAllowanceMinor = timing.remainingDays > 0 ? Math.floor(remainingMinor / timing.remainingDays) : 0;

  let tone: BudgetPacingTone = "healthy";
  let alertTitle = "On track";
  let alertDetail = upcomingMinor > 0 ? `${projectedPercentage}% projected after upcoming expenses.` : `${spentPercentage}% used so far.`;
  if (spentMinor > budget.amountMinor) {
    tone = "over";
    alertTitle = "Budget exceeded";
    alertDetail = `${spentPercentage}% already used.`;
  } else if (spentMinor === budget.amountMinor && budget.amountMinor > 0) {
    tone = "warning";
    alertTitle = "Budget limit reached";
    alertDetail = isAllSpendingBudget(budget) ? "Your overall spending limit is fully used." : "This category's budget is fully used.";
  } else if (projectedMinor > budget.amountMinor) {
    tone = "warning";
    alertTitle = "Projected to exceed";
    alertDetail = `${projectedPercentage}% projected after upcoming expenses.`;
  } else if (projectedMinor === budget.amountMinor && budget.amountMinor > 0 && upcomingMinor > 0) {
    tone = "warning";
    alertTitle = "Projected to reach limit";
    alertDetail = "Logged and upcoming expenses use the full budget.";
  } else if (spentPercentage >= 80) {
    tone = "warning";
    alertTitle = "80% threshold reached";
    alertDetail = `${spentPercentage}% used with ${timing.elapsedPercentage}% of the ${periodNoun} elapsed.`;
  } else if (spentPercentage >= 50 && spentPercentage > timing.elapsedPercentage + 10) {
    tone = "watch";
    alertTitle = "Spending ahead of pace";
    alertDetail = `${spentPercentage}% used with ${timing.elapsedPercentage}% of the ${periodNoun} elapsed.`;
  }

  return {
    budget,
    spentMinor,
    upcomingRecurringMinor,
    upcomingDuesMinor,
    upcomingMinor,
    projectedMinor,
    spentPercentage,
    projectedPercentage,
    elapsedPercentage: timing.elapsedPercentage,
    remainingMinor,
    remainingDays: timing.remainingDays,
    dailyAllowanceMinor,
    tone,
    alertTitle,
    alertDetail,
  };
}

export function calculateBudgetPacing(
  budgets: readonly Budget[],
  transactions: readonly LedgerTransaction[],
  recurringEntries: readonly RecurringEntry[],
  dueItems: readonly DueItem[],
  month: Date,
  today = new Date(),
): BudgetPacing[] {
  const timing = monthTiming(month, today);
  const expenses = transactions.filter((item) => item.kind === "expense" && isInMonth(item.occurredOn, month));
  const recurring = upcomingRecurringForMonth(recurringEntries, month).filter(({ entry }) => entry.kind === "expense");
  const dues = upcomingDuesForMonth(dueItems, month).filter((item) => item.kind === "payment" || item.kind === "borrowed");

  return budgets
    .filter((budget) => isMonthKey(budget.monthKey) && isSameMonthKey(budget.monthKey, monthKeyFor(month)))
    .map((budget) => paceBudget(budget, expenses, recurring, dues, timing, "month"));
}

/**
 * Pacing for a budget whose period is not a Gregorian month, such as a
 * festival season (`FEST:dashain-tihar-2083`). `bounds` is the period's
 * window; `today` is a Kathmandu `YYYY-MM-DD`.
 */
export function calculatePeriodBudgetPacing(
  budget: Budget,
  bounds: PeriodBounds,
  transactions: readonly LedgerTransaction[],
  recurringEntries: readonly RecurringEntry[],
  dueItems: readonly DueItem[],
  today = todayInput(),
): BudgetPacing {
  const totalDays = Math.max(1, dayDifference(bounds.start, bounds.endExclusive));
  const elapsedDays = today < bounds.start ? 0 : today >= bounds.endExclusive ? totalDays : dayDifference(bounds.start, today) + 1;
  const timing: PacingTiming = {
    elapsedPercentage: Math.round((elapsedDays / totalDays) * 100),
    remainingDays: today >= bounds.endExclusive ? 0 : today < bounds.start ? totalDays : Math.max(1, totalDays - elapsedDays + 1),
  };
  const lastDay = format(addDays(parseISO(bounds.endExclusive), -1), "yyyy-MM-dd");
  const inWindow = (date: string) => date >= bounds.start && date < bounds.endExclusive;
  const expenses = transactions.filter((item) => item.kind === "expense" && inWindow(item.occurredOn));
  const recurring = recurringEntries.filter((entry) => entry.kind === "expense").flatMap((entry) => recurringOccurrencesBetween(entry, bounds.start, lastDay).map((occurredOn) => ({ entry, occurredOn })));
  const dues = dueItems.filter((item) => item.status === "open" && (item.kind === "payment" || item.kind === "borrowed") && inWindow(item.dueOn));
  return paceBudget(budget, expenses, recurring, dues, timing, "season");
}

export interface UnbudgetedSpending {
  totalMinor: number;
  /** Largest first. */
  categories: { category: string; totalMinor: number }[];
}

/**
 * This month's expenses that no category budget counts. An "All spending"
 * limit does not make a category budgeted, and loan movements are not spending.
 */
export function calculateUnbudgetedSpending(budgets: readonly Budget[], transactions: readonly LedgerTransaction[], month: Date): UnbudgetedSpending {
  const categoryBudgets = budgets.filter((budget) => !isAllSpendingBudget(budget) && isMonthKey(budget.monthKey) && isSameMonthKey(budget.monthKey, monthKeyFor(month)));
  const totals = new Map<string, number>();
  for (const item of transactions) {
    if (item.kind !== "expense" || isLoanCategory(item.category) || !isInMonth(item.occurredOn, month)) continue;
    if (categoryBudgets.some((budget) => budgetCoversCategory(budget, item.category) && transactionCountsTowardBudget(item, budget))) continue;
    totals.set(item.category, (totals.get(item.category) ?? 0) + item.amountMinor);
  }
  const categories = [...totals.entries()].map(([category, totalMinor]) => ({ category, totalMinor })).sort((a, b) => b.totalMinor - a.totalMinor);
  return { totalMinor: sum(categories.map((item) => item.totalMinor)), categories };
}

export function calculateMonthlyBreathingRoom(
  transactions: readonly LedgerTransaction[],
  recurringEntries: readonly RecurringEntry[],
  dueItems: readonly DueItem[],
  month: Date,
  today = new Date(),
): MonthlyBreathingRoom {
  const monthTransactions = transactions.filter((item) => isInMonth(item.occurredOn, month));
  const recurring = upcomingRecurringForBreathingRoom(recurringEntries, month, today);
  const dues = upcomingDuesForMonth(dueItems, month);
  const loggedIncomeMinor = sum(monthTransactions.filter((item) => item.kind === "income").map((item) => item.amountMinor));
  const loggedExpensesMinor = sum(monthTransactions.filter((item) => item.kind === "expense").map((item) => item.amountMinor));
  const upcomingIncomeMinor =
    sum(recurring.filter(({ entry }) => entry.kind === "income").map(({ entry }) => entry.amountMinor)) +
    sum(dues.filter((item) => item.kind === "receivable" || item.kind === "lent").map(dueRemaining));
  const upcomingExpensesMinor =
    sum(recurring.filter(({ entry }) => entry.kind === "expense").map(({ entry }) => entry.amountMinor)) +
    sum(dues.filter((item) => item.kind === "payment" || item.kind === "borrowed").map(dueRemaining));
  const projectedIncomeMinor = loggedIncomeMinor + upcomingIncomeMinor;
  const projectedExpensesMinor = loggedExpensesMinor + upcomingExpensesMinor;

  return {
    loggedIncomeMinor,
    loggedExpensesMinor,
    upcomingIncomeMinor,
    upcomingExpensesMinor,
    projectedIncomeMinor,
    projectedExpensesMinor,
    projectedNetMinor: projectedIncomeMinor - projectedExpensesMinor,
  };
}
