import { describe, expect, it } from "vitest";
import type { AccountTransfer, LedgerTransaction, PaymentAccount } from "../types";
import { filterTransactionHistory, listLedgerActivity, type LedgerActivityFilters, type TransactionHistoryFilters } from "./transaction-history";

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

const account = (id: string, label: string): PaymentAccount => ({
  id, importId: id, userId: "user-1", type: "esewa", provider: "esewa", label,
  balanceMinor: 0, balanceAsOf: "2026-07-01", balanceRecordedAt: "2026-07-01T00:00:00Z", currentBalanceMinor: 0, createdAt: "2026-07-01T00:00:00Z",
});

const transfer = (overrides: Partial<AccountTransfer>): AccountTransfer => ({
  id: "transfer", userId: "user-1", fromAccountId: "wallet", toAccountId: "bank", amountMinor: 50000,
  occurredOn: "2026-07-11", note: "Top up", createdAt: "2026-07-11T12:00:00Z", ...overrides,
});

const activityFilters = (overrides: Partial<LedgerActivityFilters> = {}): LedgerActivityFilters => ({
  ...filters(), ...overrides,
});

describe("listLedgerActivity", () => {
  const wallet = account("wallet", "Daily");
  const bank = account("bank", "Salary");
  const lunch = transaction({ id: "lunch", occurredOn: "2026-07-11", createdAt: "2026-07-11T09:00:00Z" });
  const moved = transfer({});

  it("places a transfer in the timeline by date without treating it as income or expense", () => {
    const items = listLedgerActivity([lunch], [moved], [wallet, bank], [], activityFilters());
    expect(items.map((item) => item.type === "transfer" ? item.transfer.id : item.transaction.id)).toEqual(["transfer", "lunch"]);
    expect(listLedgerActivity([lunch], [moved], [wallet, bank], [], activityFilters({ kind: "expense" })).every((item) => item.type === "transaction")).toBe(true);
    expect(listLedgerActivity([lunch], [moved], [wallet, bank], [], activityFilters({ kind: "transfer" })).map((item) => item.type)).toEqual(["transfer"]);
  });

  it("keeps transfers out of category and cash filters, and finds them by account name", () => {
    expect(listLedgerActivity([lunch], [moved], [wallet, bank], [], activityFilters({ category: "food" })).every((item) => item.type === "transaction")).toBe(true);
    expect(listLedgerActivity([lunch], [moved], [wallet, bank], [], activityFilters({ paymentMode: "cash" })).every((item) => item.type === "transaction")).toBe(true);
    expect(listLedgerActivity([lunch], [moved], [wallet, bank], [], activityFilters({ query: "salary" })).map((item) => item.type)).toEqual(["transfer"]);
  });

  it("limits an account list to that account's transactions and transfers", () => {
    const elsewhere = transaction({ id: "cash", paymentAccountId: null });
    const onWallet = transaction({ id: "wallet-spend", paymentAccountId: "wallet", paymentMode: "online" });
    const items = listLedgerActivity([elsewhere, onWallet], [moved], [wallet, bank], [], activityFilters({ accountId: "wallet" }));
    expect(items.map((item) => item.type === "transfer" ? item.transfer.id : item.transaction.id)).toEqual(["transfer", "wallet-spend"]);
  });
});
