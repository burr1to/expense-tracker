import { describe, expect, it } from "vitest";
import { calculateCurrentAccountBalance, totalCurrentBalance } from "./account-balances";
import type { AccountTransfer, LedgerTransaction, PaymentAccount } from "../types";

const account = (overrides: Partial<PaymentAccount> = {}): PaymentAccount => ({
  id: "wallet",
  userId: "user",
  type: "esewa",
  provider: "esewa",
  label: "Main wallet",
  balanceMinor: 10000,
  balanceAsOf: "2026-07-20",
  balanceRecordedAt: "2026-07-20T10:00:00.000Z",
  currentBalanceMinor: 10000,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const transaction = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: "transaction",
  userId: "user",
  kind: "expense",
  category: "food",
  amountMinor: 1000,
  occurredOn: "2026-07-21",
  note: "",
  subcategory: null,
  area: null,
  paymentMode: "online",
  paymentAccountId: "wallet",
  locationLabel: null,
  locationAddress: null,
  locationLatitude: null,
  locationLongitude: null,
  locationAccuracy: null,
  locationSource: null,
  savedPlaceId: null,
  createdAt: "2026-07-21T10:00:00.000Z",
  ...overrides,
});

const transfer = (overrides: Partial<AccountTransfer>): AccountTransfer => ({
  id: "transfer",
  userId: "user",
  fromAccountId: "wallet",
  toAccountId: "bank",
  amountMinor: 2500,
  occurredOn: "2026-07-21",
  note: "",
  createdAt: "2026-07-21T11:00:00.000Z",
  ...overrides,
});

describe("account balances", () => {
  it("applies transactions and transfers after the manual snapshot", () => {
    expect(calculateCurrentAccountBalance(account(), [transaction({})], [transfer({})])).toBe(6500);
  });

  it("does not double-count activity that predates the snapshot", () => {
    expect(calculateCurrentAccountBalance(account(), [transaction({ occurredOn: "2026-07-19" })], [transfer({ occurredOn: "2026-07-20", createdAt: "2026-07-20T09:00:00.000Z" })])).toBe(10000);
  });

  it("can total the currently tracked accounts", () => {
    expect(totalCurrentBalance([account(), account({ id: "bank", currentBalanceMinor: 42500 })])).toBe(52500);
  });
});
