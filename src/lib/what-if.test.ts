import { describe, expect, it } from "vitest";
import { simulateWhatIf } from "./what-if";
import type { LedgerTransaction, SavingsGoal } from "../types";

const transaction = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: overrides.id ?? "transaction-1",
  userId: "user-1",
  kind: "expense",
  category: "food",
  amountMinor: 60_000,
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

const goal = (overrides: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: "goal-1",
  userId: "user-1",
  name: "New laptop",
  targetMinor: 1_200_000,
  savedMinor: 0,
  targetDate: null,
  contributions: [],
  ...overrides,
});

// Day 1 of August: May, June and July are the three completed months.
const TODAY = "2026-08-01";
const HISTORY_MONTHS = ["2026-05-10", "2026-06-10", "2026-07-10"];

// Three full months: 300,000 income, 60,000 food and 30,000 transport every month.
const steadyHistory = (): LedgerTransaction[] => HISTORY_MONTHS.flatMap((occurredOn, index) => [
  transaction({ id: `income-${index}`, kind: "income", category: "salary", amountMinor: 300_000, occurredOn }),
  transaction({ id: `food-${index}`, category: "food", amountMinor: 60_000, occurredOn }),
  transaction({ id: `transport-${index}`, category: "transport", amountMinor: 30_000, occurredOn }),
]);

