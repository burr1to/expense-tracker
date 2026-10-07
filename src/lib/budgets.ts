import { completedMonthsWindow, type AveragingWindow } from "./financial-calculators";
import { getCategory, isLoanCategory } from "./categories";
import { formatMoney } from "./currency";
import { transactionCountsTowardBudget } from "./household";
import type { Budget, CurrencyCode, CustomCategory, LedgerTransaction } from "../types";

/**
 * Reserved `Budget.category` for an overall limit. It is not a real category:
 * every expense counts against it, so "spend at most NPR 40,000 this month"
 * works without budgeting each category. Loan movements never count.
 */
export const ALL_SPENDING_CATEGORY = "__total";
export const ALL_SPENDING_LABEL = "All spending";

export function isAllSpendingBudget(budget: { category: string }): boolean {
  return budget.category === ALL_SPENDING_CATEGORY;
}

/** Whether an expense filed under `category` counts toward this budget's category. */
export function budgetCoversCategory(budget: { category: string }, category: string): boolean {
  if (isLoanCategory(category)) return false;
  return isAllSpendingBudget(budget) || budget.category === category;
}

export function budgetLabel(category: string, custom: readonly CustomCategory[] = []): string {
  return category === ALL_SPENDING_CATEGORY ? ALL_SPENDING_LABEL : getCategory(category, custom).label;
}

/**
 * "NPR 12,000 left · NPR 800/day for 15 days" — what an overall limit leaves to
 * spend, after upcoming bills, spread over the days still to come.
 */
export function budgetAllowanceText(
  pacing: { budget: { amountMinor: number }; spentMinor: number; projectedMinor: number; remainingMinor: number; remainingDays: number; dailyAllowanceMinor: number },
  currency: CurrencyCode,
): string {
  const { budget, spentMinor, projectedMinor, remainingMinor, remainingDays, dailyAllowanceMinor } = pacing;
  if (remainingMinor > 0 && remainingDays > 0) return `${formatMoney(remainingMinor, currency)} left · ${formatMoney(dailyAllowanceMinor, currency)}/day for ${remainingDays} ${remainingDays === 1 ? "day" : "days"}`;
  if (remainingMinor > 0) return `${formatMoney(remainingMinor, currency)} left`;
  if (spentMinor > budget.amountMinor) return `${formatMoney(spentMinor - budget.amountMinor, currency)} over the limit`;
  if (projectedMinor > budget.amountMinor) return "Upcoming bills use what is left";
  return "Limit fully used";
}

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-10" -> "2026-09"; "2026-01" -> "2025-12". Stored (bare) Gregorian month keys only. */
export function shiftMonthKey(key: string, delta: number): string {
  const match = MONTH_KEY.exec(key);
  if (!match) throw new Error(`Invalid month key: ${key}`);
  const index = Number(match[1]) * 12 + Number(match[2]) - 1 + delta;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export interface BudgetCarryForwardRow {
  category: string;
  shared: boolean;
  /** Last month's limit — the default for the new month. */
  lastLimitMinor: number;
  /** What actually counted toward that budget last month. */
  lastActualMinor: number;
  /** Monthly average over the last three completed months, or null without a completed month. */
  averageMinor: number | null;
}

export interface BudgetCarryForward {
  previousMonthKey: string;
  rows: BudgetCarryForwardRow[];
  /** The completed months `averageMinor` was built from. */
  averageWindow: AveragingWindow;
}

/**
 * Last month's budgets, ready to start `targetMonthKey` with. Returns null when
 * the target month already has one of the viewer's budgets, when last month
 * had none, or when the target month is already over. A household partner's
 * shared budgets are theirs to copy, so only the viewer's own are offered.
 */
export function buildBudgetCarryForward(
  budgets: readonly Budget[],
  transactions: readonly LedgerTransaction[],
  targetMonthKey: string,
  viewerId: string,
  today: string,
): BudgetCarryForward | null {
  if (!MONTH_KEY.test(targetMonthKey) || targetMonthKey < today.slice(0, 7)) return null;
  const mine = budgets.filter((budget) => budget.userId === viewerId);
  if (mine.some((budget) => budget.monthKey === targetMonthKey)) return null;
  const previousMonthKey = shiftMonthKey(targetMonthKey, -1);
  const previous = mine.filter((budget) => budget.monthKey === previousMonthKey);
  if (!previous.length) return null;

  const averageWindow = completedMonthsWindow(transactions, 3, today);
  const expenses = transactions.filter((item) => item.kind === "expense");
  const spentFor = (budget: Budget, from: string, toExclusive: string) => expenses
    .filter((item) => item.occurredOn >= from && item.occurredOn < toExclusive && budgetCoversCategory(budget, item.category) && transactionCountsTowardBudget(item, budget))
    .reduce((sum, item) => sum + item.amountMinor, 0);
  const previousStart = `${previousMonthKey}-01`;
  const previousEnd = `${targetMonthKey}-01`;

  const rows = previous.map((budget): BudgetCarryForwardRow => ({
    category: budget.category,
    shared: budget.shared ?? false,
    lastLimitMinor: budget.amountMinor,
    lastActualMinor: spentFor(budget, previousStart, previousEnd),
    averageMinor: averageWindow.months ? Math.ceil(spentFor(budget, averageWindow.start, averageWindow.endExclusive) / averageWindow.months) : null,
  })).sort((a, b) => Number(isAllSpendingBudget(b)) - Number(isAllSpendingBudget(a)) || b.lastLimitMinor - a.lastLimitMinor);

  return { previousMonthKey, rows, averageWindow };
}
