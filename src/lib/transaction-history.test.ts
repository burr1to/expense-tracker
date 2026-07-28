import { describe, expect, it } from "vitest";
import type { LedgerTransaction } from "../types";
import { filterTransactionHistory, type TransactionHistoryFilters } from "./transaction-history";

const transaction = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: crypto.randomUUID(), userId: "user-1", kind: "expense", category: "food", amountMinor: 10000,
  occurredOn: "2026-07-11", note: "Lunch", subcategory: null, area: null, paymentMode: "cash", paymentAccountId: null,
  locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null,
  locationSource: null, savedPlaceId: null, createdAt: "2026-07-11T09:00:00Z", ...overrides,
});

const filters = (overrides: Partial<TransactionHistoryFilters> = {}): TransactionHistoryFilters => ({
  scope: "history", selectedDayKey: "2026-07-11", kind: "all", category: "all", from: "", to: "",
  minMinor: null, maxMinor: null, paymentMode: "all", query: "", ...overrides,
});

describe("filterTransactionHistory", () => {
  const early = transaction({ id: "early", occurredOn: "2026-06-30", createdAt: "2026-06-30T08:00:00Z", note: "June lunch" });
  const selected = transaction({ id: "selected", occurredOn: "2026-07-11", createdAt: "2026-07-11T09:00:00Z", note: "Lunch" });
  const newest = transaction({ id: "newest", occurredOn: "2026-07-12", createdAt: "2026-07-12T10:00:00Z", kind: "income", category: "salary", amountMinor: 250000, paymentMode: "online", note: "Salary" });

  it("shows entries across all months in history mode, newest first", () => {
    expect(filterTransactionHistory([selected, early, newest], [], filters()).map((item) => item.id)).toEqual(["newest", "selected", "early"]);
  });

  it("retains the exact selected-day behavior in day mode", () => {
    expect(filterTransactionHistory([selected, early, newest], [], filters({ scope: "day" })).map((item) => item.id)).toEqual(["selected"]);
  });

  it("composes date, kind, payment, amount, and search filters", () => {
    expect(filterTransactionHistory([selected, early, newest], [], filters({ from: "2026-07-01", to: "2026-07-31", kind: "income", paymentMode: "online", minMinor: 200000, query: "salary" })).map((item) => item.id)).toEqual(["newest"]);
  });
});
