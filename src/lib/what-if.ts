import { addMonths, endOfMonth, format, isValid, parseISO, startOfMonth } from "date-fns";
import { getCategory } from "./categories";
import { calculateCategoryMonthlyAverages, calculateGoalPace } from "./financial-calculators";
import type { LedgerTransaction, SavingsGoal } from "../types";

export interface WhatIfAdjustment {
  category: string;
  changePercent: number;
}

export interface WhatIfGoalProjection {
  goal: SavingsGoal;
  baselineMonths: number | null;
  scenarioMonths: number | null;
  monthsSaved: number | null;
  baselineDate: string | null;
  scenarioDate: string | null;
}

export interface WhatIfResult {
  baselineMonthlyExpenseMinor: number;
  scenarioMonthlyExpenseMinor: number;
  baselineMonthlyNetMinor: number;
  scenarioMonthlyNetMinor: number;
  deltaMinor: number;
  goals: WhatIfGoalProjection[];
  warnings: string[];
}

export const WHAT_IF_MAX_CHANGE_PERCENT = 100;
export const WHAT_IF_THIN_HISTORY_MONTHS = 3;

export function clampChangePercent(changePercent: number): number {
  if (!Number.isFinite(changePercent)) return 0;
  return Math.max(-WHAT_IF_MAX_CHANGE_PERCENT, Math.min(WHAT_IF_MAX_CHANGE_PERCENT, changePercent));
}

function normalizeLookback(months: number): number {
  return Math.max(1, Math.min(24, Math.floor(months) || 1));
}

/**
 * Projects the effect of percentage changes to category spending on the monthly net and on savings goals.
 * Every figure is an estimate derived from *past average* spending in the lookback window, never a forecast.
 */
export function simulateWhatIf(
  adjustments: readonly WhatIfAdjustment[],
  transactions: readonly LedgerTransaction[],
  goals: readonly SavingsGoal[],
  lookbackMonths: number,
  referenceMonth: Date,
  today: string,
): WhatIfResult {
  const months = normalizeLookback(lookbackMonths);
  const start = startOfMonth(addMonths(referenceMonth, -(months - 1)));
  const end = endOfMonth(referenceMonth);
  const warnings: string[] = [];
  const monthsByCategory = new Map<string, Set<string>>();
  let incomeTotalMinor = 0;
  let transactionCount = 0;

  for (const transaction of transactions) {
    const occurredOn = parseISO(transaction.occurredOn);
    if (!isValid(occurredOn) || occurredOn < start || occurredOn > end) continue;
    transactionCount += 1;
    if (transaction.kind === "income") {
      incomeTotalMinor += Math.max(0, Math.round(transaction.amountMinor));
      continue;
    }
    const seenMonths = monthsByCategory.get(transaction.category) ?? new Set<string>();
    seenMonths.add(format(occurredOn, "yyyy-MM"));
    monthsByCategory.set(transaction.category, seenMonths);
  }

  const baselineAverages = calculateCategoryMonthlyAverages(transactions, months, referenceMonth);
  const changeByCategory = new Map<string, number>();
  for (const adjustment of adjustments) changeByCategory.set(adjustment.category, clampChangePercent(adjustment.changePercent));

  const baselineMonthlyIncomeMinor = Math.ceil(incomeTotalMinor / months);
  const baselineMonthlyExpenseMinor = baselineAverages.reduce((sum, item) => sum + item.averageMinor, 0);
  const scenarioMonthlyExpenseMinor = baselineAverages.reduce((sum, item) => {
    const changePercent = changeByCategory.get(item.category) ?? 0;
    return sum + Math.max(0, Math.round(item.averageMinor * (1 + changePercent / 100)));
  }, 0);
  const baselineMonthlyNetMinor = baselineMonthlyIncomeMinor - baselineMonthlyExpenseMinor;
  const scenarioMonthlyNetMinor = baselineMonthlyIncomeMinor - scenarioMonthlyExpenseMinor;

  if (transactionCount === 0) {
    warnings.push("No transaction history in this period yet, so there is nothing to project from.");
  } else {
    for (const [category, changePercent] of changeByCategory) {
      if (changePercent === 0) continue;
      const monthsOfHistory = monthsByCategory.get(category)?.size ?? 0;
      const label = getCategory(category).label;
      if (monthsOfHistory === 0) warnings.push(`No ${label} spending in this period, so changing it does not affect the projection.`);
      else if (monthsOfHistory < WHAT_IF_THIN_HISTORY_MONTHS) warnings.push(`Only ${monthsOfHistory} month(s) of ${label} history — this projection is a rough guide.`);
    }
    if (scenarioMonthlyNetMinor <= 0) warnings.push("Your projected spending still exceeds income, so no goal date can be estimated.");
  }

  const parsedToday = parseISO(today);
  const validToday = isValid(parsedToday);
  const paceToday = validToday ? parsedToday : startOfMonth(referenceMonth);
  const dateAfterMonths = (monthsAway: number | null) => monthsAway === null || !validToday ? null : format(addMonths(parsedToday, monthsAway), "yyyy-MM-dd");

  const goalProjections = goals.map((goal) => {
    const { remainingMinor } = calculateGoalPace(goal.targetMinor, goal.savedMinor, goal.targetDate ?? "", paceToday);
    const monthsToReach = (monthlyContributionMinor: number): number | null => {
      if (remainingMinor === 0) return 0;
      if (monthlyContributionMinor <= 0) return null;
      return Math.ceil(remainingMinor / monthlyContributionMinor);
    };
    const baselineMonths = monthsToReach(baselineMonthlyNetMinor);
    const scenarioMonths = monthsToReach(scenarioMonthlyNetMinor);

    return {
      goal,
      baselineMonths,
      scenarioMonths,
      monthsSaved: baselineMonths === null || scenarioMonths === null ? null : baselineMonths - scenarioMonths,
      baselineDate: dateAfterMonths(baselineMonths),
      scenarioDate: dateAfterMonths(scenarioMonths),
    };
  });

  return {
    baselineMonthlyExpenseMinor,
    scenarioMonthlyExpenseMinor,
    baselineMonthlyNetMinor,
    scenarioMonthlyNetMinor,
    deltaMinor: baselineMonthlyExpenseMinor - scenarioMonthlyExpenseMinor,
    goals: goalProjections,
    warnings,
  };
}
