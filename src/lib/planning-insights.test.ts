import { describe, expect, it } from "vitest";
import { calculateBudgetPacing, calculateMonthlyBreathingRoom } from "./planning-insights";
import type { Budget, DueItem, LedgerTransaction, RecurringEntry } from "../types";

const budget: Budget = { id: "budget-1", userId: "user-1", monthKey: "2026-07", category: "food", amountMinor: 1200000 };
const transaction = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: overrides.id ?? "transaction-1",
  userId: "user-1",
  kind: "expense",
  category: "food",
  amountMinor: 700000,
  occurredOn: "2026-07-10",
  note: "",
  subcategory: null,
  area: null,
  paymentMode: "cash",
  paymentAccountId: null,
  createdAt: "2026-07-10T00:00:00.000Z",
  ...overrides,
});
const recurring = (overrides: Partial<RecurringEntry>): RecurringEntry => ({
  id: overrides.id ?? "recurring-1",
  userId: "user-1",
  kind: "expense",
  category: "food",
  amountMinor: 200000,
  note: "",
  tags: [],
  dayOfMonth: 20,
  nextDueOn: "2026-07-20",
  active: true,
  ...overrides,
});
const due = (overrides: Partial<DueItem>): DueItem => ({
  id: overrides.id ?? "due-1",
  userId: "user-1",
  kind: "payment",
  title: "Groceries",
  person: "",
  amountMinor: 200000,
  category: "food",
  occurredOn: null,
  dueOn: "2026-07-25",
  remindOn: null,
  snoozedUntil: null,
  note: "",
  status: "open",
  completedOn: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  payments: [],
  ...overrides,
});

describe("budget pacing", () => {
  it("separates logged spending from upcoming recurring entries and dues", () => {
    const result = calculateBudgetPacing([budget], [transaction({})], [recurring({})], [due({})], new Date(2026, 6, 1), new Date(2026, 6, 10))[0];

    expect(result).toMatchObject({
      spentMinor: 700000,
      upcomingRecurringMinor: 200000,
      upcomingDuesMinor: 200000,
      upcomingMinor: 400000,
      projectedMinor: 1100000,
      spentPercentage: 58,
      projectedPercentage: 92,
      tone: "watch",
    });
    expect(result.dailyAllowanceMinor).toBe(Math.floor(100000 / 22));
  });

  it("uses only the unpaid remainder of a due and warns when projected over budget", () => {
    const partiallyPaid = due({ amountMinor: 500000, payments: [{ id: "payment-1", userId: "user-1", dueItemId: "due-1", amountMinor: 300000, occurredOn: "2026-07-08", note: "", transactionId: "transaction-paid", createdAt: "2026-07-08T00:00:00.000Z" }] });
    const result = calculateBudgetPacing([budget], [transaction({ amountMinor: 1100000 })], [], [partiallyPaid], new Date(2026, 6, 1), new Date(2026, 6, 10))[0];

    expect(result.upcomingDuesMinor).toBe(200000);
    expect(result.projectedMinor).toBe(1300000);
    expect(result.tone).toBe("warning");
    expect(result.alertTitle).toBe("Projected to exceed");
  });

  it("describes an exact projection as reaching rather than exceeding the limit", () => {
    const result = calculateBudgetPacing(
      [budget],
      [transaction({ amountMinor: 700000 })],
      [recurring({ amountMinor: 200000 })],
      [due({ amountMinor: 300000 })],
      new Date(2026, 6, 1),
      new Date(2026, 6, 10),
    )[0];

    expect(result.projectedMinor).toBe(budget.amountMinor);
    expect(result.tone).toBe("warning");
    expect(result.alertTitle).toBe("Projected to reach limit");
  });

  it("ignores completed, inactive, and out-of-month upcoming entries", () => {
    const result = calculateBudgetPacing(
      [budget],
      [],
      [recurring({ active: false }), recurring({ id: "august", nextDueOn: "2026-08-01" })],
      [due({ status: "completed" }), due({ id: "august-due", dueOn: "2026-08-02" })],
      new Date(2026, 6, 1),
      new Date(2026, 6, 10),
    )[0];

    expect(result.upcomingMinor).toBe(0);
  });
});

describe("monthly breathing room", () => {
  it("projects logged and upcoming income and expenses without mixing their states", () => {
    const result = calculateMonthlyBreathingRoom(
      [
        transaction({ id: "income", kind: "income", category: "salary", amountMinor: 8000000 }),
        transaction({ id: "expense", amountMinor: 2000000 }),
      ],
      [
        recurring({ id: "rent", category: "housing", amountMinor: 2500000 }),
        recurring({ id: "freelance", kind: "income", category: "freelance", amountMinor: 1000000 }),
      ],
      [
        due({ id: "bill", amountMinor: 1000000 }),
        due({ id: "receivable", kind: "receivable", amountMinor: 500000 }),
      ],
      new Date(2026, 6, 1),
    );

    expect(result).toEqual({
      loggedIncomeMinor: 8000000,
      loggedExpensesMinor: 2000000,
      upcomingIncomeMinor: 1500000,
      upcomingExpensesMinor: 3500000,
      projectedIncomeMinor: 9500000,
      projectedExpensesMinor: 5500000,
      projectedNetMinor: 4000000,
    });
  });
});
