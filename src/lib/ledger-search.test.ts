import { describe, expect, it } from "vitest";
import { amountMatches, searchLedger } from "./ledger-search";
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

  it("only treats numeric queries as amounts", () => {
    expect(amountMatches("1500", 150000)).toBe(true);
    expect(amountMatches("NPR 1,500", 150000)).toBe(true);
    expect(amountMatches("rs. 1500", 150000)).toBe(true);
    expect(amountMatches("bus 1", 150000)).toBe(false);
    expect(amountMatches(".", 150000)).toBe(false);
    expect(searchLedger("groceries 1", input)).toEqual([]);
  });

  it("compares against the rupee amount, not the paisa count", () => {
    expect(amountMatches("1500.00", 150000)).toBe(true);
    expect(amountMatches("1,500.0", 150000)).toBe(true);
    expect(amountMatches("12.5", 1250)).toBe(true);
    expect(amountMatches("12.50", 1250)).toBe(true);
    expect(amountMatches("100.10", 10010)).toBe(true);
    expect(amountMatches("1250", 1250)).toBe(false);
    expect(amountMatches("100", 1000)).toBe(false);
  });

  it("finds a transaction by its exact-location label or payment account", () => {
    const pinned = { ...transaction, id: "t2", note: "Coffee", area: null, locationLabel: "Himalayan Java", paymentMode: "online" as const, paymentAccountId: "a2" };
    const withPin = { ...input, transactions: [pinned] };
    expect(searchLedger("himalayan", withPin).map((hit) => hit.id)).toEqual(["t2"]);
    expect(searchLedger("esewa", withPin).some((hit) => hit.id === "t2")).toBe(true);
  });

  it("matches every word of a query across a transaction's fields", () => {
    expect(searchLedger("groceries cash", input).map((hit) => hit.id)).toEqual(["t1"]);
    expect(searchLedger("groceries esewa", input)).toEqual([]);
  });

  it("returns nothing for a blank query", () => {
    expect(searchLedger("   ", input)).toEqual([]);
  });
});
