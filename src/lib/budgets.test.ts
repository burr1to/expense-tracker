import { describe, expect, it } from "vitest";
import { ALL_SPENDING_CATEGORY, budgetAllowanceText, budgetCoversCategory, budgetLabel, buildBudgetCarryForward, shiftMonthKey } from "./budgets";
import { formatMoney } from "./currency";
import type { Budget, LedgerTransaction } from "../types";

const budget = (overrides: Partial<Budget>): Budget => ({ id: overrides.id ?? "budget-1", userId: "user-1", monthKey: "2026-09", category: "food", amountMinor: 1_500_000, ...overrides });
const expense = (occurredOn: string, category: string, amountMinor: number, overrides: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  id: `${category}-${occurredOn}-${amountMinor}`,
  userId: "user-1",
  kind: "expense",
  category,
  amountMinor,
  occurredOn,
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
  createdAt: `${occurredOn}T00:00:00.000Z`,
  ...overrides,
});

describe("all-spending budget", () => {
  it("covers every category except loan movements", () => {
    const total = { category: ALL_SPENDING_CATEGORY };

    expect(budgetCoversCategory(total, "food")).toBe(true);
    expect(budgetCoversCategory(total, "my-custom-category")).toBe(true);
    expect(budgetCoversCategory(total, "loan")).toBe(false);
    expect(budgetCoversCategory({ category: "food" }, "transport")).toBe(false);
  });

  it("has a readable label", () => {
    expect(budgetLabel(ALL_SPENDING_CATEGORY)).toBe("All spending");
    expect(budgetLabel("food")).toBe("Food & Dining");
  });
});

describe("budgetAllowanceText", () => {
  const pacing = (overrides: Partial<{ spentMinor: number; projectedMinor: number; remainingMinor: number; remainingDays: number; dailyAllowanceMinor: number }>) => ({ budget: { amountMinor: 4_000_000 }, spentMinor: 2_200_000, projectedMinor: 2_500_000, remainingMinor: 1_500_000, remainingDays: 22, dailyAllowanceMinor: 68_181, ...overrides });

  it("spreads what is left over the days to come", () => {
    expect(budgetAllowanceText(pacing({}), "NPR")).toBe(`${formatMoney(1_500_000, "NPR")} left · ${formatMoney(68_181, "NPR")}/day for 22 days`);
    expect(budgetAllowanceText(pacing({ remainingDays: 1, dailyAllowanceMinor: 1_500_000 }), "NPR")).toMatch(/for 1 day$/);
  });

  it("drops the daily figure once the month is over", () => {
    expect(budgetAllowanceText(pacing({ remainingDays: 0, dailyAllowanceMinor: 0 }), "NPR")).toBe(`${formatMoney(1_500_000, "NPR")} left`);
  });

  it("says how far over the limit spending went, or that upcoming bills take the rest", () => {
    expect(budgetAllowanceText(pacing({ spentMinor: 4_250_000, projectedMinor: 4_250_000, remainingMinor: 0, dailyAllowanceMinor: 0 }), "NPR")).toBe(`${formatMoney(250_000, "NPR")} over the limit`);
    expect(budgetAllowanceText(pacing({ spentMinor: 3_900_000, projectedMinor: 4_100_000, remainingMinor: 0, dailyAllowanceMinor: 0 }), "NPR")).toBe("Upcoming bills use what is left");
    expect(budgetAllowanceText(pacing({ spentMinor: 4_000_000, projectedMinor: 4_000_000, remainingMinor: 0, dailyAllowanceMinor: 0 }), "NPR")).toBe("Limit fully used");
  });
});

describe("shiftMonthKey", () => {
  it("steps across a year boundary", () => {
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
  });

  it("steps a BS key in the BS calendar, and refuses festival keys", () => {
    expect(shiftMonthKey("BS:2083-06", -1)).toBe("BS:2083-05");
    expect(shiftMonthKey("BS:2083-01", -1)).toBe("BS:2082-12");
    expect(() => shiftMonthKey("FEST:dashain-tihar-2083", -1)).toThrow(/Invalid month key/);
  });
});

