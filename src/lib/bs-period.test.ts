import { describe, expect, it } from "vitest";
import { buildBudgetCarryForward } from "./budgets";
import { formatLedgerMonth, isInMonth, monthKey, periodRange } from "./dates";
import { generateInsights, projectMonth } from "./insights";
import { buildMonthSnapshot } from "./month-snapshot";
import { bsToAd } from "./nepali-date";
import { addDaysToIso, convertMonthKey, daysInPeriod } from "./period";
import { calculateBudgetPacing, calculateMonthlyBreathingRoom } from "./planning-insights";
import type { Budget, LedgerTransaction } from "../types";

/**
 * Bikram Sambat month browsing: a "BS:" period is exactly that BS month's days,
 * even though it straddles two Gregorian months, and AD keys behave as the
 * Gregorian `Date` markers always have.
 */
const ASHWIN = "BS:2083-06";
const ashwinFirst = bsToAd({ year: 2083, month: 6, day: 1 });
const kartikFirst = bsToAd({ year: 2083, month: 7, day: 1 });
const ashwinLast = addDaysToIso(kartikFirst, -1);
const bhadraLast = addDaysToIso(ashwinFirst, -1);

const transaction = (occurredOn: string, amountMinor: number, overrides: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  id: `${occurredOn}-${amountMinor}-${overrides.category ?? "food"}`,
  userId: "user-1",
  kind: "expense",
  category: "food",
  amountMinor,
  occurredOn,
  note: "",
  subcategory: null,
  area: null,
  paymentMode: "cash",
  paymentAccountId: null,
  locationLabel: null,
  locationAddress: null,
  locationLatitude: null,
  locationLongitude: null,
  locationAccuracy: null,
  locationSource: null,
  savedPlaceId: null,
  createdAt: `${occurredOn}T00:00:00.000Z`,
  ...overrides,
});
const budget = (overrides: Partial<Budget>): Budget => ({ id: overrides.id ?? "budget-1", userId: "user-1", monthKey: "BS:2083-06", category: "food", amountMinor: 3_100_000, ...overrides });
const localNoon = (iso: string) => { const [year, month, day] = iso.split("-").map(Number); return new Date(year, month - 1, day, 12); };

describe("a BS period", () => {
  it("spans a Gregorian month boundary and covers exactly its own days", () => {
    expect(ashwinFirst.slice(0, 7)).toBe("2026-09");
    expect(ashwinLast.slice(0, 7)).toBe("2026-10");
    const range = periodRange(ASHWIN);
    expect(range).toEqual({ start: ashwinFirst, end: ashwinLast, endExclusive: kartikFirst, days: daysInPeriod(ASHWIN) });
    expect(isInMonth(ashwinFirst, ASHWIN)).toBe(true);
    expect(isInMonth(ashwinLast, ASHWIN)).toBe(true);
    expect(isInMonth("2026-09-30", ASHWIN)).toBe(true);
    expect(isInMonth("2026-10-01", ASHWIN)).toBe(true);
    expect(isInMonth(bhadraLast, ASHWIN)).toBe(false);
    expect(isInMonth(kartikFirst, ASHWIN)).toBe(false);
  });

  it("is named as itself and stored under its BS key", () => {
    expect(formatLedgerMonth(ASHWIN, "BS")).toBe("Ashwin 2083");
    expect(monthKey(ASHWIN)).toBe("BS:2083-06");
    expect(monthKey("AD:2026-09")).toBe("2026-09");
  });

  it("re-keys between calendars without losing the month", () => {
    const now = new Date(`${addDaysToIso(ashwinFirst, 3)}T06:00:00Z`);
    expect(convertMonthKey("AD:2026-09", "BS", now)).toBe("BS:2083-06");
    expect(convertMonthKey("BS:2083-06", "AD", now)).toBe("AD:2026-09");
    // A month other than the current one maps by its middle day.
    expect(convertMonthKey("AD:2026-11", "BS", now)).toBe("BS:2083-07");
  });

  it("feeds the month's money views only Ashwin's entries", () => {
    const entries = [transaction(bhadraLast, 900_000), transaction(ashwinFirst, 100_000), transaction("2026-09-30", 200_000), transaction(ashwinLast, 300_000), transaction(kartikFirst, 800_000)];
    const room = calculateMonthlyBreathingRoom(entries, [], [], ASHWIN, localNoon(kartikFirst));
    expect(room.loggedExpensesMinor).toBe(600_000);
    const snapshot = buildMonthSnapshot({ month: ASHWIN, today: addDaysToIso(kartikFirst, 5), transactions: entries, recurringEntries: [], dueItems: [], budgetPacing: [] });
    expect(snapshot).toMatchObject({ timing: "past", spentMinor: 600_000 });
    expect(snapshot.target).toMatchObject({ kind: "previousMonth", previousMonth: "BS:2083-05", previousMinor: 900_000 });
    const insights = generateInsights(entries, ASHWIN, "NPR", [], { today: addDaysToIso(kartikFirst, 5), calendarSystem: "BS" });
    expect(insights.find((item) => item.id === "month-change")?.detail).toBe("Compared with all of Bhadra 2083.");
  });

  it("projects the rest of the month over the BS month's own days", () => {
    const days = daysInPeriod(ASHWIN);
    const today = addDaysToIso(ashwinFirst, 9);
    // 10 days in at NPR 1,000 a day: the remaining days continue at that pace.
    const result = projectMonth([transaction(ashwinFirst, 1_000_000, { kind: "income", category: "salary" }), transaction(today, 1_000_000)], [], [], ASHWIN, today);
    expect(result.expensesMinor).toBe(1_000_000 + Math.round((1_000_000 / 10) * (days - 10)));
  });
});

