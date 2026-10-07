import { differenceInCalendarMonths, format, isBefore, isValid, parseISO, startOfDay, startOfMonth } from "date-fns";
import { isLoanCategory } from "./categories";
import { todayInAppZone } from "./period";

export interface CalculatorTransaction {
  kind: "income" | "expense";
  category: string;
  amountMinor: number;
  occurredOn: string;
}

export interface CategoryMonthlyAverage {
  category: string;
  totalMinor: number;
  averageMinor: number;
}

export interface GoalPaceResult {
  remainingMinor: number;
  monthsRemaining: number;
  monthlyMinor: number;
  weeklyMinor: number;
  isComplete: boolean;
  isPastDue: boolean;
}

export interface DebtPayoffResult {
  months: number;
  totalPaidMinor: number;
  interestMinor: number;
  impossible: boolean;
}

export interface EmergencyFundResult {
  coveredMonths: number | null;
  targetMinor: number;
  shortfallMinor: number;
  monthlyContributionMinor: number;
}

export interface EqualSplitResult {
  subtotalMinor: number;
  tipMinor: number;
  totalMinor: number;
  sharesMinor: number[];
}

/** The completed months an average is built from. */
export interface AveragingWindow {
  /** Inclusive first day, `YYYY-MM-DD`. */
  start: string;
  /** Exclusive end: the first day of the current month, so the unfinished month never counts. */
  endExclusive: string;
  /** What totals are divided by: min(lookback, completed months since the first entry). 0 means no completed month yet. */
  months: number;
  /** `YYYY-MM` of the first and last month used, or null when `months` is 0. */
  firstMonth: string | null;
  lastMonth: string | null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const monthStartOf = (iso: string) => `${iso.slice(0, 7)}-01`;
const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const monthStartFromIndex = (index: number) => `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}-01`;
const normalizeLookback = (months: number) => Math.max(1, Math.min(24, Math.floor(months) || 1));

/**
 * The last `lookbackMonths` COMPLETED months before `today` (Kathmandu), never
 * the current or a future month, trimmed to start at the month of the first
 * entry. Dividing a partial month by a whole one made suggestions about a third
 * too low early in a month, and a new user's one month was divided by three.
 */
export function completedMonthsWindow(transactions: readonly { occurredOn: string }[], lookbackMonths: number, today: string = todayInAppZone()): AveragingWindow {
  const endExclusive = monthStartOf(today);
  let first: string | null = null;
  for (const transaction of transactions) {
    if (!DATE_ONLY.test(transaction.occurredOn) || transaction.occurredOn >= endExclusive) continue;
    if (first === null || transaction.occurredOn < first) first = transaction.occurredOn;
  }
  if (!first) return { start: endExclusive, endExclusive, months: 0, firstMonth: null, lastMonth: null };
  const endIndex = monthIndex(endExclusive);
  const startIndex = Math.max(endIndex - normalizeLookback(lookbackMonths), monthIndex(first));
  return {
    start: monthStartFromIndex(startIndex),
    endExclusive,
    months: endIndex - startIndex,
    firstMonth: monthStartFromIndex(startIndex).slice(0, 7),
    lastMonth: monthStartFromIndex(endIndex - 1).slice(0, 7),
  };
}

/** "Jul – Sep 2026", "Sep 2026" or "Nov 2025 – Jan 2026" for the months a window used. */
export function averagingWindowLabel(window: AveragingWindow): string {
  if (!window.firstMonth || !window.lastMonth) return "";
  const first = parseISO(`${window.firstMonth}-01`);
  const last = parseISO(`${window.lastMonth}-01`);
  if (window.firstMonth === window.lastMonth) return format(last, "MMM yyyy");
  return window.firstMonth.slice(0, 4) === window.lastMonth.slice(0, 4) ? `${format(first, "MMM")} – ${format(last, "MMM yyyy")}` : `${format(first, "MMM yyyy")} – ${format(last, "MMM yyyy")}`;
}

/** Average monthly spending per category over the completed months before `today`. Loan movements are not spending. */
export function calculateCategoryMonthlyAverages(transactions: readonly CalculatorTransaction[], months: number, today: string = todayInAppZone()): CategoryMonthlyAverage[] {
  const window = completedMonthsWindow(transactions, months, today);
  if (!window.months) return [];
  const totals = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.kind !== "expense" || isLoanCategory(transaction.category)) continue;
    if (transaction.occurredOn < window.start || transaction.occurredOn >= window.endExclusive || !DATE_ONLY.test(transaction.occurredOn)) continue;
    totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + Math.max(0, Math.round(transaction.amountMinor)));
  }

  return [...totals.entries()]
    .map(([category, totalMinor]) => ({ category, totalMinor, averageMinor: Math.ceil(totalMinor / window.months) }))
    .sort((left, right) => right.averageMinor - left.averageMinor);
}

