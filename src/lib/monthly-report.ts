import {
  addMonthsToKey,
  currentMonthKey as currentPeriodKey,
  isMonthKey,
  monthLabel,
  periodBounds,
  toStorageKey,
  todayInAppZone,
} from "./period";
import { countsAsIncomeOrSpending } from "./categories";
import { ALL_SPENDING_CATEGORY, ALL_SPENDING_LABEL } from "./budgets";
import type { CurrencyCode } from "../types";

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface MonthlyReportTransaction {
  id: string;
  kind: "income" | "expense";
  category: string;
  categoryLabel: string;
  amountMinor: number;
  occurredOn: string;
  note: string;
  subcategory: string | null;
  paymentMode: string;
  paymentAccountId: string | null;
}
export interface MonthlyReportBudget {
  category: string;
  categoryLabel: string;
  amountMinor: number;
}

export interface MonthlyReportAccount {
  id: string;
  label: string;
  balanceMinor: number;
  balanceAsOf: string;
}

export interface MonthlyReportTransfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinor: number;
  occurredOn: string;
  note: string;
}

export interface MonthlyReportDue {
  id: string;
  title: string;
  kind: string;
  amountMinor: number;
  dueOn: string;
  status: string;
  completedOn: string | null;
  paidMinor: number;
}

export interface MonthlyReportRecurring {
  id: string;
  kind: "income" | "expense";
  categoryLabel: string;
  amountMinor: number;
  note: string;
  scheduleLabel: string;
  nextDueOn: string;
  active: boolean;
}

export interface MonthlyReportInput {
  monthKey: string;
  displayName: string;
  currency: CurrencyCode;
  transactions: MonthlyReportTransaction[];
  previousTransactions: MonthlyReportTransaction[];
  budgets: MonthlyReportBudget[];
  accounts: MonthlyReportAccount[];
  transfers: MonthlyReportTransfer[];
  dues: MonthlyReportDue[];
  recurring: MonthlyReportRecurring[];
}

interface AmountGroup {
  label: string;
  amountMinor: number;
  count: number;
}

export interface MonthlyReport {
  monthKey: string;
  monthLabel: string;
  displayName: string;
  currency: CurrencyCode;
  generatedOn: string;
  summary: {
    incomeMinor: number;
    expenseMinor: number;
    netMinor: number;
    savingsRate: number;
    transactionCount: number;
    incomeChangePercentage: number | null;
    expenseChangePercentage: number | null;
  };
  categories: AmountGroup[];
  incomeCategories: AmountGroup[];
  subcategories: AmountGroup[];
  budgets: Array<MonthlyReportBudget & { spentMinor: number; remainingMinor: number; usedPercentage: number }>;
  accounts: Array<MonthlyReportAccount & { incomeMinor: number; expenseMinor: number; transfersInMinor: number; transfersOutMinor: number }>;
  transfers: MonthlyReportTransfer[];
  dues: MonthlyReportDue[];
  recurring: MonthlyReportRecurring[];
  transactions: MonthlyReportTransaction[];
}

export function currentMonthKey(now = new Date()) {
  return toStorageKey(currentPeriodKey("AD", now));
}

export function previousMonthKey(now = new Date()) {
  return toStorageKey(addMonthsToKey(currentPeriodKey("AD", now), -1));
}

export function isCompletedReportMonth(monthKey: string, now = new Date()) {
  return MONTH_KEY.test(monthKey) && monthKey < currentMonthKey(now);
}

/** How many days into a month the bell keeps offering last month's report. */
export const MONTHLY_REPORT_NOTICE_DAYS = 7;

/** localStorage key that remembers a dismissed or downloaded report notice, per user and month. */
export function monthlyReportNoticeStorageKey(userId: string, monthKey: string) {
  return `syr:monthly-report-notice:${userId}:${monthKey}`;
}

/**
 * "Last month's report is ready": only during the first week of a Kathmandu
 * month, and only when the viewer logged something last month (the PDF covers
 * their own entries). Dismissal is remembered with `monthlyReportNoticeStorageKey`.
 */
export function monthlyReportNotice(transactions: readonly { occurredOn: string; userId?: string }[], { now = new Date(), viewerId }: { now?: Date; viewerId?: string } = {}) {
  if (Number(todayInAppZone(now).slice(8, 10)) > MONTHLY_REPORT_NOTICE_DAYS) return null;
  const monthKey = previousMonthKey(now);
  const { start, endExclusive } = periodBounds(monthKey);
  if (!transactions.some((item) => (!viewerId || item.userId === viewerId) && item.occurredOn >= start && item.occurredOn < endExclusive)) return null;
  return { monthKey, monthLabel: formatMonthLabel(monthKey), href: `/api/reports/monthly?month=${monthKey}`, storageKey: viewerId ? monthlyReportNoticeStorageKey(viewerId, monthKey) : null };
}

