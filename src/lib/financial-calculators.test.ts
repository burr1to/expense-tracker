import { describe, expect, it } from "vitest";
import { calculateCategoryMonthlyAverages, calculateDebtPayoff, calculateEmergencyFund, calculateEqualSplit, calculateGoalPace } from "./financial-calculators";

describe("financial calculators", () => {
  it("calculates category averages over a lookback window", () => {
    const result = calculateCategoryMonthlyAverages([
      { kind: "expense", category: "food", amountMinor: 900, occurredOn: "2026-01-10" },
      { kind: "expense", category: "food", amountMinor: 600, occurredOn: "2026-02-10" },
      { kind: "expense", category: "transport", amountMinor: 500, occurredOn: "2026-02-12" },
      { kind: "income", category: "salary", amountMinor: 10_000, occurredOn: "2026-02-12" },
    ], 3, new Date(2026, 1, 15));

    expect(result).toEqual([
      { category: "food", totalMinor: 1500, averageMinor: 500 },
      { category: "transport", totalMinor: 500, averageMinor: 167 },
    ]);
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
