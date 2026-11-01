import { describe, expect, it } from "vitest";
import { averagingWindowLabel, calculateCategoryMonthlyAverages, calculateDebtPayoff, calculateEmergencyFund, calculateEqualSplit, calculateGoalPace, completedMonthsWindow } from "./financial-calculators";

describe("financial calculators", () => {
  const history = [
    { kind: "expense" as const, category: "food", amountMinor: 900, occurredOn: "2025-11-10" },
    { kind: "expense" as const, category: "food", amountMinor: 900, occurredOn: "2025-12-10" },
    { kind: "expense" as const, category: "food", amountMinor: 600, occurredOn: "2026-01-10" },
    { kind: "expense" as const, category: "transport", amountMinor: 500, occurredOn: "2026-01-12" },
    { kind: "income" as const, category: "salary", amountMinor: 10_000, occurredOn: "2026-01-12" },
    { kind: "expense" as const, category: "food", amountMinor: 5_000, occurredOn: "2026-02-03" },
  ];

  it("averages categories over the completed months only, never the unfinished one", () => {
    // Feb 15: Nov–Jan are complete; February's 5,000 is not counted.
    const result = calculateCategoryMonthlyAverages(history, 3, "2026-02-15");

    expect(result).toEqual([
      { category: "food", totalMinor: 2400, averageMinor: 800 },
      { category: "transport", totalMinor: 500, averageMinor: 167 },
    ]);
    expect(completedMonthsWindow(history, 3, "2026-02-15")).toEqual({ start: "2025-11-01", endExclusive: "2026-02-01", months: 3, firstMonth: "2025-11", lastMonth: "2026-01" });
  });

  it("treats the previous month as complete on day 1 of a month", () => {
    const window = completedMonthsWindow(history, 3, "2026-02-01");

    expect(window).toMatchObject({ start: "2025-11-01", endExclusive: "2026-02-01", months: 3 });
    expect(calculateCategoryMonthlyAverages(history, 3, "2026-02-01")[0]).toEqual({ category: "food", totalMinor: 2400, averageMinor: 800 });
  });

  it("divides a single month of history by one, not by the lookback", () => {
    const single = [{ kind: "expense" as const, category: "food", amountMinor: 30_000, occurredOn: "2026-09-12" }, { kind: "expense" as const, category: "food", amountMinor: 9_000, occurredOn: "2026-10-03" }];

    expect(completedMonthsWindow(single, 3, "2026-10-07")).toMatchObject({ months: 1, firstMonth: "2026-09", lastMonth: "2026-09" });
    expect(calculateCategoryMonthlyAverages(single, 3, "2026-10-07")).toEqual([{ category: "food", totalMinor: 30_000, averageMinor: 30_000 }]);
  });

  it("returns nothing before the first month is complete", () => {
    const fresh = [{ kind: "expense" as const, category: "food", amountMinor: 9_000, occurredOn: "2026-10-03" }];

    expect(completedMonthsWindow(fresh, 3, "2026-10-07")).toMatchObject({ months: 0, firstMonth: null, lastMonth: null });
    expect(calculateCategoryMonthlyAverages(fresh, 3, "2026-10-07")).toEqual([]);
  });

  it("caps the window at the lookback and skips loan movements", () => {
    const withLoan = [...history, { kind: "expense" as const, category: "loan", amountMinor: 50_000, occurredOn: "2026-01-20" }];

    expect(completedMonthsWindow(withLoan, 2, "2026-02-15")).toMatchObject({ start: "2025-12-01", months: 2 });
    expect(calculateCategoryMonthlyAverages(withLoan, 2, "2026-02-15").map((item) => item.category)).toEqual(["food", "transport"]);
  });

  it("labels the months a window used", () => {
    expect(averagingWindowLabel(completedMonthsWindow(history, 3, "2026-02-15"))).toBe("Nov 2025 – Jan 2026");
    expect(averagingWindowLabel(completedMonthsWindow(history, 2, "2026-03-15"))).toBe("Jan – Feb 2026");
    expect(averagingWindowLabel(completedMonthsWindow(history, 1, "2026-02-15"))).toBe("Jan 2026");
    expect(averagingWindowLabel(completedMonthsWindow([], 3, "2026-02-15"))).toBe("");
  });

  it("calculates the monthly pace needed to reach a goal", () => {
    expect(calculateGoalPace(10_000, 2_000, "2026-03-31", new Date(2026, 0, 15))).toMatchObject({
      remainingMinor: 8_000,
      monthsRemaining: 3,
      monthlyMinor: 2_667,
      weeklyMinor: 614,
      isComplete: false,
    });
  });

  it("detects debt payments that do not cover interest", () => {
    expect(calculateDebtPayoff(100_000, 12, 900)).toMatchObject({ impossible: true, months: 0 });
    expect(calculateDebtPayoff(100_000, 0, 25_000)).toMatchObject({ impossible: false, months: 4, totalPaidMinor: 100_000, interestMinor: 0 });
  });

  it("calculates emergency-fund coverage and shortfall", () => {
    expect(calculateEmergencyFund(2_000, 500, 6)).toEqual({ coveredMonths: 4, targetMinor: 3_000, shortfallMinor: 1_000, monthlyContributionMinor: 167 });
  });

  it("keeps equal bill shares balanced after tip and rounding", () => {
    const result = calculateEqualSplit(10_000, 3, 10);

    expect(result).toMatchObject({ subtotalMinor: 10_000, tipMinor: 1_000, totalMinor: 11_000 });
    expect(result.sharesMinor).toEqual([3_667, 3_667, 3_666]);
    expect(result.sharesMinor.reduce((sum, amount) => sum + amount, 0)).toBe(result.totalMinor);
  });
});
