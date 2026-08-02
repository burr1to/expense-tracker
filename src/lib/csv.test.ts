import { describe, expect, it } from "vitest";
import { parseTransactionCsv, TRANSACTION_CSV_TEMPLATE } from "./csv";
import type { PaymentAccount } from "../types";

const paymentAccount: PaymentAccount = {
  id: "internal-account-1",
  importId: "11111111-1111-4111-8111-111111111111",
  userId: "user-1",
  type: "mobile_banking",
  provider: "Nabil Bank Limited",
  label: "Payroll Account",
  balanceMinor: 0,
  balanceAsOf: "2026-08-01",
  balanceRecordedAt: "2026-08-01T00:00:00.000Z",
  currentBalanceMinor: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
};

describe("parseTransactionCsv", () => {
  it("parses valid transaction rows and quoted notes", () => {
    const result = parseTransactionCsv('date,type,category,subcategory,area,note,amount,payment mode\n2026-07-11,expense,Food & Dining,Lunch,Thamel,"Lunch, team",1250,cash');
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ category: "food", subcategory: "Lunch", area: "Thamel", note: "Lunch, team", amount: "1250", paymentMode: "cash" });
  });

  it("returns row-level validation errors", () => {
    const result = parseTransactionCsv("date,type,category,amount\nnot-a-date,payment,Unknown,-10");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain("Row 2");
  });

  it("provides a template that can be imported without changes", () => {
    const result = parseTransactionCsv(`\uFEFF${TRANSACTION_CSV_TEMPLATE}`);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
  });

  it("resolves a public payment account import ID to the internal account relation", () => {
    const result = parseTransactionCsv("date,type,category,amount,payment mode,payment account id\n2026-08-01,expense,food,1250,online,11111111-1111-4111-8111-111111111111", [], [paymentAccount]);

    expect(result.errors).toEqual([]);
    expect(result.rows[0].paymentAccountId).toBe("internal-account-1");
  });

  it("continues to accept internal IDs from older transaction exports", () => {
    const result = parseTransactionCsv("date,type,category,amount,payment mode,payment account id\n2026-08-01,expense,food,1250,online,internal-account-1", [], [paymentAccount]);

    expect(result.errors).toEqual([]);
    expect(result.rows[0].paymentAccountId).toBe("internal-account-1");
  });

  it("collects unknown category names for atomic creation during import", () => {
    const result = parseTransactionCsv("date,type,category,amount,payment mode\n2026-08-01,expense,Investments,1250,cash\n2026-08-02,income,Investments,2000,cash");

    expect(result.errors).toEqual([]);
    expect(result.newCategories).toEqual([{ key: "csv:investments", name: "Investments", kind: "both", icon: "tag" }]);
    expect(result.rows.map((row) => row.category)).toEqual(["csv:investments", "csv:investments"]);
  });

  it("collects unknown subcategories beneath known and newly imported categories", () => {
    const result = parseTransactionCsv("date,type,category,subcategory,amount\n2026-08-01,expense,Food & Dining,Meal prep,1250\n2026-08-02,expense,Investments,Index funds,2000");

    expect(result.errors).toEqual([]);
    expect(result.newSubcategories).toEqual([
      { key: "csvsub:food:meal prep", category: "food", name: "Meal prep", icon: "tag" },
      { key: "csvsub:csv:investments:index funds", category: "csv:investments", name: "Index funds", icon: "tag" },
    ]);
  });

  it("does not create a category from an otherwise invalid row", () => {
    const result = parseTransactionCsv("date,type,category,amount\n2026-08-01,expense,Investments,-10");

    expect(result.rows).toEqual([]);
    expect(result.newCategories).toEqual([]);
    expect(result.newSubcategories).toEqual([]);
  });
});
