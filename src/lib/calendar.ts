import type { LedgerTransaction } from "../types";

export interface DailyCashFlow {
  income: number;
  expenses: number;
  net: number;
}

export function dailyCashFlow(transactions: readonly LedgerTransaction[]): Map<string, DailyCashFlow> {
  const totals = new Map<string, DailyCashFlow>();

  transactions.forEach((transaction) => {
    const current = totals.get(transaction.occurredOn) ?? { income: 0, expenses: 0, net: 0 };
    current[transaction.kind === "income" ? "income" : "expenses"] += transaction.amountMinor;
    current.net = current.income - current.expenses;
    totals.set(transaction.occurredOn, current);
  });

  return totals;
}
