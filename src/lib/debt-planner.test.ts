import { describe, expect, it } from "vitest";
import { buildDebtPlan } from "./debt-planner";
import { calculateDebtPayoff } from "./financial-calculators";
import type { DueItem, DuePayment } from "../types";

const due = (overrides: Partial<DueItem> = {}): DueItem => ({ id: "d1", userId: "u1", kind: "borrowed", title: "Loan", person: "Bank", amountMinor: 100_000, category: "other", occurredOn: "2026-08-01", dueOn: "2026-09-01", remindOn: null, snoozedUntil: null, note: "", status: "open", annualRatePercent: null, completedOn: null, createdAt: "2026-08-01T00:00:00.000Z", payments: [], receipt: null, ...overrides });

const repayment = (amountMinor: number, dueItemId: string): DuePayment => ({ id: `p-${dueItemId}`, userId: "u1", dueItemId, amountMinor, occurredOn: "2026-08-05", note: "", transactionId: null, createdAt: "2026-08-05T00:00:00.000Z" });

const ids = (plan: ReturnType<typeof buildDebtPlan>) => plan.entries.map((entry) => entry.item.id);

describe("buildDebtPlan", () => {
  it("pays the smallest balance first under snowball", () => {
    const plan = buildDebtPlan([due({ id: "big", amountMinor: 300_000 }), due({ id: "small", amountMinor: 40_000 }), due({ id: "mid", amountMinor: 120_000 })], 200_000, "snowball", "2026-08-12");
    expect(ids(plan)).toEqual(["small", "mid", "big"]);
    expect(plan.entries.map((entry) => entry.order)).toEqual([0, 1, 2]);
  });

  it("pays the highest rate first under avalanche and treats a missing rate as zero", () => {
    const plan = buildDebtPlan([due({ id: "free", amountMinor: 20_000 }), due({ id: "card", amountMinor: 300_000, annualRatePercent: 24 }), due({ id: "loan", amountMinor: 90_000, annualRatePercent: 6 })], 300_000, "avalanche", "2026-08-12");
    expect(ids(plan)).toEqual(["card", "loan", "free"]);
  });

  it("pays the earliest due date first under dueDate and breaks ties by due date then id", () => {
    const plan = buildDebtPlan([due({ id: "c", dueOn: "2026-10-01" }), due({ id: "b", dueOn: "2026-09-01" }), due({ id: "a", dueOn: "2026-09-01" })], 500_000, "dueDate", "2026-08-12");
    expect(ids(plan)).toEqual(["a", "b", "c"]);
    expect(ids(buildDebtPlan([due({ id: "z" }), due({ id: "y" })], 500_000, "snowball", "2026-08-12"))).toEqual(["y", "z"]);
  });

  it("rolls a cleared debt's leftover budget into the next debt in the same month", () => {
    const plan = buildDebtPlan([due({ id: "small", amountMinor: 50_000, dueOn: "2026-09-01" }), due({ id: "big", amountMinor: 100_000, dueOn: "2026-10-01" })], 40_000, "snowball", "2026-08-12");
    expect(plan.entries.map((entry) => entry.monthsToClear)).toEqual([2, 4]);
    expect(plan.monthsToDebtFree).toBe(4);
    // Paid one at a time with no rollover the second debt would restart from full: 2 + 3 = 5 months.
    expect(calculateDebtPayoff(100_000, 0, 40_000).months).toBe(3);
    // With rollover the debts behave like a single pot.
    expect(plan.monthsToDebtFree).toBe(calculateDebtPayoff(150_000, 0, 40_000).months);
  });

  it("charges no interest when every debt has a null rate", () => {
    const plan = buildDebtPlan([due({ id: "a", amountMinor: 60_000 }), due({ id: "b", amountMinor: 90_000 })], 50_000, "snowball", "2026-08-12");
    expect(plan.minimumMonthlyMinor).toBe(0);
    expect(plan.totalInterestMinor).toBe(0);
    expect(plan.entries.every((entry) => entry.interestMinor === 0)).toBe(true);
    expect(plan.totalRemainingMinor).toBe(150_000);
    expect(plan.monthsToDebtFree).toBe(3);
    expect(plan.debtFreeOn).toBe("2026-11-12");
    expect(plan.impossible).toBe(false);
  });

  it("accrues monthly interest and reports it per debt", () => {
    const plan = buildDebtPlan([due({ id: "card", amountMinor: 1_000_000, annualRatePercent: 12 }), due({ id: "free", amountMinor: 100_000 })], 300_000, "avalanche", "2026-08-12");
    expect(plan.minimumMonthlyMinor).toBe(10_000);
    // 10_000 + 7_100 + 4_171 + 1_213 of interest across the four months it takes to clear the card.
    expect(plan.entries[0].interestMinor).toBe(22_484);
    expect(plan.entries[1].interestMinor).toBe(0);
    expect(plan.totalInterestMinor).toBe(22_484);
    expect(plan.entries.map((entry) => entry.monthsToClear)).toEqual([4, 4]);
    expect(plan.monthsToDebtFree).toBe(4);
    expect(plan.entries.map((entry) => entry.projectedClearedOn)).toEqual(["2026-12-12", "2026-12-12"]);
  });

  it("flags a budget that cannot outrun the interest as impossible", () => {
    const debts = [due({ id: "card", amountMinor: 1_000_000, annualRatePercent: 12 })];
    const stalled = buildDebtPlan(debts, 10_000, "avalanche", "2026-08-12");
    expect(stalled.impossible).toBe(true);
    expect(stalled.debtFreeOn).toBeNull();
    expect(stalled.monthsToDebtFree).toBe(0);
    expect(stalled.minimumMonthlyMinor).toBe(10_000);
    expect(stalled.entries).toHaveLength(1);
    expect(stalled.entries[0]).toMatchObject({ remainingMinor: 1_000_000, monthsToClear: 0, projectedClearedOn: "", interestMinor: 0 });
    expect(buildDebtPlan(debts, 12_000, "avalanche", "2026-08-12").impossible).toBe(false);
  });

  it("plans against the outstanding balance of a partly repaid debt", () => {
    const repaid = due({ id: "repaid", amountMinor: 200_000, payments: [repayment(170_000, "repaid")] });
    const plan = buildDebtPlan([repaid, due({ id: "fresh", amountMinor: 50_000 })], 40_000, "snowball", "2026-08-12");
    expect(ids(plan)).toEqual(["repaid", "fresh"]);
    expect(plan.entries[0].remainingMinor).toBe(30_000);
    expect(plan.totalRemainingMinor).toBe(80_000);
    expect(plan.monthsToDebtFree).toBe(2);
  });

  it("ignores dues that are not open borrowings", () => {
    const plan = buildDebtPlan([
      due({ id: "lent", kind: "lent" }),
      due({ id: "payment", kind: "payment" }),
      due({ id: "receivable", kind: "receivable" }),
      due({ id: "settled", status: "completed", completedOn: "2026-08-10" }),
      due({ id: "cleared", payments: [repayment(100_000, "cleared")] }),
      due({ id: "owed" }),
    ], 50_000, "snowball", "2026-08-12");
    expect(ids(plan)).toEqual(["owed"]);
  });

  it("returns an empty plan when there is nothing to pay off", () => {
    expect(buildDebtPlan([], 50_000, "snowball", "2026-08-12")).toEqual({ entries: [], totalRemainingMinor: 0, monthsToDebtFree: 0, debtFreeOn: null, totalInterestMinor: 0, minimumMonthlyMinor: 0, impossible: false });
  });

  it("clamps a projected clear date to a valid day of the month", () => {
    const plan = buildDebtPlan([due({ amountMinor: 30_000 })], 50_000, "snowball", "2026-01-31");
    expect(plan.entries[0].projectedClearedOn).toBe("2026-02-28");
    expect(plan.debtFreeOn).toBe("2026-02-28");
  });
});
