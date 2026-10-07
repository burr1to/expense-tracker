import { describe, expect, it } from "vitest";
import type { LedgerTransaction, PaymentAccount } from "../types";
import { entryDateLabel, newClientRequestId, pickTransactionDefaults, shiftDateKey } from "./transaction-defaults";

let sequence = 0;
const entry = (overrides: Partial<LedgerTransaction>): LedgerTransaction => {
  sequence += 1;
  return {
    id: `t${sequence}`, userId: "me", kind: "expense", category: "food", amountMinor: 10000, occurredOn: "2026-10-05", note: "", subcategory: null, area: null,
    paymentMode: "cash", paymentAccountId: null, locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null,
    locationSource: null, savedPlaceId: null, createdAt: `2026-10-05T0${sequence % 10}:00:00Z`, ...overrides,
  };
};

const account = (id: string): PaymentAccount => ({
  id, importId: id, userId: "me", type: "esewa", provider: "esewa", label: id, balanceMinor: 0, balanceAsOf: "2026-09-01",
  balanceRecordedAt: "2026-09-01T00:00:00Z", currentBalanceMinor: 0, createdAt: "2026-09-01T00:00:00Z",
});

const esewa = account("esewa");
const nabil = account("nabil");
const base = { kind: "expense" as const, paymentAccounts: [esewa, nabil], today: "2026-10-07", fallbackCategory: "food" };

describe("pickTransactionDefaults", () => {
  it("starts on cash and the fallback category when there is no history", () => {
    expect(pickTransactionDefaults({ ...base, transactions: [] })).toEqual({ category: "food", paymentMode: "cash", paymentAccountId: "" });
  });

  it("uses the payment mode + account used most for this kind in the last 30 days", () => {
    const transactions = [
      entry({ paymentMode: "online", paymentAccountId: "esewa", occurredOn: "2026-10-01" }),
      entry({ paymentMode: "online", paymentAccountId: "esewa", occurredOn: "2026-09-20" }),
      entry({ paymentMode: "cash", occurredOn: "2026-10-06" }),
      entry({ paymentMode: "online", paymentAccountId: "nabil", occurredOn: "2026-10-07" }),
    ];
    expect(pickTransactionDefaults({ ...base, transactions })).toMatchObject({ paymentMode: "online", paymentAccountId: "esewa" });
  });

  it("breaks a tie in favour of the more recently used payment", () => {
    const transactions = [
      entry({ paymentMode: "online", paymentAccountId: "esewa", occurredOn: "2026-09-30" }),
      entry({ paymentMode: "online", paymentAccountId: "nabil", occurredOn: "2026-10-06" }),
    ];
    expect(pickTransactionDefaults({ ...base, transactions })).toMatchObject({ paymentMode: "online", paymentAccountId: "nabil" });
  });

  it("only counts the requested kind, the owner's own entries and non-future dates", () => {
    const transactions = [
      entry({ kind: "income", category: "salary", paymentMode: "online", paymentAccountId: "nabil" }),
      entry({ userId: "partner", paymentMode: "online", paymentAccountId: "esewa" }),
      entry({ userId: "partner", paymentMode: "online", paymentAccountId: "esewa" }),
      entry({ occurredOn: "2026-10-20", paymentMode: "cheque" }),
      entry({ category: "transport", paymentMode: "cash" }),
    ];
    expect(pickTransactionDefaults({ ...base, transactions, ownerId: "me" })).toEqual({ category: "transport", paymentMode: "cash", paymentAccountId: "" });
    expect(pickTransactionDefaults({ ...base, transactions, ownerId: "me", kind: "income", fallbackCategory: "other-income" })).toEqual({ category: "salary", paymentMode: "online", paymentAccountId: "nabil" });
  });

  it("falls back to the latest entry when nothing is recent", () => {
    const transactions = [
      entry({ occurredOn: "2026-07-01", paymentMode: "online", paymentAccountId: "nabil", category: "shopping" }),
      entry({ occurredOn: "2026-06-01", paymentMode: "cheque" }),
    ];
    expect(pickTransactionDefaults({ ...base, transactions })).toEqual({ category: "food", paymentMode: "online", paymentAccountId: "nabil" });
  });

  it("treats the 30-day window as inclusive of today and the 29 days before it", () => {
    const transactions = [
      entry({ occurredOn: "2026-09-08", paymentMode: "online", paymentAccountId: "nabil" }),
      entry({ occurredOn: "2026-09-07", paymentMode: "cheque" }),
      entry({ occurredOn: "2026-09-07", paymentMode: "cheque" }),
    ];
    expect(pickTransactionDefaults({ ...base, transactions })).toMatchObject({ paymentMode: "online", paymentAccountId: "nabil" });
  });

  it("ignores accounts that no longer exist and falls back to cash", () => {
    const transactions = [
      entry({ paymentMode: "online", paymentAccountId: "removed" }),
      entry({ paymentMode: "online", paymentAccountId: "removed" }),
    ];
    expect(pickTransactionDefaults({ ...base, transactions })).toMatchObject({ paymentMode: "cash", paymentAccountId: "" });
    expect(pickTransactionDefaults({ ...base, transactions: [...transactions, entry({ paymentMode: "online", paymentAccountId: "esewa" })] })).toMatchObject({ paymentMode: "online", paymentAccountId: "esewa" });
  });

  it("never defaults to a household partner's shared account", () => {
    const partnerWallet = { ...account("partner-wallet"), userId: "partner", shared: true };
    const transactions = [
      entry({ paymentMode: "online", paymentAccountId: "partner-wallet", shared: true }),
      entry({ paymentMode: "online", paymentAccountId: "partner-wallet", shared: true }),
      entry({ paymentMode: "online", paymentAccountId: "esewa", occurredOn: "2026-09-20" }),
    ];
    expect(pickTransactionDefaults({ ...base, paymentAccounts: [esewa, partnerWallet], transactions, ownerId: "me" })).toMatchObject({ paymentMode: "online", paymentAccountId: "esewa" });
    expect(pickTransactionDefaults({ ...base, paymentAccounts: [esewa, partnerWallet], transactions: transactions.slice(0, 2), ownerId: "me" })).toMatchObject({ paymentMode: "cash", paymentAccountId: "" });
  });

  it("picks the most frequent recent category that still exists", () => {
    const transactions = [
      entry({ category: "transport" }),
      entry({ category: "transport" }),
      entry({ category: "groceries-custom" }),
      entry({ category: "groceries-custom" }),
      entry({ category: "groceries-custom" }),
      entry({ category: "food" }),
    ];
    expect(pickTransactionDefaults({ ...base, transactions }).category).toBe("groceries-custom");
    expect(pickTransactionDefaults({ ...base, transactions, categoryIds: ["food", "transport"] }).category).toBe("transport");
  });

  it("never learns a default from loan movements recorded in Dues", () => {
    const transactions = [
      entry({ category: "loan", paymentMode: "online", paymentAccountId: "nabil" }),
      entry({ category: "loan", paymentMode: "online", paymentAccountId: "nabil" }),
      entry({ category: "loan", paymentMode: "online", paymentAccountId: "nabil" }),
      entry({ category: "transport", paymentMode: "cash" }),
    ];
    expect(pickTransactionDefaults({ ...base, transactions, categoryIds: ["food", "transport", "loan"] })).toEqual({ category: "transport", paymentMode: "cash", paymentAccountId: "" });
    const repayments = [entry({ kind: "income", category: "loan", paymentMode: "online", paymentAccountId: "esewa" }), entry({ kind: "income", category: "loan", paymentMode: "online", paymentAccountId: "esewa" })];
    expect(pickTransactionDefaults({ ...base, kind: "income", fallbackCategory: "salary", transactions: repayments })).toEqual({ category: "salary", paymentMode: "cash", paymentAccountId: "" });
  });
});

