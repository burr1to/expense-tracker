import { describe, expect, it } from "vitest";
import { parseTransactionCsv } from "./csv";

describe("parseTransactionCsv", () => {
  it("parses valid transaction rows and quoted notes", () => {
    const result = parseTransactionCsv('date,type,category,note,amount,tags\n2026-07-11,expense,Food & Dining,"Lunch, team",1250,"work, food"');
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ category: "food", note: "Lunch, team", amount: "1250" });
  });

  it("returns row-level validation errors", () => {
    const result = parseTransactionCsv("date,type,category,amount\nnot-a-date,payment,Unknown,-10");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain("Row 2");
  });
});
