import { describe, expect, it } from "vitest";
import { parseTransactionCsv, TRANSACTION_CSV_TEMPLATE } from "./csv";

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
});