describe("shiftDateKey", () => {
  it("moves across month and year boundaries", () => {
    expect(shiftDateKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDateKey("2025-12-31", 1)).toBe("2026-01-01");
    expect(shiftDateKey("2026-10-07", -29)).toBe("2026-09-08");
  });
});

describe("entryDateLabel", () => {
  it("names today, yesterday and tomorrow", () => {
    expect(entryDateLabel("2026-10-07", "2026-10-07")).toEqual({ label: "Today", isToday: true });
    expect(entryDateLabel("2026-10-06", "2026-10-07")).toEqual({ label: "Yesterday", isToday: false });
    expect(entryDateLabel("2026-10-08", "2026-10-07").label).toBe("Tomorrow");
  });

  it("shows a short AD date, with the year only when it differs", () => {
    expect(entryDateLabel("2026-09-01", "2026-10-07")).toEqual({ label: "Tue 1 Sep", isToday: false });
    expect(entryDateLabel("2025-12-30", "2026-01-02").label).toBe("Tue 30 Dec 2025");
  });

  it("shows a short Bikram Sambat date when BS is selected", () => {
    expect(entryDateLabel("2026-09-01", "2026-10-07", "BS").label).toMatch(/^Tue Bha \d{1,2}$/);
    expect(entryDateLabel("2026-04-10", "2026-04-20", "BS").label).toMatch(/^Fri Cha \d{1,2} 2082$/);
  });

  it("handles a cleared date", () => {
    expect(entryDateLabel("", "2026-10-07")).toEqual({ label: "Pick a date", isToday: false });
  });
});

describe("newClientRequestId", () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("returns a distinct UUID per call", () => {
    const first = newClientRequestId();
    expect(first).toMatch(uuid);
    expect(newClientRequestId()).not.toBe(first);
  });

  it("builds a v4 UUID when randomUUID is unavailable (insecure context)", () => {
    const getRandomValues = (<T extends ArrayBufferView | null>(array: T) => { if (array) new Uint8Array(array.buffer).fill(255); return array; }) as Crypto["getRandomValues"];
    expect(newClientRequestId({ getRandomValues })).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(newClientRequestId({ getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) })).toMatch(uuid);
  });
});