describe("buildBudgetCarryForward", () => {
  const budgets = [
    budget({ id: "food", category: "food", amountMinor: 1_500_000 }),
    budget({ id: "total", category: ALL_SPENDING_CATEGORY, amountMinor: 4_000_000 }),
    budget({ id: "ours", category: "housing", amountMinor: 2_000_000, shared: true }),
    budget({ id: "partner", userId: "user-2", category: "travel", amountMinor: 900_000, shared: true }),
    budget({ id: "older", monthKey: "2026-08", category: "shopping", amountMinor: 500_000 }),
  ];
  const transactions = [
    expense("2026-07-05", "food", 1_200_000),
    expense("2026-08-05", "food", 1_500_000),
    expense("2026-09-05", "food", 1_800_000),
    expense("2026-09-06", "housing", 2_000_000, { shared: true }),
    expense("2026-09-07", "loan", 700_000),
    expense("2026-10-02", "food", 50_000),
  ];

  it("offers last month's own budgets with last month's actual and a completed-month average", () => {
    const plan = buildBudgetCarryForward(budgets, transactions, "2026-10", "user-1", "2026-10-07")!;

    expect(plan.previousMonthKey).toBe("2026-09");
    expect(plan.averageWindow).toMatchObject({ firstMonth: "2026-07", lastMonth: "2026-09", months: 3 });
    expect(plan.rows).toEqual([
      { category: ALL_SPENDING_CATEGORY, shared: false, lastLimitMinor: 4_000_000, lastActualMinor: 1_800_000, averageMinor: 1_500_000 },
      { category: "housing", shared: true, lastLimitMinor: 2_000_000, lastActualMinor: 2_000_000, averageMinor: 666_667 },
      { category: "food", shared: false, lastLimitMinor: 1_500_000, lastActualMinor: 1_800_000, averageMinor: 1_500_000 },
    ]);
  });

  it("averages over completed months only on the first day of a month", () => {
    const plan = buildBudgetCarryForward(budgets, [...transactions, expense("2026-10-01", "food", 9_000_000)], "2026-10", "user-1", "2026-10-01")!;

    expect(plan.rows.find((row) => row.category === "food")?.averageMinor).toBe(1_500_000);
  });

  it("uses one month of history as it is rather than dividing it by three", () => {
    const plan = buildBudgetCarryForward(budgets, [expense("2026-09-05", "food", 1_800_000)], "2026-10", "user-1", "2026-10-07")!;

    expect(plan.averageWindow.months).toBe(1);
    expect(plan.rows.find((row) => row.category === "food")?.averageMinor).toBe(1_800_000);
  });

  it("has no average before the first month is complete", () => {
    const plan = buildBudgetCarryForward(budgets, [expense("2026-10-02", "food", 50_000)], "2026-10", "user-1", "2026-10-07")!;

    expect(plan.rows.every((row) => row.averageMinor === null)).toBe(true);
  });

  it("offers nothing once the month has one of the viewer's budgets", () => {
    expect(buildBudgetCarryForward([...budgets, budget({ id: "new", monthKey: "2026-10" })], transactions, "2026-10", "user-1", "2026-10-07")).toBeNull();
  });

  it("still offers when only a partner's shared budget is in the month", () => {
    expect(buildBudgetCarryForward([...budgets, budget({ id: "theirs", userId: "user-2", monthKey: "2026-10", shared: true })], transactions, "2026-10", "user-1", "2026-10-07")).not.toBeNull();
  });

  it("offers nothing when last month had no budgets or the month is already over", () => {
    expect(buildBudgetCarryForward(budgets, transactions, "2026-12", "user-1", "2026-10-07")).toBeNull();
    expect(buildBudgetCarryForward(budgets, transactions, "2026-09", "user-1", "2026-10-07")).toBeNull();
  });

  it("can prepare next month ahead of time", () => {
    const plan = buildBudgetCarryForward([...budgets, budget({ id: "oct", monthKey: "2026-10" })], transactions, "2026-11", "user-1", "2026-10-07")!;

    expect(plan.previousMonthKey).toBe("2026-10");
    expect(plan.rows).toEqual([{ category: "food", shared: false, lastLimitMinor: 1_500_000, lastActualMinor: 50_000, averageMinor: 1_500_000 }]);
  });
});
