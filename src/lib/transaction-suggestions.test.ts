import { describe, expect, it } from "vitest";
import { getTransactionSuggestions, transactionSuggestionTitle } from "./transaction-suggestions";
import type { LedgerTransaction } from "../types";

const transaction = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: overrides.id ?? crypto.randomUUID(),
  userId: "user-1",
  kind: "expense",
  category: "food",
  amountMinor: 120000,
  occurredOn: "2026-07-10",
  note: "Lunch at Momo House",
  subcategory: "Lunch",
  area: "Thamel",
  paymentMode: "cash",
  paymentAccountId: null,
  locationLabel: null,
  locationAddress: null,
  locationLatitude: null,
  locationLongitude: null,
  locationAccuracy: null,
  locationSource: null,
  savedPlaceId: null,
  createdAt: "2026-07-10T08:00:00.000Z",
  ...overrides,
});

describe("transaction suggestions", () => {
  it("uses the place as the title and shows the subcategory in brackets", () => {
    expect(transactionSuggestionTitle(transaction({
      area: "Mira's Coffee",
      subcategory: "Cafe",
      note: "Tea",
    }))).toBe("Mira's Coffee (Cafe)");
  });

  it("uses a bracketed subcategory when no place was recorded", () => {
    expect(transactionSuggestionTitle(transaction({
      area: "",
      subcategory: "Cafe",
      note: "Tea",
    }))).toBe("(Cafe)");
  });

  it("falls back to the note when neither a place nor subcategory was recorded", () => {
    expect(transactionSuggestionTitle(transaction({
      area: "",
      subcategory: "",
      note: "Tea",
    }))).toBe("Tea");
  });

  it("groups matching transaction details and keeps the newest example", () => {
    const older = transaction({ id: "older", occurredOn: "2026-06-10", amountMinor: 90000 });
    const newer = transaction({ id: "newer", occurredOn: "2026-07-10", amountMinor: 120000 });

    expect(getTransactionSuggestions([older, newer], "expense")).toEqual([
      { transaction: newer, useCount: 2 },
    ]);
  });

  it("keeps different places and payment accounts as separate suggestions", () => {
    const cash = transaction({ id: "cash" });
    const online = transaction({
      id: "online",
      paymentMode: "online",
      paymentAccountId: "account-1",
      paymentAccount: { id: "account-1", userId: "user-1", type: "esewa", provider: "esewa", label: "Personal", balanceMinor: 0, balanceAsOf: "2026-01-01", balanceRecordedAt: "2026-01-01T00:00:00.000Z", currentBalanceMinor: 0, createdAt: "2026-01-01T00:00:00.000Z" },
    });

    expect(getTransactionSuggestions([cash, online], "expense")).toHaveLength(2);
  });

  it("filters by transaction kind and searchable place details", () => {
    const lunch = transaction({ id: "lunch" });
    const commute = transaction({ id: "commute", category: "transport", note: "Taxi", subcategory: "Ride share", area: "Patan" });
    const pinned = transaction({ id: "pinned", locationLabel: "Mira's Coffee", area: "" });
    const salary = transaction({ id: "salary", kind: "income", category: "salary", note: "Monthly salary" });

    expect(getTransactionSuggestions([lunch, commute, pinned, salary], "expense", "patan").map((item) => item.transaction.id)).toEqual(["commute"]);
    expect(getTransactionSuggestions([lunch, commute, pinned, salary], "expense", "mira").map((item) => item.transaction.id)).toEqual(["pinned"]);
    expect(getTransactionSuggestions([lunch, commute, pinned, salary], "income").map((item) => item.transaction.id)).toEqual(["salary"]);
  });

  it("promotes frequently reused details and respects the result limit", () => {
    const frequent = [
      transaction({ id: "frequent-1", occurredOn: "2026-04-01" }),
      transaction({ id: "frequent-2", occurredOn: "2026-05-01" }),
      transaction({ id: "frequent-3", occurredOn: "2026-06-01" }),
    ];
    const recent = transaction({ id: "recent", note: "Coffee", occurredOn: "2026-07-18" });

    const suggestions = getTransactionSuggestions([...frequent, recent], "expense", "", 1);
    expect(suggestions[0]).toMatchObject({ transaction: { id: "frequent-3" }, useCount: 3 });
  });
});
