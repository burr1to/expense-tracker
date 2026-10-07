import { describe, expect, it } from "vitest";
import { formatLedgerMonth } from "./dates";
import { generateInsights, projectMonth } from "./insights";
import type { LedgerTransaction, RecurringEntry } from "../types";

const transaction = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: overrides.id ?? `t-${overrides.occurredOn}-${overrides.amountMinor}`,
  userId: "user-1",
  kind: "expense",
  category: "food",
  amountMinor: 100000,
  occurredOn: "2026-10-01",
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
  createdAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});
const recurring = (overrides: Partial<RecurringEntry>): RecurringEntry => ({
  id: overrides.id ?? "recurring-1",
  userId: "user-1",
  kind: "expense",
  category: "housing",
  amountMinor: 2_500_000,
  paymentAccountId: null,
  note: "Rent",
  tags: [],
  dayOfMonth: 1,
  recurrenceUnit: "month",
  recurrenceInterval: 1,
  anchorDate: "2026-09-01",
  nextDueOn: "2026-11-01",
  active: true,
  ...overrides,
});
const salary = (occurredOn: string, amountMinor = 8_000_000) => transaction({ kind: "income", category: "salary", amountMinor, occurredOn });
const october = new Date(2026, 9, 1);
const insight = (list: ReturnType<typeof generateInsights>, id: string) => list.find((item) => item.id === id);

describe("generateInsights projection", () => {
  it("never stretches a day-1 salary across the month", () => {
    const insights = generateInsights([
      salary("2026-10-01"),
      transaction({ amountMinor: 200000, occurredOn: "2026-10-01" }),
      transaction({ amountMinor: 200000, occurredOn: "2026-10-02" }),
      transaction({ amountMinor: 200000, occurredOn: "2026-10-03" }),
    ], october, "NPR", [], { today: "2026-10-03" });

    // 80,000 in, 6,000 spent over 3 days → 2,000/day for 31 days = 62,000 out. Not 7,64,700.
    expect(insight(insights, "projection")).toMatchObject({ tone: "positive", title: "On track to save", amountMinor: 1_800_000 });
  });

  it("does not pace rent paid on day one as daily spending", () => {
    const result = projectMonth([
      salary("2026-10-01"),
      transaction({ category: "housing", note: "Rent", amountMinor: 2_500_000, occurredOn: "2026-10-01" }),
      transaction({ amountMinor: 300000, occurredOn: "2026-10-03" }),
    ], [recurring({ nextDueOn: "2026-11-01" })], [], october, "2026-10-03");

    // Rent once, plus 3,000 of day-to-day spending paced at 1,000/day for the 28 days left.
    expect(result.expensesMinor).toBe(2_500_000 + 300000 + 2_800_000);
    expect(result.netMinor).toBe(8_000_000 - 5_600_000);
  });

  it("adds income and bills still to come this month, but not next month's", () => {
    const result = projectMonth(
      [transaction({ amountMinor: 1_000_000, occurredOn: "2026-10-05" })],
      [
        recurring({ id: "salary", kind: "income", category: "salary", note: "Salary", amountMinor: 8_000_000, anchorDate: "2026-09-15", nextDueOn: "2026-10-15" }),
        recurring({ id: "internet", amountMinor: 150000, note: "Internet", anchorDate: "2026-09-05", nextDueOn: "2026-10-05" }),
      ],
      [],
      october,
      "2026-10-10",
    );

    // The unconfirmed internet bill from the 5th still counts; November's salary does not.
    expect(result.incomeMinor).toBe(8_000_000);
    expect(result.expensesMinor).toBe(1_000_000 + 150000 + Math.round((1_000_000 / 10) * 21));
  });

  it("leaves last month's unconfirmed occurrence out of this month's projection", () => {
    const result = projectMonth(
      [salary("2026-10-01")],
      [recurring({ id: "internet", amountMinor: 150000, note: "Internet", dayOfMonth: 28, anchorDate: "2026-08-28", nextDueOn: "2026-09-28" })],
      [],
      october,
      "2026-10-03",
    );

    // September 28 stays September's bill; only October 28 is still to come this month.
    expect(result.expensesMinor).toBe(150000);
    expect(result.incomeMinor).toBe(8_000_000);
  });

  it("keeps the projection among the first three insights the dashboard shows", () => {
    const insights = generateInsights([
      transaction({ amountMinor: 500000, occurredOn: "2026-09-02" }),
      salary("2026-10-01"),
      transaction({ amountMinor: 400000, occurredOn: "2026-10-01" }),
      transaction({ category: "transport", amountMinor: 200000, occurredOn: "2026-10-02" }),
    ], october, "NPR", [], { today: "2026-10-03" });

    expect(insights.slice(0, 3).map((item) => item.id)).toEqual(["top-category", "month-change", "projection"]);
    // The costliest-day insight carries no unmasked amount.
    expect(insight(insights, "spend-day")).toMatchObject({ title: "Thursday is your costliest day", detail: "67% of this month’s spending was logged on Thursdays." });
  });

  it("warns about a shortfall when spending pace outruns income", () => {
    const insights = generateInsights([
      salary("2026-10-01", 1_000_000),
      transaction({ amountMinor: 900000, occurredOn: "2026-10-04" }),
    ], october, "NPR", [], { today: "2026-10-10" });

    expect(insight(insights, "projection")).toMatchObject({ tone: "attention", title: "Heading for a shortfall of", amountMinor: 1_790_000 });
  });

  it("states what was saved in a finished month instead of projecting it", () => {
    const insights = generateInsights([salary("2026-09-01"), transaction({ amountMinor: 6_000_000, occurredOn: "2026-09-12" })], new Date(2026, 8, 1), "NPR", [], { today: "2026-10-07" });

    expect(insight(insights, "projection")).toMatchObject({ title: "You saved", amountMinor: 2_000_000, detail: "25% of September 2026 income." });
  });
});

describe("generateInsights month comparison", () => {
  const september = [
    transaction({ amountMinor: 700000, occurredOn: "2026-09-04" }),
    transaction({ amountMinor: 3_800_000, occurredOn: "2026-09-20" }),
  ];

  it("compares mid-month spending with last month up to the same day", () => {
    const insights = generateInsights([...september, transaction({ amountMinor: 1_000_000, occurredOn: "2026-10-06" })], october, "NPR", [], { today: "2026-10-07" });

    // 10,000 so far against 7,000 by 7 September, not against September's full 45,000.
    expect(insight(insights, "month-change")).toMatchObject({ tone: "attention", title: "Spending is up 43%", detail: "Compared with September 2026 up to the same day." });
  });

  it("compares whole months once the month is over", () => {
    const insights = generateInsights([...september, transaction({ amountMinor: 2_250_000, occurredOn: "2026-10-06" })], october, "NPR", [], { today: "2026-11-02" });

    expect(insight(insights, "month-change")).toMatchObject({ tone: "positive", title: "Spending is down 50%", detail: "Compared with all of September 2026." });
  });

  it("names the previous month in the user's calendar", () => {
    const insights = generateInsights([...september, transaction({ amountMinor: 700000, occurredOn: "2026-10-02" })], october, "NPR", [], { today: "2026-10-07", calendarSystem: "BS" });
    const detail = insight(insights, "month-change")?.detail ?? "";

    expect(detail).toBe(`Compared with ${formatLedgerMonth(new Date(2026, 8, 1), "BS")} up to the same day.`);
    expect(detail).not.toContain("September");
  });
});
