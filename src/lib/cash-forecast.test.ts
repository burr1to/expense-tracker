import { describe, expect, it } from "vitest";
import { forecastCash } from "./cash-forecast";
import type { DueItem, LedgerTransaction, RecurringEntry } from "../types";

const transaction = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: "t1", userId: "user-1", kind: "expense", category: "food", amountMinor: 30000, occurredOn: "2026-09-20",
  note: "", subcategory: null, area: null, paymentMode: "online", paymentAccountId: "acct",
  locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null, locationSource: null, savedPlaceId: null,
  createdAt: "2026-09-20T00:00:00.000Z", ...overrides,
});

const recurring = (overrides: Partial<RecurringEntry>): RecurringEntry => ({
  id: "r1", userId: "user-1", kind: "expense", category: "housing", amountMinor: 100000, paymentAccountId: "acct",
  note: "Rent", tags: [], dayOfMonth: 1, recurrenceUnit: "month", recurrenceInterval: 1, anchorDate: "2026-10-01", nextDueOn: "2026-10-01", active: true,
  ...overrides,
});

const due = (overrides: Partial<DueItem>): DueItem => ({
  id: "d1", userId: "user-1", kind: "payment", title: "EMI", person: "Bank", amountMinor: 50000, category: "housing",
  occurredOn: null, dueOn: "2026-09-20", remindOn: null, snoozedUntil: null, note: "", status: "open", annualRatePercent: null,
  completedOn: null, createdAt: "2026-09-01T00:00:00.000Z", payments: [], ...overrides,
});

describe("forecastCash", () => {
  it("keeps cash spending out of the online pace and subtracts a scheduled bill once", () => {
    const result = forecastCash({
      startingBalanceMinor: 1_000_000,
      today: "2026-09-25",
      transactions: [
        transaction({ amountMinor: 30000, paymentMode: "online", occurredOn: "2026-09-20" }),
        transaction({ id: "cash", amountMinor: 90000, paymentMode: "cash", occurredOn: "2026-09-21" }),
      ],
      recurringEntries: [recurring({ nextDueOn: "2026-10-01", amountMinor: 100000 })],
      dueItems: [],
    });

    expect(result.dailyPaceMinor).toBe(Math.round(30000 / 30));
    const rentDay = result.days.find((day) => day.date === "2026-10-01");
    expect(rentDay?.billsMinor).toBe(100000);
    expect(result.day30.balanceMinor).toBe(1_000_000 - 100000 - result.dailyPaceMinor * 30);
  });

  it("does not put an already paid account bill into the daily pace", () => {
    const result = forecastCash({
      startingBalanceMinor: 500000,
      today: "2026-09-25",
      transactions: [transaction({ amountMinor: 100000, occurredOn: "2026-09-01" }), transaction({ id: "coffee", amountMinor: 30000, occurredOn: "2026-09-20" })],
      recurringEntries: [recurring({ anchorDate: "2026-09-01", nextDueOn: "2026-10-01", amountMinor: 100000 })],
      dueItems: [],
    });

    expect(result.dailyPaceMinor).toBe(Math.round(30000 / 30));
  });

  it("lands an overdue due on the first forecast day and adds money owed to you", () => {
    const result = forecastCash({
      startingBalanceMinor: 200000,
      today: "2026-09-25",
      transactions: [],
      recurringEntries: [],
      dueItems: [
        due({ dueOn: "2026-09-20", amountMinor: 40000 }),
        due({ id: "in", kind: "receivable", title: "Refund", dueOn: "2026-09-30", amountMinor: 15000 }),
      ],
    });

    expect(result.days[0]).toMatchObject({ date: "2026-09-26", duesMinor: 40000 });
    expect(result.days.find((day) => day.date === "2026-09-30")?.incomeMinor).toBe(15000);
    expect(result.lowest.balanceMinor).toBeLessThan(result.startingBalanceMinor);
  });
});
