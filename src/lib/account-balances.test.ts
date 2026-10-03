import { describe, expect, it } from "vitest";
import { attachCurrentBalances, calculateCurrentAccountBalance, expectedAccountBalanceThrough, reconciliationSpendingGap, totalCurrentBalance } from "./account-balances";
import type { AccountTransfer, LedgerTransaction, PaymentAccount } from "../types";

const account = (overrides: Partial<PaymentAccount> = {}): PaymentAccount => ({
  id: "wallet",
  importId: "11111111-1111-4111-8111-111111111111",
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

  it("attaches each account from one shared activity list", () => {
    const wallet = account();
    const bank = account({ id: "bank", balanceMinor: 5000, label: "Bank" });
    const activity = [transaction({ amountMinor: 1000 })];
    const movements = [transfer({ amountMinor: 2500 })];
    const [withWallet, withBank] = attachCurrentBalances([wallet, bank], activity, movements);
    expect(withWallet.currentBalanceMinor).toBe(calculateCurrentAccountBalance(wallet, activity, movements));
    expect(withBank.currentBalanceMinor).toBe(calculateCurrentAccountBalance(bank, activity, movements));
  });

  it("does not double-count activity that predates the snapshot", () => {
    expect(calculateCurrentAccountBalance(account(), [transaction({ occurredOn: "2026-07-19" })], [transfer({ occurredOn: "2026-07-20", createdAt: "2026-07-20T09:00:00.000Z" })])).toBe(10000);
  });

  it("calculates a reconciliation closing balance only through the checked date", () => {
    expect(expectedAccountBalanceThrough(
      account(),
      [
        transaction({ id: "income", kind: "income", amountMinor: 2_000, occurredOn: "2026-07-21" }),
        transaction({ id: "expense", amountMinor: 500, occurredOn: "2026-07-22" }),
        transaction({ id: "later", amountMinor: 9_000, occurredOn: "2026-08-01" }),
      ],
      [
        transfer({ id: "incoming", fromAccountId: "other", toAccountId: "wallet", amountMinor: 1_000, occurredOn: "2026-07-23" }),
        transfer({ id: "outgoing", fromAccountId: "wallet", toAccountId: "other", amountMinor: 250, occurredOn: "2026-07-24" }),
      ],
      "2026-07-31",
    )).toEqual({
      incomeMinor: 2_000,
      expenseMinor: 500,
      transfersInMinor: 1_000,
      transfersOutMinor: 250,
      expectedBalanceMinor: 12_250,
    });
  });

  it("separates earlier activity, this month, and spending outside the account", () => {
    expect(reconciliationSpendingGap(
      account({ balanceAsOf: "2026-08-20" }),
      [
        transaction({ id: "earlier", amountMinor: 400, occurredOn: "2026-08-25", createdAt: "2026-08-25T10:00:00.000Z" }),
        transaction({ id: "income", kind: "income", amountMinor: 1_000, occurredOn: "2026-09-01", createdAt: "2026-09-01T10:00:00.000Z" }),
        transaction({ id: "wallet-spend", amountMinor: 500, occurredOn: "2026-09-02", createdAt: "2026-09-02T10:00:00.000Z" }),
        transaction({ id: "cash", amountMinor: 700, occurredOn: "2026-09-03", paymentAccountId: null, createdAt: "2026-09-03T10:00:00.000Z" }),
        transaction({ id: "other-account", amountMinor: 900, occurredOn: "2026-09-04", paymentAccountId: "bank", createdAt: "2026-09-04T10:00:00.000Z" }),
      ],
      [transfer({ amountMinor: 200, occurredOn: "2026-09-05", createdAt: "2026-09-05T10:00:00.000Z" })],
      "2026-09",
      "2026-09-25",
    )).toEqual({
      beforeMonth: { incomeMinor: 0, expenseMinor: 400, transfersInMinor: 0, transfersOutMinor: 0 },
      duringMonth: { incomeMinor: 1_000, expenseMinor: 500, transfersInMinor: 0, transfersOutMinor: 200 },
      monthExpenseMinor: 2_100,
      otherAccountExpenseMinor: 1_600,
      alreadyInOpeningExpenseMinor: 0,
    });
  });

  it("keeps month spending that is already inside the opening balance out of the check", () => {
    expect(reconciliationSpendingGap(
      account({ balanceAsOf: "2026-09-10", balanceRecordedAt: "2026-09-10T12:00:00.000Z" }),
      [
        transaction({ id: "before-snapshot", amountMinor: 300, occurredOn: "2026-09-05", createdAt: "2026-09-05T10:00:00.000Z" }),
        transaction({ id: "same-day-before", amountMinor: 50, occurredOn: "2026-09-10", createdAt: "2026-09-10T09:00:00.000Z" }),
        transaction({ id: "same-day-after", amountMinor: 80, occurredOn: "2026-09-10", createdAt: "2026-09-10T13:00:00.000Z" }),
        transaction({ id: "after-snapshot", amountMinor: 200, occurredOn: "2026-09-12", createdAt: "2026-09-12T10:00:00.000Z" }),
      ],
      [],
      "2026-09",
      "2026-09-30",
    )).toMatchObject({
      beforeMonth: { expenseMinor: 0 },
      duringMonth: { expenseMinor: 280, transfersOutMinor: 0 },
      monthExpenseMinor: 630,
      otherAccountExpenseMinor: 0,
      alreadyInOpeningExpenseMinor: 350,
    });
  });

  it("can total the currently tracked accounts", () => {
    expect(totalCurrentBalance([account(), account({ id: "bank", currentBalanceMinor: 42500 })])).toBe(52500);
  });
});
