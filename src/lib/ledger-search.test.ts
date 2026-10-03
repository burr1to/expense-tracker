import { describe, expect, it } from "vitest";
import { searchLedger } from "./ledger-search";
import type { AccountTransfer, DueItem, LedgerTransaction, PaymentAccount, SavedPlace } from "../types";

const transaction: LedgerTransaction = {
  id: "t1", userId: "user-1", kind: "expense", category: "food", amountMinor: 150000, occurredOn: "2026-09-11",
  note: "Bhatbhateni groceries", subcategory: "Groceries", area: "Bhatbhateni", paymentMode: "cash", paymentAccountId: null,
  locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null, locationSource: null, savedPlaceId: null,
  createdAt: "2026-09-11T00:00:00.000Z",
};

const transfer: AccountTransfer = {
  id: "tr1", userId: "user-1", fromAccountId: "a1", toAccountId: "a2", amountMinor: 50000, occurredOn: "2026-09-12", note: "Wallet top up", createdAt: "2026-09-12T00:00:00.000Z",
};

const due: DueItem = {
  id: "due1", userId: "user-1", kind: "borrowed", title: "Rent share", person: "Anu", amountMinor: 200000, category: "housing",
  occurredOn: null, dueOn: "2026-10-01", remindOn: null, snoozedUntil: null, note: "", status: "open", annualRatePercent: null,
  completedOn: null, createdAt: "2026-09-01T00:00:00.000Z", payments: [],
};

const place: SavedPlace = {
  id: "place1", userId: "user-1", name: "Home", icon: "home", address: "Lazimpat", latitude: 27.72, longitude: 85.32, createdAt: "2026-09-01T00:00:00.000Z", lastUsedAt: "2026-09-01T00:00:00.000Z",
};

const accounts: PaymentAccount[] = [
  { id: "a1", importId: "i1", userId: "user-1", type: "mobile_banking", provider: "Nabil", label: "Salary", balanceMinor: 0, balanceAsOf: "2026-09-01", balanceRecordedAt: "2026-09-01T00:00:00.000Z", currentBalanceMinor: 0, createdAt: "2026-09-01T00:00:00.000Z" },
  { id: "a2", importId: "i2", userId: "user-1", type: "esewa", provider: "esewa", label: "eSewa", balanceMinor: 0, balanceAsOf: "2026-09-01", balanceRecordedAt: "2026-09-01T00:00:00.000Z", currentBalanceMinor: 0, createdAt: "2026-09-01T00:00:00.000Z" },
];

const input = { transactions: [transaction], transfers: [transfer], dues: [due], places: [place], accounts };

describe("searchLedger", () => {
  it("matches a note, an amount, a person, and a saved place", () => {
    expect(searchLedger("bhatbhateni", input).map((hit) => hit.kind)).toEqual(["transaction"]);
    expect(searchLedger("1500", input).some((hit) => hit.id === "t1")).toBe(true);
    expect(searchLedger("anu", input)[0]).toMatchObject({ kind: "due", href: "/dues?due=due1" });
    expect(searchLedger("lazimpat", input)[0]).toMatchObject({ kind: "place", href: "/maps?place=place1" });
    expect(searchLedger("esewa", input)[0]).toMatchObject({ kind: "transfer", title: "Salary → eSewa" });
  });

  it("returns nothing for a blank query", () => {
    expect(searchLedger("   ", input)).toEqual([]);
  });
});
