import { describe, expect, it } from "vitest";
import type { LedgerTransaction, SavedPlace } from "../types";
import { calculatePlaceSpendingTrends, placeTrendRanges, transactionPlaceKey } from "./place-spending-trends";

const transaction = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: overrides.id ?? crypto.randomUUID(),
  userId: "user-1",
  kind: "expense",
  category: "food",
  amountMinor: 100000,
  occurredOn: "2026-07-10",
  note: "",
  subcategory: null,
  area: "Thamel",
  paymentMode: "cash",
  paymentAccountId: null,
  locationLabel: "Favorite cafe",
  locationAddress: "Thamel, Kathmandu",
  locationLatitude: 27.715,
  locationLongitude: 85.312,
  locationAccuracy: null,
  locationSource: "saved",
  savedPlaceId: "cafe",
  createdAt: "2026-07-10T08:00:00.000Z",
  ...overrides,
});

const savedPlace: SavedPlace = {
  id: "cafe",
  userId: "user-1",
  name: "Morning Brew",
  icon: "food",
  address: "Thamel, Kathmandu",
  latitude: 27.715,
  longitude: 85.312,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: "2026-07-10T00:00:00.000Z",
};

describe("place spending trends", () => {
  it("builds equal rolling comparison windows", () => {
    expect(placeTrendRanges(1, new Date(2026, 6, 25))).toEqual({
      currentStartKey: "2026-06-26",
      currentEndKey: "2026-07-25",
      previousStartKey: "2026-05-26",
      previousEndKey: "2026-06-25",
    });
  });

  it("prefers saved place ids and falls back to stable coordinates", () => {
    expect(transactionPlaceKey(transaction({}))).toBe("cafe");
    expect(transactionPlaceKey(transaction({ savedPlaceId: null }))).toBe("27.71500-85.31200");
    expect(transactionPlaceKey(transaction({ savedPlaceId: null, locationLatitude: null, locationLongitude: null }))).toBeNull();
  });

  it("attributes increased spending to more purchases when the average is unchanged", () => {
    const trends = calculatePlaceSpendingTrends([
      transaction({ id: "old", occurredOn: "2026-06-10", amountMinor: 100000 }),
      transaction({ id: "new-1", occurredOn: "2026-07-02", amountMinor: 100000 }),
      transaction({ id: "new-2", occurredOn: "2026-07-12", amountMinor: 100000 }),
    ], [savedPlace], 1, new Date(2026, 6, 25));

    expect(trends).toHaveLength(1);
    expect(trends[0]).toMatchObject({
      label: "Morning Brew",
      currentTotalMinor: 200000,
      previousTotalMinor: 100000,
      currentPurchases: 2,
      previousPurchases: 1,
      totalChangePercent: 100,
      averageChangePercent: 0,
      driver: "frequency",
    });
  });

  it("attributes increased spending to average purchase cost when purchase count is unchanged", () => {
    const trends = calculatePlaceSpendingTrends([
      transaction({ id: "old-1", occurredOn: "2026-06-01", amountMinor: 80000 }),
      transaction({ id: "old-2", occurredOn: "2026-06-15", amountMinor: 80000 }),
      transaction({ id: "new-1", occurredOn: "2026-07-02", amountMinor: 120000 }),
      transaction({ id: "new-2", occurredOn: "2026-07-12", amountMinor: 120000 }),
    ], [savedPlace], 1, new Date(2026, 6, 25));

    expect(trends[0]).toMatchObject({
      currentPurchases: 2,
      previousPurchases: 2,
      currentAverageMinor: 120000,
      previousAverageMinor: 80000,
      averageChangePercent: 50,
      driver: "average",
    });
  });

  it("requires expenses in both periods and at least three observations", () => {
    const trends = calculatePlaceSpendingTrends([
      transaction({ id: "old", occurredOn: "2026-06-10" }),
      transaction({ id: "new", occurredOn: "2026-07-10" }),
      transaction({ id: "income", kind: "income", occurredOn: "2026-07-12" }),
    ], [savedPlace], 1, new Date(2026, 6, 25));

    expect(trends).toEqual([]);
  });
});
