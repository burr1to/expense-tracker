import { describe, expect, it } from "vitest";
import { financialMilestones } from "./milestones";
import type { LedgerTransaction } from "../types";

const transaction = (id: string, occurredOn: string, kind: "income" | "expense", amountMinor: number): LedgerTransaction => ({ id, userId: "u1", occurredOn, kind, amountMinor, category: "other", note: id, subcategory: null, area: null, paymentMode: "cash", paymentAccountId: null, locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null, locationSource: null, savedPlaceId: null, createdAt: `${occurredOn}T00:00:00.000Z`, receipt: null });

describe("financial milestones", () => {
  it("identifies the first entry, largest movement, and best saving month", () => {
    const result = financialMilestones([transaction("first", "2026-06-01", "income", 20_000), transaction("rent", "2026-06-02", "expense", 5_000), transaction("salary", "2026-07-01", "income", 30_000)], []);
    expect(result.map((item) => item.id)).toEqual(expect.arrayContaining(["first-entry", "largest-entry", "best-month"]));
    expect(result.find((item) => item.id === "best-month")?.detail).toContain("July 2026");
  });
});