describe("budget pacing for a BS month", () => {
  it("counts Ashwin's expenses and paces over daysInPeriod", () => {
    const days = daysInPeriod(ASHWIN);
    const today = addDaysToIso(ashwinFirst, 9);
    const entries = [transaction(bhadraLast, 5_000_000), transaction("2026-09-30", 400_000), transaction(kartikFirst, 5_000_000)];
    const [pacing] = calculateBudgetPacing([budget({}), budget({ id: "ad", monthKey: "2026-09" })], entries, [], [], ASHWIN, localNoon(today));
    expect(pacing.budget.id).toBe("budget-1");
    expect(pacing.spentMinor).toBe(400_000);
    expect(pacing.elapsedPercentage).toBe(Math.round((10 / days) * 100));
    expect(pacing.remainingDays).toBe(days - 9);
    expect(pacing.dailyAllowanceMinor).toBe(Math.floor((3_100_000 - 400_000) / (days - 9)));
  });

  it("leaves AD pacing exactly as the Date marker did", () => {
    const july = [budget({ monthKey: "2026-07" })];
    const entries = [transaction("2026-06-30", 900_000), transaction("2026-07-10", 700_000), transaction("2026-08-01", 900_000)];
    const viaKey = calculateBudgetPacing(july, entries, [], [], "AD:2026-07", new Date(2026, 6, 10));
    const viaDate = calculateBudgetPacing(july, entries, [], [], new Date(2026, 6, 1), new Date(2026, 6, 10));
    expect(viaKey).toEqual(viaDate);
    expect(viaKey[0]).toMatchObject({ spentMinor: 700_000, remainingDays: 22, elapsedPercentage: 32 });
  });
});

describe("carrying BS budgets forward", () => {
  it("offers the previous BS month's budgets with Ashwin's actual spending", () => {
    const budgets = [budget({ id: "ashwin-food" }), budget({ id: "september-food", monthKey: "2026-09", category: "housing" })];
    const entries = [transaction(bhadraLast, 5_000_000), transaction("2026-09-30", 400_000), transaction(ashwinLast, 100_000), transaction(kartikFirst, 5_000_000)];
    const plan = buildBudgetCarryForward(budgets, entries, "BS:2083-07", "user-1", addDaysToIso(kartikFirst, 2))!;
    expect(plan.previousMonthKey).toBe("BS:2083-06");
    expect(plan.rows).toEqual([expect.objectContaining({ category: "food", lastLimitMinor: 3_100_000, lastActualMinor: 500_000 })]);
  });

  it("offers nothing once the BS month is over, or when it already has budgets", () => {
    const budgets = [budget({ id: "ashwin-food" })];
    expect(buildBudgetCarryForward(budgets, [], "BS:2083-07", "user-1", addDaysToIso(kartikFirst, 40))).toBeNull();
    expect(buildBudgetCarryForward([...budgets, budget({ id: "kartik", monthKey: "BS:2083-07" })], [], "BS:2083-07", "user-1", kartikFirst)).toBeNull();
  });
});
