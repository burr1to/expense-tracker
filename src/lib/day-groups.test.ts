import { describe, expect, it } from "vitest";
import type { AccountTransfer, LedgerTransaction } from "../types";
import { dayGroupLabel, groupLedgerActivityByDay, takeWholeDays } from "./day-groups";
import type { LedgerActivityItem } from "./transaction-history";

const transaction = (overrides: Partial<LedgerTransaction>): LedgerActivityItem => ({ type: "transaction", transaction: {
  id: crypto.randomUUID(), userId: "user-1", kind: "expense", category: "food", amountMinor: 10000,
  occurredOn: "2026-11-04", note: "Lunch", subcategory: null, area: null, paymentMode: "cash", paymentAccountId: null,
  locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null,
  locationSource: null, savedPlaceId: null, createdAt: "2026-11-04T09:00:00Z", ...overrides,
} });

const transfer = (overrides: Partial<AccountTransfer>): LedgerActivityItem => ({ type: "transfer", transfer: {
  id: crypto.randomUUID(), userId: "user-1", fromAccountId: "a", toAccountId: "b", amountMinor: 2000000,
  occurredOn: "2026-11-03", note: "", createdAt: "2026-11-03T10:00:00Z", ...overrides,
} });

describe("groupLedgerActivityByDay", () => {
  it("keeps the newest-first order and totals each day without counting transfers as spending", () => {
    const groups = groupLedgerActivityByDay([
      transaction({ amountMinor: 45000 }),
      transaction({ amountMinor: 21000 }),
      transaction({ occurredOn: "2026-11-03", kind: "income", category: "salary", amountMinor: 8500000 }),
      transfer({}),
      transaction({ occurredOn: "2026-11-03", amountMinor: 341500 }),
    ]);
    expect(groups.map((group) => [group.dayKey, group.items.length, group.spentMinor, group.earnedMinor, group.movedMinor])).toEqual([
      ["2026-11-04", 2, 66000, 0, 0],
      ["2026-11-03", 3, 341500, 8500000, 2000000],
    ]);
  });
});

describe("takeWholeDays", () => {
  it("adds whole days until the page size is reached, never splitting one", () => {
    const groups = groupLedgerActivityByDay([
      transaction({}), transaction({}),
      transaction({ occurredOn: "2026-11-03" }), transaction({ occurredOn: "2026-11-03" }), transaction({ occurredOn: "2026-11-03" }),
      transaction({ occurredOn: "2026-11-02" }),
    ]);
    expect(takeWholeDays(groups, 3).map((group) => group.dayKey)).toEqual(["2026-11-04", "2026-11-03"]);
    expect(takeWholeDays(groups, 2).map((group) => group.dayKey)).toEqual(["2026-11-04"]);
    expect(takeWholeDays(groups, 50)).toHaveLength(3);
  });
});

describe("dayGroupLabel", () => {
  it("names recent days relatively and older days by a short weekday", () => {
    expect(dayGroupLabel("2026-11-04", "2026-11-04")).toBe("Today");
    expect(dayGroupLabel("2026-11-03", "2026-11-04")).toBe("Yesterday");
    expect(dayGroupLabel("2026-11-01", "2026-11-04")).toBe("Sunday");
    expect(dayGroupLabel("2026-10-28", "2026-11-04")).toBe("Wed");
    expect(dayGroupLabel("2026-03-01", "2026-03-02")).toBe("Yesterday");
  });
});
