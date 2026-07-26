import { describe, expect, it } from "vitest";
import { buildMonthlyReport, currentMonthKey, isCompletedReportMonth, monthlyReportNotice, type MonthlyReportInput, type MonthlyReportTransaction } from "./monthly-report";
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
    expect(monthlyReportNotice(now)).toMatchObject({ monthKey: "2026-07", monthLabel: "July 2026" });
    expect(isCompletedReportMonth("2026-07", now)).toBe(true);
    expect(isCompletedReportMonth("2026-08", now)).toBe(false);
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

  it("produces a downloadable multi-section PDF", () => {
    const report = buildMonthlyReport(input({ transactions: Array.from({ length: 90 }, (_, index) => transaction({ id: String(index), note: `Expense ${index}` })) }));
    const pdf = generateMonthlyReportPdf(report);
    const content = pdf.toString("latin1");
    expect(content.startsWith("%PDF-1.4")).toBe(true);
    expect(content).toContain("MONTHLY FINANCIAL REPORT");
    expect(content).toMatch(/\/Count [2-9]/);
    expect(content.endsWith("%%EOF\n")).toBe(true);
  });
});
