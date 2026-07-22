import { addDays, compareAsc, format, getDate, getDaysInMonth, isSameMonth, startOfMonth } from "date-fns";
import { dueRemaining } from "./dues";
import { isInMonth } from "./dates";
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

const upcomingRecurringForMonth = (entries: readonly RecurringEntry[], month: Date) =>
  entries.filter((entry) => entry.active && isInMonth(entry.nextDueOn, month));

const upcomingDuesForMonth = (items: readonly DueItem[], month: Date) =>
  items.filter((item) => item.status === "open" && isInMonth(item.dueOn, month));

const upcomingRecurringForBreathingRoom = (entries: readonly RecurringEntry[], month: Date, today: Date) => {
  if (!isSameMonth(month, today)) return upcomingRecurringForMonth(entries, month);

  // The dashboard is a near-term cash-flow view. Include overdue entries and
  // the next 30 days so a payment due just after month-end is still visible.
  const through = format(addDays(today, 30), "yyyy-MM-dd");
  return entries.filter((entry) => entry.active && entry.nextDueOn <= through);
};

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
  const recurring = upcomingRecurringForMonth(recurringEntries, month).filter((entry) => entry.kind === "expense");
  const dues = upcomingDuesForMonth(dueItems, month).filter((item) => item.kind === "payment" || item.kind === "borrowed");

  return budgets
    .filter((budget) => budget.monthKey === `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`)
    .map((budget) => {
      const spentMinor = sum(expenses.filter((item) => item.category === budget.category).map((item) => item.amountMinor));
      const upcomingRecurringMinor = sum(recurring.filter((entry) => entry.category === budget.category).map((entry) => entry.amountMinor));
      const upcomingDuesMinor = sum(dues.filter((item) => item.category === budget.category).map(dueRemaining));
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
        alertDetail = "This category's budget is fully used.";
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
        alertDetail = `${spentPercentage}% used with ${timing.elapsedPercentage}% of the month elapsed.`;
      } else if (spentPercentage >= 50 && spentPercentage > timing.elapsedPercentage + 10) {
        tone = "watch";
        alertTitle = "Spending ahead of pace";
        alertDetail = `${spentPercentage}% used with ${timing.elapsedPercentage}% of the month elapsed.`;
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
        dailyAllowanceMinor,
        tone,
        alertTitle,
        alertDetail,
      };
    });
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
    sum(recurring.filter((entry) => entry.kind === "income").map((entry) => entry.amountMinor)) +
    sum(dues.filter((item) => item.kind === "receivable" || item.kind === "lent").map(dueRemaining));
  const upcomingExpensesMinor =
    sum(recurring.filter((entry) => entry.kind === "expense").map((entry) => entry.amountMinor)) +
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
