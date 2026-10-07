import { parseISO } from "date-fns";
import { describe, expect, it } from "vitest";
import { buildMonthSnapshot, type MonthSnapshotInput } from "./month-snapshot";
import { calculateBudgetPacing } from "./planning-insights";
import type { Budget, DueItem, LedgerTransaction, RecurringEntry } from "../types";

const transaction = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: overrides.id ?? crypto.randomUUID(),
  userId: "user-1",
  kind: "expense",
  category: "food",
  amountMinor: 100_000,
  occurredOn: "2026-10-02",
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
  createdAt: "2026-10-02T00:00:00.000Z",
  ...overrides,
});
const recurring = (overrides: Partial<RecurringEntry>): RecurringEntry => ({
  id: overrides.id ?? crypto.randomUUID(),
  userId: "user-1",
  kind: "expense",
  category: "rent",
  amountMinor: 2_000_000,
  paymentAccountId: null,
  note: "",
  tags: [],
  dayOfMonth: 15,
  recurrenceUnit: "month",
  recurrenceInterval: 1,
  anchorDate: "2026-10-15",
  nextDueOn: "2026-10-15",
  active: true,
  ...overrides,
});
const budget = (overrides: Partial<Budget>): Budget => ({ id: crypto.randomUUID(), userId: "user-1", monthKey: "2026-10", category: "food", amountMinor: 1_000_000, ...overrides });

const october = parseISO("2026-10-01");
const snapshot = (overrides: Partial<MonthSnapshotInput> & { budgets?: Budget[]; dues?: DueItem[] } = {}) => {
  const { budgets = [], dues = [], ...rest } = overrides;
  const month = rest.month ?? october;
  const today = rest.today ?? "2026-10-07";
  const transactions = rest.transactions ?? [];
  const recurringEntries = rest.recurringEntries ?? [];
  return buildMonthSnapshot({
    month,
    today,
    transactions,
    recurringEntries,
    dueItems: dues,
    budgetPacing: calculateBudgetPacing(budgets, transactions, recurringEntries, dues, month, parseISO(today)),
    ...rest,
  });
};