describe("simulateWhatIf", () => {
  it("frees up money and lowers projected expense when a category is cut", () => {
    const result = simulateWhatIf([{ category: "food", changePercent: -50 }], steadyHistory(), [], 3, TODAY);

    expect(result).toMatchObject({
      baselineMonthlyExpenseMinor: 90_000,
      scenarioMonthlyExpenseMinor: 60_000,
      baselineMonthlyNetMinor: 210_000,
      scenarioMonthlyNetMinor: 240_000,
      deltaMinor: 30_000,
    });
    expect(result.warnings).toEqual([]);
  });

  it("raises projected expense and reports a negative delta when a category grows", () => {
    const result = simulateWhatIf([{ category: "food", changePercent: 50 }], steadyHistory(), [], 3, TODAY);

    expect(result.scenarioMonthlyExpenseMinor).toBe(120_000);
    expect(result.scenarioMonthlyNetMinor).toBe(180_000);
    expect(result.deltaMinor).toBe(-30_000);
  });

  it("clamps a change beyond -100% and +100%", () => {
    const cut = simulateWhatIf([{ category: "food", changePercent: -400 }], steadyHistory(), [], 3, TODAY);
    const raise = simulateWhatIf([{ category: "food", changePercent: 400 }], steadyHistory(), [], 3, TODAY);

    expect(cut.scenarioMonthlyExpenseMinor).toBe(30_000);
    expect(cut.deltaMinor).toBe(60_000);
    expect(raise.scenarioMonthlyExpenseMinor).toBe(150_000);
    expect(raise.deltaMinor).toBe(-60_000);
  });

  it("moves a goal date earlier when a cut frees money each month", () => {
    const result = simulateWhatIf([{ category: "food", changePercent: -50 }], steadyHistory(), [goal()], 3, TODAY);

    expect(result.goals).toHaveLength(1);
    expect(result.goals[0]).toMatchObject({
      baselineMonths: 6,
      scenarioMonths: 5,
      monthsSaved: 1,
      baselineDate: "2027-02-01",
      scenarioDate: "2027-01-01",
    });
    expect(result.goals[0].goal.id).toBe("goal-1");
  });

  it("returns null instead of Infinity when the projected net is not positive", () => {
    const overspending = HISTORY_MONTHS.flatMap((occurredOn, index) => [
      transaction({ id: `income-${index}`, kind: "income", category: "salary", amountMinor: 80_000, occurredOn }),
      transaction({ id: `food-${index}`, category: "food", amountMinor: 60_000, occurredOn }),
      transaction({ id: `transport-${index}`, category: "transport", amountMinor: 30_000, occurredOn }),
    ]);

    const result = simulateWhatIf([{ category: "food", changePercent: -10 }], overspending, [goal()], 3, TODAY);

    expect(result.baselineMonthlyNetMinor).toBe(-10_000);
    expect(result.scenarioMonthlyNetMinor).toBe(-4_000);
    expect(result.goals[0]).toMatchObject({ baselineMonths: null, scenarioMonths: null, monthsSaved: null, baselineDate: null, scenarioDate: null });
    expect(result.warnings).toContain("Your projected spending still exceeds income, so no goal date can be estimated.");
  });

  it("warns when an adjusted category has fewer than three months of history", () => {
    const thin = [...steadyHistory(), transaction({ id: "shopping-1", category: "shopping", amountMinor: 45_000, occurredOn: "2026-07-12" })];

    const result = simulateWhatIf([{ category: "shopping", changePercent: -50 }], thin, [], 3, TODAY);

    expect(result.warnings).toContain("Only 1 month(s) of Shopping history — this projection is a rough guide.");
    expect(result.deltaMinor).toBe(7_500);
  });

  it("does not warn about thin history when the slider is left at zero", () => {
    const thin = [...steadyHistory(), transaction({ id: "shopping-1", category: "shopping", amountMinor: 45_000, occurredOn: "2026-07-12" })];

    expect(simulateWhatIf([{ category: "shopping", changePercent: 0 }], thin, [], 3, TODAY).warnings).toEqual([]);
  });

  it("returns zeroed figures rather than NaN when there is no history at all", () => {
    const result = simulateWhatIf([{ category: "food", changePercent: -50 }], [], [goal()], 3, TODAY);

    expect(result).toMatchObject({
      baselineMonthlyExpenseMinor: 0,
      scenarioMonthlyExpenseMinor: 0,
      baselineMonthlyNetMinor: 0,
      scenarioMonthlyNetMinor: 0,
      deltaMinor: 0,
    });
    expect(result.warnings).toEqual(["No transaction history in this period yet, so there is nothing to project from."]);
    expect(result.goals[0]).toMatchObject({ baselineMonths: null, scenarioMonths: null, monthsSaved: null });
  });

  it("treats an adjustment to a category with no spending as a no-op", () => {
    const history = steadyHistory();
    const baseline = simulateWhatIf([], history, [goal()], 3, TODAY);
    const result = simulateWhatIf([{ category: "not-a-real-category", changePercent: -100 }], history, [goal()], 3, TODAY);

    expect(result.scenarioMonthlyExpenseMinor).toBe(baseline.baselineMonthlyExpenseMinor);
    expect(result.deltaMinor).toBe(0);
    expect(result.goals[0].scenarioMonths).toBe(result.goals[0].baselineMonths);
    expect(result.warnings).toContain("No not-a-real-category spending in this period, so changing it does not affect the projection.");
  });

  it("leaves the unfinished month out, so an early salary does not inflate the baseline", () => {
    // Mid-July: the July salary has landed but only a little spending has.
    const history = [
      ...steadyHistory().filter((item) => item.occurredOn < "2026-07-01"),
      transaction({ id: "income-july", kind: "income", category: "salary", amountMinor: 300_000, occurredOn: "2026-07-01" }),
      transaction({ id: "food-july", category: "food", amountMinor: 5_000, occurredOn: "2026-07-03" }),
    ];

    const result = simulateWhatIf([], history, [], 3, "2026-07-15");

    expect(result.basedOn).toMatchObject({ firstMonth: "2026-05", lastMonth: "2026-06", months: 2 });
    expect(result).toMatchObject({ baselineMonthlyExpenseMinor: 90_000, baselineMonthlyNetMinor: 210_000 });
  });

  it("divides by the months since the first entry, not the full lookback", () => {
    const oneMonth = steadyHistory().filter((item) => item.occurredOn.startsWith("2026-07"));

    const result = simulateWhatIf([], oneMonth, [], 3, TODAY);

    expect(result.basedOn.months).toBe(1);
    expect(result).toMatchObject({ baselineMonthlyExpenseMinor: 90_000, baselineMonthlyNetMinor: 210_000 });
  });

  it("explains that only the current, unfinished month has history so far", () => {
    const result = simulateWhatIf([], [transaction({ occurredOn: "2026-08-01" })], [], 3, TODAY);

    expect(result.baselineMonthlyExpenseMinor).toBe(0);
    expect(result.warnings).toEqual(["No completed month of history yet. The projection starts once your first full month is logged."]);
  });

  it("reports a completed goal as reachable today under both scenarios", () => {
    const result = simulateWhatIf([{ category: "food", changePercent: -50 }], steadyHistory(), [goal({ savedMinor: 1_200_000 })], 3, TODAY);

    expect(result.goals[0]).toMatchObject({ baselineMonths: 0, scenarioMonths: 0, monthsSaved: 0, baselineDate: TODAY, scenarioDate: TODAY });
  });
});
