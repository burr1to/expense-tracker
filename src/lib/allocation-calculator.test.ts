import { describe, expect, it } from "vitest";
import { calculateAllocationAmounts, minorToMajorInput } from "./allocation-calculator";

describe("allocation calculator", () => {
  it("splits an amount into the requested percentages", () => {
    expect(calculateAllocationAmounts(10000, [50, 30, 20])).toEqual([5000, 3000, 2000]);
  });

  it("keeps rounded row values equal to the rounded allocated amount", () => {
    const amounts = calculateAllocationAmounts(10001, [33.33, 33.33, 33.34]);

    expect(amounts).toEqual([3333, 3333, 3335]);
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(10001);
  });

  it("returns clean major-unit input values", () => {
    expect(minorToMajorInput(125000)).toBe("1250");
    expect(minorToMajorInput(125050)).toBe("1250.5");
  });
});