export function calculateGoalPace(targetMinor: number, savedMinor: number, targetDate: string, today = new Date()): GoalPaceResult {
  const safeTargetMinor = Math.max(0, Math.round(targetMinor));
  const safeSavedMinor = Math.min(safeTargetMinor, Math.max(0, Math.round(savedMinor)));
  const remainingMinor = Math.max(0, safeTargetMinor - safeSavedMinor);
  const parsedTargetDate = parseISO(targetDate);
  const validTargetDate = isValid(parsedTargetDate);
  const isPastDue = validTargetDate && isBefore(parsedTargetDate, startOfDay(today));
  const monthsRemaining = remainingMinor === 0 ? 0 : validTargetDate ? Math.max(1, differenceInCalendarMonths(startOfMonth(parsedTargetDate), startOfMonth(today)) + 1) : 0;

  return {
    remainingMinor,
    monthsRemaining,
    monthlyMinor: monthsRemaining ? Math.ceil(remainingMinor / monthsRemaining) : 0,
    weeklyMinor: monthsRemaining ? Math.ceil(remainingMinor / (monthsRemaining * 4.345)) : 0,
    isComplete: remainingMinor === 0,
    isPastDue,
  };
}

export function calculateDebtPayoff(principalMinor: number, annualRatePercent: number, monthlyPaymentMinor: number): DebtPayoffResult {
  const principal = Math.max(0, Math.round(principalMinor));
  const payment = Math.max(0, Math.round(monthlyPaymentMinor));
  const monthlyRate = Math.max(0, annualRatePercent) / 1200;
  if (principal === 0) return { months: 0, totalPaidMinor: 0, interestMinor: 0, impossible: false };
  if (payment === 0 || (monthlyRate > 0 && payment <= Math.ceil(principal * monthlyRate))) return { months: 0, totalPaidMinor: 0, interestMinor: 0, impossible: true };

  let balance = principal;
  let months = 0;
  let totalPaidMinor = 0;
  let interestMinor = 0;
  while (balance > 0 && months < 1_200) {
    const interest = Math.round(balance * monthlyRate);
    const actualPayment = Math.min(payment, balance + interest);
    balance = balance + interest - actualPayment;
    interestMinor += interest;
    totalPaidMinor += actualPayment;
    months += 1;
  }

  return { months, totalPaidMinor, interestMinor, impossible: balance > 0 };
}

export function calculateEmergencyFund(savingsMinor: number, monthlyEssentialMinor: number, targetMonths: number): EmergencyFundResult {
  const savings = Math.max(0, Math.round(savingsMinor));
  const essential = Math.max(0, Math.round(monthlyEssentialMinor));
  const months = Math.max(1, Math.floor(targetMonths) || 1);
  const targetMinor = essential * months;
  const shortfallMinor = Math.max(0, targetMinor - savings);

  return {
    coveredMonths: essential > 0 ? savings / essential : null,
    targetMinor,
    shortfallMinor,
    monthlyContributionMinor: Math.ceil(shortfallMinor / months),
  };
}

export function calculateEqualSplit(subtotalMinor: number, people: number, tipPercent: number): EqualSplitResult {
  const subtotal = Math.max(0, Math.round(subtotalMinor));
  const numberOfPeople = Math.max(1, Math.floor(people) || 1);
  const tipMinor = Math.round(subtotal * Math.max(0, tipPercent) / 100);
  const totalMinor = subtotal + tipMinor;
  const evenShare = Math.floor(totalMinor / numberOfPeople);
  const remainder = totalMinor % numberOfPeople;
  const sharesMinor = Array.from({ length: numberOfPeople }, (_, index) => evenShare + (index < remainder ? 1 : 0));

  return { subtotalMinor: subtotal, tipMinor, totalMinor, sharesMinor };
}
