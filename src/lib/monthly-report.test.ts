import { describe, expect, it } from "vitest";
import { bsDaysInMonth, bsToAd } from "./nepali-date";
import { buildMonthlyReport, currentMonthKey, isCompletedReportMonth, precedingMonthKey, monthlyReportNotice, type MonthlyReportInput, type MonthlyReportTransaction } from "./monthly-report";
import { generateMonthlyReportPdf } from "./monthly-report-pdf";

const transaction = (overrides: Partial<MonthlyReportTransaction> = {}): MonthlyReportTransaction => ({
  id: crypto.randomUUID(),
  kind: "expense",
  category: "food",
  categoryLabel: "Food & Dining",
  amountMinor: 10_000,
  occurredOn: "2026-07-10",
  note: "Lunch",
  subcategory: "Restaurant",
  paymentMode: "cash",
  paymentAccountId: null,
  ...overrides,
});

const input = (overrides: Partial<MonthlyReportInput> = {}): MonthlyReportInput => ({
  monthKey: "2026-07",
  displayName: "Test User",
  currency: "NPR",
  transactions: [
    transaction({ kind: "income", category: "salary", categoryLabel: "Salary", amountMinor: 100_000 }),
    transaction({ amountMinor: 25_000 }),
  ],
  previousTransactions: [
    transaction({ kind: "income", category: "salary", categoryLabel: "Salary", amountMinor: 80_000, occurredOn: "2026-06-10" }),
    transaction({ amountMinor: 20_000, occurredOn: "2026-06-11" }),
  ],
  budgets: [{ category: "food", categoryLabel: "Food & Dining", amountMinor: 30_000 }],
  accounts: [{ id: "wallet", label: "Main wallet", balanceMinor: 75_000, balanceAsOf: "2026-08-01" }],
  transfers: [],
  dues: [],
  recurring: [],
  ...overrides,
});

describe("monthly report availability", () => {
  it("rolls over at the start of a Kathmandu calendar month", () => {
    const now = new Date("2026-07-31T18:15:00.000Z");
    expect(currentMonthKey(now)).toBe("2026-08");
    expect(monthlyReportNotice([{ occurredOn: "2026-07-31" }], { now })).toMatchObject({ monthKey: "2026-07", monthLabel: "July 2026" });
    expect(isCompletedReportMonth("2026-07", now)).toBe(true);
    expect(isCompletedReportMonth("2026-08", now)).toBe(false);
  });
});

describe("BS and fiscal-year report periods", () => {
  it("accepts completed BS months and fiscal years, measured in Kathmandu", () => {
    const now = new Date("2026-10-20T06:00:00.000Z");
    expect(isCompletedReportMonth("BS:2083-06", now)).toBe(true);
    expect(isCompletedReportMonth("BS:2083-07", now)).toBe(false);
    expect(isCompletedReportMonth("FY:2082-83", now)).toBe(true);
    expect(isCompletedReportMonth("FY:2083-84", now)).toBe(false);
    expect(isCompletedReportMonth("AD:2026-08", now)).toBe(false);
    expect(isCompletedReportMonth("FEST:dashain-tihar-2083", now)).toBe(false);
  });

  it("compares a BS month with the previous BS month and spans its own days", () => {
    expect(precedingMonthKey("BS:2083-01")).toBe("BS:2082-12");
    expect(precedingMonthKey("FY:2082-83")).toBe("FY:2081-82");
    const report = buildMonthlyReport(input({ monthKey: "BS:2083-06" }));
    expect(report).toMatchObject({ monthLabel: "Ashwin 2083", periodStart: bsToAd({ year: 2083, month: 6, day: 1 }), dayCount: bsDaysInMonth(2083, 6), periodNoun: "month" });
    expect(buildMonthlyReport(input({ monthKey: "FY:2082-83" }))).toMatchObject({ monthLabel: "FY 2082/83", periodNoun: "year" });
  });
});

