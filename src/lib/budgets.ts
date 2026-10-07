import { completedMonthsWindow, type AveragingWindow } from "./financial-calculators";
import { getCategory, isLoanCategory } from "./categories";
import { formatMoney } from "./currency";
import { transactionCountsTowardBudget } from "./household";
// Registers the Bikram Sambat calendar, so BS budget keys step and resolve.
import "./nepali-date";
import { addMonthsToKey, isMonthKey, monthBounds, toStorageKey } from "./period";
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

/**
 * A stored month key moved by `delta` months in its own calendar:
 * "2026-01" -> "2025-12", "BS:2083-01" -> "BS:2082-12". Festival keys are not months.
 */
export function shiftMonthKey(key: string, delta: number): string {
  if (!isMonthKey(key)) throw new Error(`Invalid month key: ${key}`);
  return toStorageKey(addMonthsToKey(key, delta));
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
 * Last month's budgets, ready to start `targetMonthKey` (a stored key, `YYYY-MM` or
 * `BS:YYYY-MM`) with; "last month" is the previous month of the same calendar. Returns null when
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
  if (!isMonthKey(targetMonthKey)) return null;
  const target = monthBounds(targetMonthKey);
  if (target.endExclusive <= today) return null;
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
  const previousStart = monthBounds(previousMonthKey).start;
  const previousEnd = target.start;

  const rows = previous.map((budget): BudgetCarryForwardRow => ({
    category: budget.category,
    shared: budget.shared ?? false,
    lastLimitMinor: budget.amountMinor,
    lastActualMinor: spentFor(budget, previousStart, previousEnd),
    averageMinor: averageWindow.months ? Math.ceil(spentFor(budget, averageWindow.start, averageWindow.endExclusive) / averageWindow.months) : null,
  })).sort((a, b) => Number(isAllSpendingBudget(b)) - Number(isAllSpendingBudget(a)) || b.lastLimitMinor - a.lastLimitMinor);

  return { previousMonthKey, rows, averageWindow };
}
