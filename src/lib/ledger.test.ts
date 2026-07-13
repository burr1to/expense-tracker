import { describe, expect, it } from "vitest";
import type { LedgerTransaction } from "../types";
import { dailyExpenseSeries, summarizeLedger } from "./ledger";

const transaction = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: crypto.randomUUID(),
  userId: "user-1",
  kind: "expense",
  category: "food",
  amountMinor: 10000,
  occurredOn: "2026-07-11",
  note: "",
  tags: [],
  createdAt: "2026-07-11T09:00:00Z",
  ...overrides,
});

describe("summarizeLedger", () => {
  it("calculates income, expenses, savings, and category percentages", () => {
    const result = summarizeLedger([
      transaction({ kind: "income", category: "salary", amountMinor: 100000 }),
      transaction({ category: "food", amountMinor: 25000 }),
      transaction({ category: "transport", amountMinor: 15000 }),
    ]);

    expect(result.income).toBe(100000);
    expect(result.expenses).toBe(40000);
    expect(result.saved).toBe(60000);
    expect(result.savedPercentage).toBe(60);
    expect(result.categories[0]).toMatchObject({ category: "food", percentage: 63 });
  });

  it("does not divide by zero when no income has been logged", () => {
    expect(summarizeLedger([transaction({})]).savedPercentage).toBe(0);
  });
});

describe("dailyExpenseSeries", () => {
  it("groups expenses by day and ignores income", () => {
    const result = dailyExpenseSeries([
      transaction({ amountMinor: 1000 }),
      transaction({ amountMinor: 2500 }),
      transaction({ kind: "income", category: "salary", amountMinor: 9000 }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(3500);
  });
});
