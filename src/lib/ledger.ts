import { format, parseISO } from "date-fns";
import { getCategory } from "./categories";
import type { CustomCategory, LedgerTransaction, TransactionCategory } from "../types";

export interface CategoryTotal {
  category: TransactionCategory;
  label: string;
  value: number;
  color: string;
  percentage: number;
}

export interface LedgerSummary {
  income: number;
  expenses: number;
  saved: number;
  savedPercentage: number;
  categories: CategoryTotal[];
}

export function summarizeLedger(transactions: readonly LedgerTransaction[], customCategories: readonly CustomCategory[] = []): LedgerSummary {
  let income = 0;
  let expenses = 0;
  const totals = new Map<TransactionCategory, number>();

  for (const transaction of transactions) {
    if (transaction.kind === "income") {
      income += transaction.amountMinor;
    } else {
      expenses += transaction.amountMinor;
      totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + transaction.amountMinor);
    }
  }

  const categories = [...totals.entries()]
    .map(([category, value]) => {
      const definition = getCategory(category, customCategories);
      return {
        category,
        label: definition.label,
        value,
        color: definition.color,
        percentage: expenses > 0 ? Math.round((value / expenses) * 100) : 0,
      };
    })
    .sort((a, b) => b.value - a.value);

  return {
    income,
    expenses,
    saved: income - expenses,
    savedPercentage: income > 0 ? Math.round(((income - expenses) / income) * 100) : 0,
    categories,
  };
}

export function dailyExpenseSeries(transactions: readonly LedgerTransaction[]) {
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.kind === "expense") {
      totals.set(transaction.occurredOn, (totals.get(transaction.occurredOn) ?? 0) + transaction.amountMinor);
    }
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amount]) => ({ date, label: format(parseISO(date), "MMM d"), amount }));
}

export function monthlySeries(transactions: readonly LedgerTransaction[]) {
  const months = new Map<string, { income: number; expenses: number }>();
  for (const transaction of transactions) {
    const key = transaction.occurredOn.slice(0, 7);
    const current = months.get(key) ?? { income: 0, expenses: 0 };
    current[transaction.kind === "income" ? "income" : "expenses"] += transaction.amountMinor;
    months.set(key, current);
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([key, values]) => ({ month: format(parseISO(`${key}-01`), "MMM"), ...values, saved: values.income - values.expenses }));
}