describe("buildMonthSnapshot", () => {
  it("measures spending against the All spending budget and uses its daily allowance", () => {
    const result = snapshot({
      budgets: [budget({ category: "__total", amountMinor: 4_000_000 }), budget({ category: "food", amountMinor: 500_000 })],
      transactions: [transaction({ amountMinor: 1_000_000 }), transaction({ category: "transport", amountMinor: 500_000 }), transaction({ category: "loan", amountMinor: 9_000_000 })],
    });
    expect(result.timing).toBe("current");
    expect(result.spentMinor).toBe(1_500_000);
    expect(result.target).toEqual({ kind: "allSpending", limitMinor: 4_000_000, spentMinor: 1_500_000, percentage: 38 });
    // 2,500,000 left over the 25 days from Oct 7 to Oct 31.
    expect(result.budgetDailyMinor).toBe(100_000);
  });

  it("adds category budgets together when there is no All spending budget", () => {
    const result = snapshot({
      budgets: [budget({ category: "food", amountMinor: 1_000_000 }), budget({ category: "transport", amountMinor: 500_000 })],
      transactions: [transaction({ amountMinor: 400_000 }), transaction({ category: "transport", amountMinor: 100_000 }), transaction({ category: "shopping", amountMinor: 700_000 })],
    });
    expect(result.spentMinor).toBe(1_200_000);
    expect(result.target).toEqual({ kind: "categoryBudgets", limitMinor: 1_500_000, spentMinor: 500_000, percentage: 33, count: 2 });
    // Food leaves 600,000 and transport 400,000 for 25 days.
    expect(result.budgetDailyMinor).toBe(24_000 + 16_000);
  });

  it("compares with last month up to the same day when there is no budget", () => {
    const result = snapshot({
      transactions: [
        transaction({ amountMinor: 150_000, occurredOn: "2026-10-02" }),
        transaction({ amountMinor: 50_000, occurredOn: "2026-10-20" }),
        transaction({ amountMinor: 100_000, occurredOn: "2026-09-03" }),
        transaction({ amountMinor: 500_000, occurredOn: "2026-09-20" }),
        transaction({ category: "loan", amountMinor: 900_000, occurredOn: "2026-09-04" }),
      ],
    });
    expect(result.spentMinor).toBe(200_000);
    expect(result.target).toMatchObject({ kind: "previousMonth", currentMinor: 150_000, previousMinor: 100_000, throughDay: 7, changePercentage: 50 });
    expect(result.budgetDailyMinor).toBeNull();
  });

  it("stops last month at its own last day when this month runs longer", () => {
    const result = snapshot({ month: parseISO("2026-03-01"), today: "2026-03-31", transactions: [transaction({ occurredOn: "2026-02-28", amountMinor: 300_000 }), transaction({ occurredOn: "2026-03-30", amountMinor: 150_000 })] });
    expect(result.target).toMatchObject({ kind: "previousMonth", throughDay: 28, previousMinor: 300_000, currentMinor: 150_000, changePercentage: -50 });
  });

  it("has nothing to compare against when last month is empty", () => {
    const result = snapshot({ transactions: [transaction({ amountMinor: 150_000 })] });
    expect(result.target).toMatchObject({ kind: "previousMonth", previousMinor: 0, changePercentage: null });
  });

  it("projects the running month's net from logged and scheduled money, leaving loans out", () => {
    const result = snapshot({
      transactions: [
        transaction({ kind: "income", category: "salary", amountMinor: 5_000_000, occurredOn: "2026-10-01" }),
        transaction({ amountMinor: 1_000_000 }),
        transaction({ kind: "income", category: "loan", amountMinor: 10_000_000 }),
      ],
      recurringEntries: [recurring({}), recurring({ category: "loan", amountMinor: 700_000, nextDueOn: "2026-10-20", anchorDate: "2026-10-20", dayOfMonth: 20 })],
    });
    expect(result.netIsEstimate).toBe(true);
    expect(result.incomeMinor).toBe(5_000_000);
    expect(result.netMinor).toBe(5_000_000 - 1_000_000 - 2_000_000);
  });

  it("stops the projection at month end and leaves last month's unconfirmed occurrence in last month", () => {
    const result = snapshot({
      transactions: [transaction({ amountMinor: 1_000_000 })],
      recurringEntries: [
        // Rent due Oct 1 and not confirmed yet: counts once, never Nov 1 as well.
        recurring({ nextDueOn: "2026-10-01", anchorDate: "2026-10-01", dayOfMonth: 1 }),
        // Salary due Sep 30 and still unconfirmed: only October's (Oct 30) belongs to this month.
        recurring({ kind: "income", category: "salary", amountMinor: 6_000_000, nextDueOn: "2026-09-30", anchorDate: "2026-09-30", dayOfMonth: 30 }),
      ],
      dues: [
        { id: "due-1", userId: "user-1", kind: "payment", title: "Internet", person: "", amountMinor: 150_000, category: "bills", occurredOn: null, dueOn: "2026-10-20", remindOn: null, snoozedUntil: null, note: "", status: "open", annualRatePercent: null, completedOn: null, createdAt: "2026-10-01T00:00:00.000Z", payments: [], receipt: null },
        { id: "due-2", userId: "user-1", kind: "receivable", title: "Next month", person: "", amountMinor: 900_000, category: "other", occurredOn: null, dueOn: "2026-11-02", remindOn: null, snoozedUntil: null, note: "", status: "open", annualRatePercent: null, completedOn: null, createdAt: "2026-10-01T00:00:00.000Z", payments: [], receipt: null },
      ],
    });
    expect(result.netMinor).toBe(-1_000_000 - 2_000_000 + 6_000_000 - 150_000);
  });

  it("reports a finished month's actual net and compares with the whole previous month", () => {
    const result = snapshot({
      month: parseISO("2026-09-01"),
      transactions: [
        transaction({ kind: "income", category: "salary", amountMinor: 5_000_000, occurredOn: "2026-09-01" }),
        transaction({ amountMinor: 1_200_000, occurredOn: "2026-09-28" }),
        transaction({ amountMinor: 1_000_000, occurredOn: "2026-08-30" }),
      ],
      recurringEntries: [recurring({})],
    });
    expect(result.timing).toBe("past");
    expect(result.netIsEstimate).toBe(false);
    expect(result.netMinor).toBe(3_800_000);
    expect(result.target).toMatchObject({ kind: "previousMonth", throughDay: null, currentMinor: 1_200_000, previousMinor: 1_000_000, changePercentage: 20 });
    expect(result.budgetDailyMinor).toBeNull();
  });

  it("has no comparison for a month that has not started", () => {
    const result = snapshot({ month: parseISO("2026-11-01") });
    expect(result.timing).toBe("future");
    expect(result.target).toEqual({ kind: "none" });
  });

  it("names the budget that most needs attention", () => {
    const result = snapshot({
      budgets: [budget({ category: "food", amountMinor: 500_000 }), budget({ category: "transport", amountMinor: 200_000 }), budget({ category: "shopping", amountMinor: 1_000_000 })],
      transactions: [transaction({ amountMinor: 450_000 }), transaction({ category: "transport", amountMinor: 300_000 }), transaction({ category: "shopping", amountMinor: 100_000 })],
    });
    expect(result.riskiest?.budget.category).toBe("transport");
    expect(result.riskiest?.tone).toBe("over");
  });

  it("names no budget while every budget is healthy", () => {
    const result = snapshot({ budgets: [budget({ amountMinor: 5_000_000 })], transactions: [transaction({ amountMinor: 100_000 })] });
    expect(result.riskiest).toBeNull();
  });
});
