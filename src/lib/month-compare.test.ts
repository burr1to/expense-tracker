import { describe, expect, it } from "vitest";
import { CASH_BUCKET, UNASSIGNED_BUCKET, compareMonthSpend, daysSinceLastLogged, spendBucket } from "./month-compare";
import type { LedgerTransaction, PaymentAccount } from "../types";

const account = (id: string, type: PaymentAccount["type"]): PaymentAccount => ({
  id, importId: id, userId: "u", type, provider: type, label: "", balanceMinor: 0, balanceAsOf: "2026-10-01", balanceRecordedAt: "2026-10-01T00:00:00Z", currentBalanceMinor: 0, createdAt: "2026-10-01T00:00:00Z",
});

let seq = 0;
const entry = (occurredOn: string, amount: number, extra: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  id: `t${++seq}`, userId: "u", kind: "expense", category: "food", amountMinor: amount * 100, occurredOn, note: "", subcategory: null, area: null,
  paymentMode: "online", paymentAccountId: "esewa", locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null,
  locationAccuracy: null, locationSource: null, savedPlaceId: null, createdAt: `${occurredOn}T08:00:00Z`, ...extra,
});

const esewa = account("esewa", "esewa");
const bank = account("bank", "mobile_banking");

describe("compareMonthSpend", () => {
  it("compares the month so far with the same days of last month", () => {
    const result = compareMonthSpend([
      entry("2026-11-02", 500),
      entry("2026-11-18", 300),
      entry("2026-11-20", 9_000), // after today: not counted yet
      entry("2026-10-05", 400),
      entry("2026-10-25", 7_000), // past Oct 18: outside the comparison
    ], [esewa], "2026-11", "2026-11-18");
    expect(result.elapsedDays).toBe(18);
    expect(result.previousThrough).toBe("2026-10-18");
    expect(result.currentMinor).toBe(80_000);
    expect(result.previousMinor).toBe(40_000);
    expect(result.currentCumulative).toHaveLength(18);
    expect(result.currentCumulative.at(-1)).toBe(80_000);
    expect(result.previousCumulative).toHaveLength(31);
    expect(result.previousCumulative.at(-1)).toBe(740_000);
  });

  it("leaves out income, loans and transfers-only accounts stay listed at zero", () => {
    const result = compareMonthSpend([
      entry("2026-11-03", 100_000, { kind: "income", category: "salary" }),
      entry("2026-11-03", 5_000, { category: "loan" }),
      entry("2026-11-04", 250),
    ], [esewa, bank], "2026-11", "2026-11-18");
    expect(result.currentMinor).toBe(25_000);
    expect(result.accounts.map((row) => [row.key, row.currentMinor])).toEqual([["esewa", 25_000], ["bank", 0]]);
  });

  it("compares a finished month with the whole of the month before", () => {
    const result = compareMonthSpend([entry("2026-09-30", 100), entry("2026-10-31", 200)], [esewa], "2026-10", "2026-11-18");
    expect(result.elapsedDays).toBe(31);
    expect(result.previousThrough).toBe("2026-09-30");
    expect(result.previousMinor).toBe(10_000);
    expect(result.currentMinor).toBe(20_000);
  });

  it("ranks categories by how much they moved", () => {
    const result = compareMonthSpend([
      entry("2026-11-02", 900, { category: "food" }),
      entry("2026-10-02", 600, { category: "food" }),
      entry("2026-11-02", 100, { category: "transport" }),
      entry("2026-10-02", 1_100, { category: "transport" }),
      entry("2026-11-02", 50, { category: "health" }),
      entry("2026-10-02", 50, { category: "health" }),
    ], [esewa], "2026-11", "2026-11-18");
    expect(result.categories.map((row) => row.category)).toEqual(["transport", "food"]);
  });
});

describe("spendBucket", () => {
  it("puts cash entries without an account into the cash account, or the cash bucket", () => {
    const cash = account("cash-1", "cash");
    expect(spendBucket({ paymentAccountId: null, paymentMode: "cash" }, [esewa, cash])).toBe("cash-1");
    expect(spendBucket({ paymentAccountId: null, paymentMode: "cash" }, [esewa])).toBe(CASH_BUCKET);
    expect(spendBucket({ paymentAccountId: null, paymentMode: "online" }, [esewa])).toBe(UNASSIGNED_BUCKET);
    expect(spendBucket({ paymentAccountId: "gone", paymentMode: "online" }, [esewa])).toBe(UNASSIGNED_BUCKET);
  });
});

describe("daysSinceLastLogged", () => {
  it("counts from the most recently saved entry", () => {
    const toDay = (instant: string) => instant.slice(0, 10);
    expect(daysSinceLastLogged([{ createdAt: "2026-11-10T09:00:00Z" }, { createdAt: "2026-11-15T09:00:00Z" }], "2026-11-18", toDay)).toBe(3);
    expect(daysSinceLastLogged([], "2026-11-18", toDay)).toBeNull();
  });
});

describe("accountMonthDetail", () => {
  it("splits one account's month into weeks against last month, with its categories and biggest entry", async () => {
    const { accountMonthDetail } = await import("./month-compare");
    const result = accountMonthDetail([
      entry("2026-11-02", 500, { category: "food" }),
      entry("2026-11-16", 3_750, { category: "shopping", note: "Daraz" }),
      entry("2026-11-16", 900, { paymentAccountId: "bank" }), // other account
      entry("2026-10-03", 400, { category: "food" }),
      entry("2026-10-31", 1_000, { category: "food" }),
    ], [esewa, bank], "esewa", "2026-11", "2026-11-18");
    expect(result.row.currentMinor).toBe(425_000);
    expect(result.weeks.map((week) => [week.firstDay, week.lastDay, week.currentMinor, week.previousMinor, week.started])).toEqual([
      [1, 7, 50_000, 40_000, true],
      [8, 14, 0, 0, true],
      [15, 18, 375_000, 0, true],
      [22, 30, 0, 100_000, false],
    ]);
    expect(result.categories.map((row) => [row.category, row.currentMinor, row.previousMinor])).toEqual([["shopping", 375_000, 0], ["food", 50_000, 40_000]]);
    expect(result.biggest?.note).toBe("Daraz");
  });
});
