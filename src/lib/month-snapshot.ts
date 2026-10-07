import { parseISO } from "date-fns";
import { isAllSpendingBudget } from "./budgets";
import { countsAsIncomeOrSpending } from "./categories";
import { periodKeyFor, periodRange, type MonthRef } from "./dates";
import { addMonthsToKey, daysBetweenIso, type PeriodKey } from "./period";
import { calculateMonthlyBreathingRoom, type BudgetPacing } from "./planning-insights";
import { recurringOccurrencesBetween } from "./recurrence";
import type { DueItem, LedgerTransaction, RecurringEntry } from "../types";

/** What this month's spending is measured against on the dashboard's "This month" card. */
export type MonthSpendTarget =
  | { kind: "allSpending"; limitMinor: number; spentMinor: number; percentage: number }
  | { kind: "categoryBudgets"; limitMinor: number; spentMinor: number; percentage: number; count: number }
  /** `currentMinor` and `previousMinor` both stop at `throughDay` while the month is running; `throughDay` is null for a finished month. */
  | { kind: "previousMonth"; previousMonth: PeriodKey; currentMinor: number; previousMinor: number; throughDay: number | null; changePercentage: number | null }
  | { kind: "none" };

export interface MonthSnapshot {
  timing: "past" | "current" | "future";
  /** Every counted expense in the month: the same total the month's category breakdown adds up to. */
  spentMinor: number;
  incomeMinor: number;
  target: MonthSpendTarget;
  /** A running or future month: logged money plus the income, bills and dues still scheduled before month end (an estimate). A finished month: income minus expenses. */
  netMinor: number;
  netIsEstimate: boolean;
  /** What the month's budgets leave to spend per day. Null without a budget or outside the running month. */
  budgetDailyMinor: number | null;
  /** The budget that most needs attention, or null while every budget is healthy. */
  riskiest: BudgetPacing | null;
}

export interface MonthSnapshotInput {
  month: MonthRef;
  /** Kathmandu `YYYY-MM-DD`. */
  today: string;
  transactions: readonly LedgerTransaction[];
  recurringEntries: readonly RecurringEntry[];
  dueItems: readonly DueItem[];
  /** `calculateBudgetPacing` for this month's budgets. */
  budgetPacing: readonly BudgetPacing[];
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const percentage = (value: number, total: number) => total > 0 ? Math.round((value / total) * 100) : 0;
/** 1-based day of the period a date falls on. */
const dayIn = (date: string, start: string) => daysBetweenIso(start, date) + 1;
const expensesOf = (items: readonly LedgerTransaction[]) => sum(items.filter((item) => item.kind === "expense").map((item) => item.amountMinor));

/**
 * One reading of the month for the dashboard: spending against a budget (or
 * last month up to the same day), where the month's net is heading, and what
 * the budgets leave per day. Loan movements are never income or spending.
 */
export function buildMonthSnapshot({ month, today, transactions, recurringEntries, dueItems, budgetPacing }: MonthSnapshotInput): MonthSnapshot {
  const { start: monthStart, end: monthEnd } = periodRange(month);
  const timing = today < monthStart ? "future" : today > monthEnd ? "past" : "current";
  const counted = transactions.filter(countsAsIncomeOrSpending);
  const inMonth = counted.filter((item) => item.occurredOn >= monthStart && item.occurredOn <= monthEnd);
  const spentMinor = expensesOf(inMonth);
  const incomeMinor = sum(inMonth.filter((item) => item.kind === "income").map((item) => item.amountMinor));

  const allSpending = budgetPacing.find((item) => isAllSpendingBudget(item.budget));
  const categoryPacing = budgetPacing.filter((item) => !isAllSpendingBudget(item.budget));
  let target: MonthSpendTarget = { kind: "none" };
  if (allSpending) {
    target = { kind: "allSpending", limitMinor: allSpending.budget.amountMinor, spentMinor: allSpending.spentMinor, percentage: allSpending.spentPercentage };
  } else if (categoryPacing.length) {
    const limitMinor = sum(categoryPacing.map((item) => item.budget.amountMinor));
    const budgetedMinor = sum(categoryPacing.map((item) => item.spentMinor));
    target = { kind: "categoryBudgets", limitMinor, spentMinor: budgetedMinor, percentage: percentage(budgetedMinor, limitMinor), count: categoryPacing.length };
  } else if (timing !== "future") {
    const previousMonth = addMonthsToKey(periodKeyFor(month), -1);
    const { start: previousStart, end: previousEnd, days: previousDays } = periodRange(previousMonth);
    // Like for like: while the month runs, last month only counts up to the same day of its own calendar.
    const throughDay = timing === "current" ? Math.min(dayIn(today, monthStart), previousDays) : null;
    const currentMinor = timing === "current" ? expensesOf(inMonth.filter((item) => item.occurredOn <= today)) : spentMinor;
    const previousMinor = expensesOf(counted.filter((item) => item.occurredOn >= previousStart && item.occurredOn <= previousEnd && (throughDay === null || dayIn(item.occurredOn, previousStart) <= throughDay)));
    target = { kind: "previousMonth", previousMonth, currentMinor, previousMinor, throughDay, changePercentage: previousMinor > 0 ? Math.round(((currentMinor - previousMinor) / previousMinor) * 100) : null };
  }

  let netMinor = incomeMinor - spentMinor;
  if (timing !== "past") {
    // Breathing room brings logged money and the month's open dues. Its recurring part looks 30 days ahead,
    // which would pull next month's salary or rent into this month, so recurring is added here up to month end.
    const loggedAndDues = calculateMonthlyBreathingRoom(counted, [], dueItems, month, parseISO(today)).projectedNetMinor;
    const recurringNet = sum(recurringEntries.filter(countsAsIncomeOrSpending).flatMap((entry) => {
      // Unconfirmed occurrences still count, but last month's land in last month once confirmed on their due date.
      const from = entry.nextDueOn < today ? entry.nextDueOn : today;
      return recurringOccurrencesBetween(entry, from < monthStart ? monthStart : from, monthEnd).map(() => entry.kind === "income" ? entry.amountMinor : -entry.amountMinor);
    }));
    netMinor = loggedAndDues + recurringNet;
  }
  const budgetDailyMinor = timing !== "current" ? null
    : allSpending ? allSpending.dailyAllowanceMinor
      : categoryPacing.length ? sum(categoryPacing.map((item) => item.dailyAllowanceMinor)) : null;
  const riskiest = [...budgetPacing].filter((item) => item.tone !== "healthy").sort((a, b) => b.projectedPercentage - a.projectedPercentage)[0] ?? null;

  return { timing, spentMinor, incomeMinor, target, netMinor, netIsEstimate: timing !== "past", budgetDailyMinor, riskiest };
}
