import {
  addMonthsToKey,
  currentMonthKey as currentPeriodKey,
  isMonthKey,
  monthLabel,
  periodBounds,
  toStorageKey,
} from "./period";
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

export function monthlyReportNotice(now = new Date()) {
  const monthKey = previousMonthKey(now);
  return { monthKey, monthLabel: formatMonthLabel(monthKey), href: `/api/reports/monthly?month=${monthKey}` };
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
  const incomeMinor = sumKind(input.transactions, "income");
  const expenseMinor = sumKind(input.transactions, "expense");
  const previousIncomeMinor = sumKind(input.previousTransactions, "income");
  const previousExpenseMinor = sumKind(input.previousTransactions, "expense");
  const expenseTransactions = input.transactions.filter((item) => item.kind === "expense");
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
    incomeCategories: groupAmounts(input.transactions.filter((item) => item.kind === "income"), (item) => item.categoryLabel),
    subcategories: groupAmounts(expenseTransactions, (item) => item.subcategory?.trim() || "Unspecified"),
    budgets: input.budgets.map((budget) => {
      const spentMinor = spentByCategory.get(budget.category) ?? 0;
      return {
        ...budget,
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
