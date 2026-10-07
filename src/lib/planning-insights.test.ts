import { describe, expect, it } from "vitest";
import { calculateBudgetPacing, calculateMonthlyBreathingRoom, calculateSafeToSpend, calculateSafeToSpendV2, committedBeforeHorizon, detectSpendingHorizon, recurringAwaitingConfirmation } from "./planning-insights";
import type { Budget, DueItem, LedgerTransaction, RecurringEntry } from "../types";
import { calculatePeriodBudgetPacing, calculateUnbudgetedSpending } from "./planning-insights";

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

describe("all-spending, festival and unbudgeted pacing", () => {
  const total: Budget = { id: "total", userId: "user-1", monthKey: "2026-07", category: "__total", amountMinor: 4000000 };
  const julyEntries = () => [
    transaction({ id: "food", category: "food", amountMinor: 700000 }),
    transaction({ id: "rent", category: "housing", amountMinor: 1500000 }),
    transaction({ id: "loan", category: "loan", amountMinor: 900000 }),
    transaction({ id: "ours", category: "shopping", amountMinor: 100000, shared: true }),
    transaction({ id: "salary", kind: "income", category: "salary", amountMinor: 5000000 }),
    transaction({ id: "august", category: "food", amountMinor: 50000, occurredOn: "2026-08-01" }),
  ];

  it("counts every personal expense against an All spending limit, except loan movements", () => {
    const result = calculateBudgetPacing([total], julyEntries(), [recurring({ category: "utilities" })], [due({ category: "health", amountMinor: 100000 })], new Date(2026, 6, 1), new Date(2026, 6, 10))[0];

    expect(result).toMatchObject({ spentMinor: 2200000, upcomingRecurringMinor: 200000, upcomingDuesMinor: 100000, projectedMinor: 2500000, remainingMinor: 1500000, remainingDays: 22, tone: "watch" });
    expect(result.dailyAllowanceMinor).toBe(Math.floor(1500000 / 22));
  });

  it("counts only entries marked Ours toward an Ours All spending limit", () => {
    expect(calculateBudgetPacing([{ ...total, shared: true }], julyEntries(), [], [], new Date(2026, 6, 1), new Date(2026, 6, 10))[0].spentMinor).toBe(100000);
  });

  it("names the overall limit when it is used up", () => {
    const result = calculateBudgetPacing([{ ...total, amountMinor: 2200000 }], julyEntries(), [], [], new Date(2026, 6, 1), new Date(2026, 6, 10))[0];

    expect(result.alertDetail).toBe("Your overall spending limit is fully used.");
  });

  describe("festival season budget", () => {
    const festival: Budget = { id: "fest", userId: "user-1", monthKey: "FEST:dashain-tihar-2083", category: "__total", amountMinor: 6100000 };
    const bounds = { start: "2026-09-17", endExclusive: "2026-11-17" };
    const entries = [
      transaction({ id: "before", occurredOn: "2026-09-16", amountMinor: 999 }),
      transaction({ id: "early", occurredOn: "2026-09-20", amountMinor: 1000000 }),
      transaction({ id: "today", occurredOn: "2026-10-07", amountMinor: 500000 }),
      transaction({ id: "after", occurredOn: "2026-11-17", amountMinor: 999 }),
    ];

    it("counts spending inside the season window and paces it by the days left", () => {
      const result = calculatePeriodBudgetPacing(festival, bounds, entries, [], [], "2026-10-07");

      expect(result).toMatchObject({ spentMinor: 1500000, elapsedPercentage: 34, remainingDays: 41, remainingMinor: 4600000, tone: "healthy" });
      expect(result.dailyAllowanceMinor).toBe(Math.floor(4600000 / 41));
    });

    it("describes pace against the season, not the month", () => {
      const result = calculatePeriodBudgetPacing(festival, bounds, [...entries, transaction({ id: "big", occurredOn: "2026-10-01", amountMinor: 2000000 })], [], [], "2026-10-07");

      expect(result.tone).toBe("watch");
      expect(result.alertDetail).toBe("57% used with 34% of the season elapsed.");
    });

    it("includes recurring bills and dues that fall inside the season", () => {
      const result = calculatePeriodBudgetPacing(festival, bounds, entries, [recurring({ anchorDate: "2026-10-20", nextDueOn: "2026-10-20" })], [due({ dueOn: "2026-11-01" }), due({ id: "late", dueOn: "2026-11-20" })], "2026-10-07");

      expect(result).toMatchObject({ upcomingRecurringMinor: 200000, upcomingDuesMinor: 200000 });
    });

    it("covers the whole season before it starts and nothing after it ends", () => {
      expect(calculatePeriodBudgetPacing(festival, bounds, entries, [], [], "2026-09-01")).toMatchObject({ elapsedPercentage: 0, remainingDays: 61 });
      expect(calculatePeriodBudgetPacing(festival, bounds, entries, [], [], "2026-12-01")).toMatchObject({ elapsedPercentage: 100, remainingDays: 0, dailyAllowanceMinor: 0 });
      expect(calculatePeriodBudgetPacing(festival, bounds, entries, [], [], "2026-11-16").remainingDays).toBe(1);
    });
  });

  it("lists spending no category budget counts, largest first", () => {
    const result = calculateUnbudgetedSpending([budget, total], [...julyEntries(), transaction({ id: "ours-food", category: "food", amountMinor: 200000, shared: true })], new Date(2026, 6, 1));

    expect(result).toEqual({ totalMinor: 1800000, categories: [{ category: "housing", totalMinor: 1500000 }, { category: "food", totalMinor: 200000 }, { category: "shopping", totalMinor: 100000 }] });
  });

  it("ignores budgets from other months when deciding what is budgeted", () => {
    expect(calculateUnbudgetedSpending([{ ...budget, monthKey: "2026-06" }], [transaction({})], new Date(2026, 6, 1)).totalMinor).toBe(700000);
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

  it("never takes loan repayments for a payday", () => {
    const repayments = ["2026-04-12", "2026-05-12", "2026-06-12"].map((occurredOn, index) =>
      transaction({ id: `repay-${index}`, kind: "income", category: "loan", occurredOn }));
    const horizon = detectSpendingHorizon([], repayments, new Date(2026, 6, 1), "2026-07-20");

    expect(horizon.source).toBe("periodEnd");
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

  it("still counts a recurring bill that fell due before today but is not confirmed", () => {
    const rent = recurring({ anchorDate: "2026-07-01", nextDueOn: "2026-07-01", amountMinor: 2_500_000 });

    // Rent from the 1st has not been recorded, so the balance still holds it; it is not free to spend.
    expect(committedBeforeHorizon([rent], [], horizon, "2026-07-20")).toBe(2_500_000);
    // A weekly bill two weeks behind counts every missed week plus the ones still ahead.
    expect(committedBeforeHorizon([recurring({ recurrenceUnit: "week", anchorDate: "2026-07-06", nextDueOn: "2026-07-06", amountMinor: 10000 })], [], horizon, "2026-07-20")).toBe(10000 * 4);
  });

  it("totals the recurring bills waiting to be confirmed, today's included", () => {
    expect(recurringAwaitingConfirmation([
      recurring({ id: "rent", anchorDate: "2026-07-01", nextDueOn: "2026-07-01", amountMinor: 2_500_000 }),
      recurring({ id: "wifi", nextDueOn: "2026-07-20", amountMinor: 150000 }),
      recurring({ id: "later", nextDueOn: "2026-07-25", amountMinor: 900000 }),
      recurring({ id: "salary", kind: "income", nextDueOn: "2026-07-01", amountMinor: 8_000_000 }),
      recurring({ id: "paused", nextDueOn: "2026-07-01", amountMinor: 700000, active: false }),
    ], "2026-07-20")).toBe(2_650_000);
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

  it("reports how much of the commitment is waiting to be confirmed", () => {
    expect(calculateSafeToSpendV2(1_000_000, 300_000, horizon, 0, 250_000)).toMatchObject({ committedMinor: 300_000, overdueRecurringMinor: 250_000, totalMinor: 700_000 });
    expect(calculateSafeToSpendV2(1_000_000, 300_000, horizon).overdueRecurringMinor).toBe(0);
  });
});