export function reportMonthBounds(monthKey: string) {
  if (!isMonthKey(monthKey)) throw new Error("Invalid report month.");
  return periodBounds(monthKey);
}

export function precedingMonthKey(monthKey: string) {
  if (!isMonthKey(monthKey)) throw new Error("Invalid report month.");
  return toStorageKey(addMonthsToKey(monthKey, -1));
}

export function formatMonthLabel(monthKey: string) {
  if (!isMonthKey(monthKey)) throw new Error("Invalid report month.");
  return monthLabel(monthKey);
}

function sumKind(items: readonly MonthlyReportTransaction[], kind: "income" | "expense") {
  return items.filter((item) => item.kind === kind).reduce((sum, item) => sum + item.amountMinor, 0);
}

function percentageChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

function groupAmounts(items: readonly MonthlyReportTransaction[], key: (item: MonthlyReportTransaction) => string) {
  const groups = new Map<string, AmountGroup>();
  for (const item of items) {
    const label = key(item);
    const current = groups.get(label) ?? { label, amountMinor: 0, count: 0 };
    current.amountMinor += item.amountMinor;
    current.count += 1;
    groups.set(label, current);
  }
  return [...groups.values()].sort((a, b) => b.amountMinor - a.amountMinor);
}

export function buildMonthlyReport(input: MonthlyReportInput, now = new Date()): MonthlyReport {
  // Loans and repayments move account balances (kept below) but are never income or spending.
  const counted = input.transactions.filter(countsAsIncomeOrSpending);
  const previousCounted = input.previousTransactions.filter(countsAsIncomeOrSpending);
  const incomeMinor = sumKind(counted, "income");
  const expenseMinor = sumKind(counted, "expense");
  const previousIncomeMinor = sumKind(previousCounted, "income");
  const previousExpenseMinor = sumKind(previousCounted, "expense");
  const expenseTransactions = counted.filter((item) => item.kind === "expense");
  const spentByCategory = new Map(groupAmounts(expenseTransactions, (item) => item.category).map((item) => [item.label, item.amountMinor]));

  return {
    monthKey: input.monthKey,
    monthLabel: formatMonthLabel(input.monthKey),
    displayName: input.displayName,
    currency: input.currency,
    generatedOn: now.toISOString(),
    summary: {
      incomeMinor,
      expenseMinor,
      netMinor: incomeMinor - expenseMinor,
      savingsRate: incomeMinor > 0 ? Math.round(((incomeMinor - expenseMinor) / incomeMinor) * 100) : 0,
      transactionCount: input.transactions.length,
      incomeChangePercentage: percentageChange(incomeMinor, previousIncomeMinor),
      expenseChangePercentage: percentageChange(expenseMinor, previousExpenseMinor),
    },
    categories: groupAmounts(expenseTransactions, (item) => item.categoryLabel),
    incomeCategories: groupAmounts(counted.filter((item) => item.kind === "income"), (item) => item.categoryLabel),
    subcategories: groupAmounts(expenseTransactions, (item) => item.subcategory?.trim() || "Unspecified"),
    budgets: input.budgets.map((budget) => {
      // An "All spending" limit counts every expense the report counts.
      const allSpending = budget.category === ALL_SPENDING_CATEGORY;
      const spentMinor = allSpending ? expenseMinor : spentByCategory.get(budget.category) ?? 0;
      return {
        ...budget,
        ...(allSpending ? { categoryLabel: ALL_SPENDING_LABEL } : {}),
        spentMinor,
        remainingMinor: budget.amountMinor - spentMinor,
        usedPercentage: Math.round((spentMinor / budget.amountMinor) * 100),
      };
    }).sort((a, b) => b.usedPercentage - a.usedPercentage),
    accounts: input.accounts.map((account) => {
      const accountTransactions = input.transactions.filter((item) => item.paymentAccountId === account.id);
      return {
        ...account,
        incomeMinor: sumKind(accountTransactions, "income"),
        expenseMinor: sumKind(accountTransactions, "expense"),
        transfersInMinor: input.transfers.filter((item) => item.toAccountId === account.id).reduce((sum, item) => sum + item.amountMinor, 0),
        transfersOutMinor: input.transfers.filter((item) => item.fromAccountId === account.id).reduce((sum, item) => sum + item.amountMinor, 0),
      };
    }),
    transfers: [...input.transfers].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)),
    dues: [...input.dues].sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
    recurring: input.recurring.filter((item) => item.active).sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn)),
    transactions: [...input.transactions].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id)),
  };
}
