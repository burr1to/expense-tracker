import { addMonths, format, parseISO } from "date-fns";
import { dueRemaining } from "./dues";
import type { DueItem } from "../types";

export type PayoffStrategy = "snowball" | "avalanche" | "dueDate";

export interface DebtPlanEntry {
  item: DueItem;
  remainingMinor: number;
  order: number;
  monthsToClear: number;
  projectedClearedOn: string;
  interestMinor: number;
}

export interface DebtPlan {
  entries: DebtPlanEntry[];
  totalRemainingMinor: number;
  monthsToDebtFree: number;
  debtFreeOn: string | null;
  totalInterestMinor: number;
  minimumMonthlyMinor: number;
  impossible: boolean;
}

/** A runaway plan is never simulated past this horizon (50 years). */
const MAX_MONTHS = 600;

/** Missing rates mean "no interest", not "unknown" — the form leaves them blank. */
function monthlyRate(item: DueItem) {
  return Math.max(0, item.annualRatePercent ?? 0) / 1200;
}

export function isPlannableDebt(item: DueItem) {
  return item.kind === "borrowed" && item.status === "open" && dueRemaining(item) > 0;
}

/** Ties are broken by due date then id so a plan never reshuffles between renders. */
function compareDebts(strategy: PayoffStrategy, left: DueItem, right: DueItem) {
  if (strategy === "snowball") {
    const difference = dueRemaining(left) - dueRemaining(right);
    if (difference !== 0) return difference;
  }
  if (strategy === "avalanche") {
    const difference = (right.annualRatePercent ?? 0) - (left.annualRatePercent ?? 0);
    if (difference !== 0) return difference;
  }
  return left.dueOn.localeCompare(right.dueOn) || left.id.localeCompare(right.id);
}

function clearedOn(today: string, months: number) {
  return format(addMonths(parseISO(today), months), "yyyy-MM-dd");
}

function stalledPlan(ordered: readonly DueItem[], totalRemainingMinor: number, minimumMonthlyMinor: number): DebtPlan {
  return {
    entries: ordered.map((item, order) => ({ item, remainingMinor: dueRemaining(item), order, monthsToClear: 0, projectedClearedOn: "", interestMinor: 0 })),
    totalRemainingMinor,
    monthsToDebtFree: 0,
    debtFreeOn: null,
    totalInterestMinor: 0,
    minimumMonthlyMinor,
    impossible: true,
  };
}

/**
 * Orders every open borrowed debt by `strategy` and simulates paying them off
 * month by month. The whole budget goes to the first debt still standing, and
 * whatever is left when one clears rolls straight into the next in the same
 * month — that rollover is what makes the plan beat paying each debt alone.
 */
export function buildDebtPlan(dueItems: readonly DueItem[], monthlyBudgetMinor: number, strategy: PayoffStrategy, today: string): DebtPlan {
  const ordered = dueItems.filter(isPlannableDebt).sort((left, right) => compareDebts(strategy, left, right));
  const balances = ordered.map((item) => dueRemaining(item));
  const totalRemainingMinor = balances.reduce((sum, balance) => sum + balance, 0);
  const minimumMonthlyMinor = ordered.reduce((sum, item, index) => sum + Math.round(balances[index] * monthlyRate(item)), 0);
  const budget = Math.max(0, Math.round(monthlyBudgetMinor));

  if (!ordered.length) return { entries: [], totalRemainingMinor: 0, monthsToDebtFree: 0, debtFreeOn: null, totalInterestMinor: 0, minimumMonthlyMinor: 0, impossible: false };
  if (budget <= minimumMonthlyMinor) return stalledPlan(ordered, totalRemainingMinor, minimumMonthlyMinor);

  const interestPaid = ordered.map(() => 0);
  const monthsToClear = ordered.map(() => 0);
  let months = 0;

  while (balances.some((balance) => balance > 0) && months < MAX_MONTHS) {
    months += 1;
    for (let index = 0; index < balances.length; index += 1) {
      if (balances[index] <= 0) continue;
      const interest = Math.round(balances[index] * monthlyRate(ordered[index]));
      balances[index] += interest;
      interestPaid[index] += interest;
    }
    let available = budget;
    for (let index = 0; index < balances.length && available > 0; index += 1) {
      if (balances[index] <= 0) continue;
      const payment = Math.min(available, balances[index]);
      balances[index] -= payment;
      available -= payment;
      if (balances[index] === 0) monthsToClear[index] = months;
    }
  }

  if (balances.some((balance) => balance > 0)) return stalledPlan(ordered, totalRemainingMinor, minimumMonthlyMinor);

  return {
    entries: ordered.map((item, order) => ({
      item,
      remainingMinor: dueRemaining(item),
      order,
      monthsToClear: monthsToClear[order],
      projectedClearedOn: clearedOn(today, monthsToClear[order]),
      interestMinor: interestPaid[order],
    })),
    totalRemainingMinor,
    monthsToDebtFree: months,
    debtFreeOn: clearedOn(today, months),
    totalInterestMinor: interestPaid.reduce((sum, interest) => sum + interest, 0),
    minimumMonthlyMinor,
    impossible: false,
  };
}