describe("monthly report notice", () => {
  const julyEntries = [{ occurredOn: "2026-07-10", userId: "user-1" }];

  it("is offered through the 7th of the Kathmandu month, then goes away", () => {
    expect(monthlyReportNotice(julyEntries, { now: new Date("2026-08-07T12:00:00.000Z") })).toMatchObject({ monthKey: "2026-07", href: "/api/reports/monthly?month=2026-07" });
    // 18:15 UTC on Aug 7 is already Aug 8 in Kathmandu.
    expect(monthlyReportNotice(julyEntries, { now: new Date("2026-08-07T18:15:00.000Z") })).toBeNull();
    expect(monthlyReportNotice(julyEntries, { now: new Date("2026-08-20T06:00:00.000Z") })).toBeNull();
  });

  it("needs something logged last month", () => {
    const now = new Date("2026-08-02T06:00:00.000Z");
    expect(monthlyReportNotice([], { now })).toBeNull();
    expect(monthlyReportNotice([{ occurredOn: "2026-06-30" }, { occurredOn: "2026-08-01" }], { now })).toBeNull();
    expect(monthlyReportNotice([{ occurredOn: "2026-07-01" }], { now })).not.toBeNull();
  });

  it("counts only the viewer's own entries and names a per-user, per-month storage key", () => {
    const now = new Date("2026-08-02T06:00:00.000Z");
    expect(monthlyReportNotice([{ occurredOn: "2026-07-10", userId: "partner" }], { now, viewerId: "user-1" })).toBeNull();
    expect(monthlyReportNotice(julyEntries, { now, viewerId: "user-1" })?.storageKey).toBe("syr:monthly-report-notice:user-1:2026-07");
    expect(monthlyReportNotice(julyEntries, { now })?.storageKey).toBeNull();
  });

  it("rolls over the year in January", () => {
    expect(monthlyReportNotice([{ occurredOn: "2026-12-31" }], { now: new Date("2027-01-03T06:00:00.000Z") })).toMatchObject({ monthKey: "2026-12", monthLabel: "December 2026" });
  });
});

describe("monthly report model", () => {
  it("calculates totals, month-over-month changes, and budget performance", () => {
    const report = buildMonthlyReport(input(), new Date("2026-08-01T00:00:00.000Z"));
    expect(report.summary).toMatchObject({
      incomeMinor: 100_000,
      expenseMinor: 25_000,
      netMinor: 75_000,
      savingsRate: 75,
      incomeChangePercentage: 25,
      expenseChangePercentage: 25,
    });
    expect(report.budgets[0]).toMatchObject({ spentMinor: 25_000, remainingMinor: 5_000, usedPercentage: 83 });
    expect(report.categories[0]).toMatchObject({ label: "Food & Dining", amountMinor: 25_000 });
    expect(report.incomeCategories[0]).toMatchObject({ label: "Salary", amountMinor: 100_000 });
  });

  it("measures an All spending budget against every counted expense, with a readable label", () => {
    const report = buildMonthlyReport(input({
      transactions: [transaction({ amountMinor: 25_000 }), transaction({ category: "transport", categoryLabel: "Transport", amountMinor: 5_000 }), transaction({ category: "loan", categoryLabel: "Loans & repayments", amountMinor: 50_000 })],
      budgets: [{ category: "__total", categoryLabel: "Uncategorised", amountMinor: 40_000 }, { category: "food", categoryLabel: "Food & Dining", amountMinor: 30_000 }],
    }));

    expect(report.budgets.find((budget) => budget.category === "__total")).toMatchObject({ categoryLabel: "All spending", spentMinor: 30_000, remainingMinor: 10_000, usedPercentage: 75 });
    expect(report.budgets.find((budget) => budget.category === "food")).toMatchObject({ spentMinor: 25_000 });
  });

  it("produces a downloadable multi-section PDF", () => {
    const report = buildMonthlyReport(input({ transactions: Array.from({ length: 90 }, (_, index) => transaction({ id: String(index), note: `Expense ${index}` })) }));
    const pdf = generateMonthlyReportPdf(report);
    const content = pdf.toString("latin1");
    expect(content.startsWith("%PDF-1.4")).toBe(true);
    expect(content).toContain("MONTHLY FINANCIAL REPORT");
    expect(content).toContain("Month in focus");
    expect(content).toContain("AVERAGE DAILY SPEND");
    expect(content).toContain("Detail snapshot");
    expect(content).toContain("REPORT TOTALS");
    expect(content.match(/\/BaseFont \/Helvetica(?:-Bold)?/g)).toEqual([
      "/BaseFont /Helvetica",
      "/BaseFont /Helvetica-Bold",
    ]);
    expect(content).toMatch(/\/Count [2-9]/);
    expect(content.endsWith("%%EOF\n")).toBe(true);
  });
});
