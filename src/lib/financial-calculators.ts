import { addMonths, differenceInCalendarMonths, endOfMonth, isBefore, isValid, parseISO, startOfDay, startOfMonth } from "date-fns";

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

export function calculateCategoryMonthlyAverages(transactions: readonly CalculatorTransaction[], months: number, referenceMonth: Date): CategoryMonthlyAverage[] {
  const lookbackMonths = Math.max(1, Math.min(24, Math.floor(months) || 1));
  const start = startOfMonth(addMonths(referenceMonth, -(lookbackMonths - 1)));
  const end = endOfMonth(referenceMonth);
  const totals = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.kind !== "expense") continue;
    const occurredOn = parseISO(transaction.occurredOn);
    if (!isValid(occurredOn) || occurredOn < start || occurredOn > end) continue;
    totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + Math.max(0, Math.round(transaction.amountMinor)));
  }

  return [...totals.entries()]
    .map(([category, totalMinor]) => ({ category, totalMinor, averageMinor: Math.ceil(totalMinor / lookbackMonths) }))
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
