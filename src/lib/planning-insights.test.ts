import { describe, expect, it } from "vitest";
import { calculateBudgetPacing, calculateMonthlyBreathingRoom, calculateSafeToSpend, calculateSafeToSpendV2, committedBeforeHorizon, detectSpendingHorizon } from "./planning-insights";
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
  locationLabel: null,
  locationAddress: null,
  locationLatitude: null,
  locationLongitude: null,
  locationAccuracy: null,
  locationSource: null,
  savedPlaceId: null,
  createdAt: "2026-07-10T00:00:00.000Z",
  ...overrides,
});
const recurring = (overrides: Partial<RecurringEntry>): RecurringEntry => ({
  id: overrides.id ?? "recurring-1",
  userId: "user-1",
  kind: "expense",
  category: "food",
  amountMinor: 200000,
  paymentAccountId: null,
  note: "",
  tags: [],
  dayOfMonth: 20,
  recurrenceUnit: "month",
  recurrenceInterval: 1,
  anchorDate: "2026-07-20",
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
  annualRatePercent: null,
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

  it("counts every weekly occurrence in the selected month", () => {
    const result = calculateBudgetPacing(
      [{ ...budget, amountMinor: 2000000 }],
      [],
      [recurring({ recurrenceUnit: "week", recurrenceInterval: 1, anchorDate: "2026-07-01", nextDueOn: "2026-07-01" })],
      [],
      new Date(2026, 6, 1),
      new Date(2026, 6, 1),
    )[0];

    expect(result.upcomingRecurringMinor).toBe(1000000);
  });
});

describe("monthly breathing room", () => {
  it("calculates a safe-to-spend estimate from current balance and known commitments", () => {
    expect(calculateSafeToSpend(1000000, {
      loggedIncomeMinor: 0,
      loggedExpensesMinor: 0,
      upcomingIncomeMinor: 250000,
      upcomingExpensesMinor: 400000,
      projectedIncomeMinor: 250000,
      projectedExpensesMinor: 400000,
      projectedNetMinor: -150000,
    })).toBe(850000);
  });

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
      new Date(2026, 6, 20),
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

  it("includes a recurring payment due shortly after the current month", () => {
    const result = calculateMonthlyBreathingRoom(
      [],
      [recurring({ id: "emi", amountMinor: 380000, nextDueOn: "2026-08-04" })],
      [],
      new Date(2026, 6, 1),
      new Date(2026, 6, 20),
    );

    expect(result.upcomingExpensesMinor).toBe(380000);
  });
});

describe("spending horizon", () => {
  it("uses a scheduled income entry as payday", () => {
    const horizon = detectSpendingHorizon(
      [recurring({ id: "salary", kind: "income", category: "salary", nextDueOn: "2026-07-28" })],
      [],
      new Date(2026, 6, 1),
      "2026-07-20",
    );

    expect(horizon).toEqual({ throughDate: "2026-07-28", daysRemaining: 9, source: "payday" });
  });

  it("picks the earliest upcoming income when several are scheduled", () => {
    const horizon = detectSpendingHorizon([
      recurring({ id: "a", kind: "income", nextDueOn: "2026-08-05" }),
      recurring({ id: "b", kind: "income", nextDueOn: "2026-07-25" }),
    ], [], new Date(2026, 6, 1), "2026-07-20");

    expect(horizon.throughDate).toBe("2026-07-25");
  });

  it("ignores inactive and already-past income entries", () => {
    const horizon = detectSpendingHorizon([
      recurring({ id: "a", kind: "income", nextDueOn: "2026-07-28", active: false }),
      recurring({ id: "b", kind: "income", nextDueOn: "2026-07-01" }),
    ], [], new Date(2026, 6, 1), "2026-07-20");

    expect(horizon.source).not.toBe("payday");
  });

  it("falls back to a repeated income day in history", () => {
    const history = ["2026-04-05", "2026-05-05", "2026-06-05"].map((occurredOn, index) =>
      transaction({ id: `income-${index}`, kind: "income", category: "salary", occurredOn }));
    const horizon = detectSpendingHorizon([], history, new Date(2026, 6, 1), "2026-07-20");

    expect(horizon).toEqual({ throughDate: "2026-08-05", daysRemaining: 17, source: "incomePattern" });
  });

  it("ignores a one-off income date", () => {
    const horizon = detectSpendingHorizon([], [transaction({ kind: "income", occurredOn: "2026-06-05" })], new Date(2026, 6, 1), "2026-07-20");

    expect(horizon.source).toBe("periodEnd");
  });

  it("falls back to the end of the month", () => {
    const horizon = detectSpendingHorizon([], [], new Date(2026, 6, 1), "2026-07-20");

    expect(horizon).toEqual({ throughDate: "2026-07-31", daysRemaining: 12, source: "periodEnd" });
  });

  it("never reports fewer than one day remaining", () => {
    const horizon = detectSpendingHorizon([], [], new Date(2026, 6, 1), "2026-07-31");

    expect(horizon.daysRemaining).toBe(1);
  });
});

