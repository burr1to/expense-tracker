import { describe, expect, it } from "vitest";
import { spendingPeriodRange } from "./spending-period";

describe("spendingPeriodRange", () => {
  const through = new Date(2026, 6, 25);

  it("uses an inclusive seven-day window for the default weekly period", () => {
    const range = spendingPeriodRange("weekly", through);
    expect(range.startKey).toBe("2026-07-19");
    expect(range.endKey).toBe("2026-07-25");
  });

  it("uses an inclusive fourteen-day window for the biweekly period", () => {
    expect(spendingPeriodRange("biweekly", through).startKey).toBe("2026-07-12");
  });

  it("supports rolling month, quarter, half-year, and year windows", () => {
    expect(spendingPeriodRange("monthly", through).startKey).toBe("2026-06-26");
    expect(spendingPeriodRange("quarterly", through).startKey).toBe("2026-04-26");
    expect(spendingPeriodRange("semiannual", through).startKey).toBe("2026-01-26");
    expect(spendingPeriodRange("annual", through).startKey).toBe("2025-07-26");
  });
});