describe("committed before horizon", () => {
  const horizon = { throughDate: "2026-07-31", daysRemaining: 12, source: "periodEnd" as const };

  it("counts recurring expenses and open dues falling before the horizon", () => {
    const committed = committedBeforeHorizon(
      [recurring({ nextDueOn: "2026-07-25", amountMinor: 200000 })],
      [due({ dueOn: "2026-07-28", amountMinor: 150000 })],
      horizon,
      "2026-07-20",
    );

    expect(committed).toBe(350000);
  });

  it("excludes dues past the horizon and income entries", () => {
    const committed = committedBeforeHorizon(
      [recurring({ kind: "income", nextDueOn: "2026-07-25", amountMinor: 900000 })],
      [due({ dueOn: "2026-08-15", amountMinor: 150000 })],
      horizon,
      "2026-07-20",
    );

    expect(committed).toBe(0);
  });

  it("counts only what is still owed on a partly repaid due", () => {
    const committed = committedBeforeHorizon([], [due({
      dueOn: "2026-07-25",
      amountMinor: 200000,
      payments: [{ id: "p1", userId: "user-1", dueItemId: "due-1", amountMinor: 120000, occurredOn: "2026-07-21", note: "", transactionId: null, createdAt: "2026-07-21T00:00:00.000Z" }],
    })], horizon, "2026-07-20");

    expect(committed).toBe(80000);
  });

  it("ignores completed dues", () => {
    const committed = committedBeforeHorizon([], [due({ dueOn: "2026-07-25", status: "completed" })], horizon, "2026-07-20");

    expect(committed).toBe(0);
  });
});

describe("safe to spend v2", () => {
  const horizon = { throughDate: "2026-07-31", daysRemaining: 10, source: "periodEnd" as const };

  it("subtracts commitments and the buffer, then divides by days remaining", () => {
    const result = calculateSafeToSpendV2(1_000_000, 300_000, horizon, 200_000);

    expect(result).toMatchObject({ totalMinor: 500_000, perDayMinor: 50_000, committedMinor: 300_000, bufferMinor: 200_000 });
  });

  it("excludes income that has not arrived, unlike the month-total estimate", () => {
    // Balance alone, with nothing committed, is the whole allowance.
    expect(calculateSafeToSpendV2(400_000, 0, horizon).totalMinor).toBe(400_000);
  });

  it("reports a negative total but never a negative daily allowance", () => {
    const result = calculateSafeToSpendV2(100_000, 400_000, horizon);

    expect(result.totalMinor).toBe(-300_000);
    expect(result.perDayMinor).toBe(0);
  });

  it("rounds the daily allowance down so the horizon is never overspent", () => {
    expect(calculateSafeToSpendV2(99_999, 0, horizon).perDayMinor).toBe(9_999);
  });
});
