import { describe, expect, it } from "vitest";
import { normalizeStatementAnalysis, statementAnalysisRequestSchema } from "./statement-analysis";

const categories = [{ id: "food", label: "Food", subcategories: ["Groceries"] }];

describe("statement analysis", () => {
  it("normalizes validated statement rows into reviewable drafts", () => {
    const result = normalizeStatementAnalysis({ currency: "NPR", rows: [{ occurredOn: "2026-08-01", kind: "expense", amountMinor: 125_000, description: "Grocery debit", category: "food", subcategory: "Groceries", confidence: 0.92 }], warnings: [] }, "NPR", categories);
    expect(result.rows[0]).toEqual({ kind: "expense", category: "food", amount: "1250.00", occurredOn: "2026-08-01", note: "Grocery debit", subcategory: "Groceries", area: "", paymentMode: "cash", paymentAccountId: "" });
  });

  it("drops unavailable categories, clears invalid subcategories, and warns on currency mismatch", () => {
    const result = normalizeStatementAnalysis({ currency: "USD", rows: [
      { occurredOn: "2026-08-01", kind: "expense", amountMinor: 100, description: "Known", category: "food", subcategory: "Invented", confidence: 0.4 },
      { occurredOn: "2026-08-02", kind: "expense", amountMinor: 100, description: "Unknown", category: "invented", subcategory: null, confidence: 1 },
    ], warnings: [] }, "NPR", categories);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].subcategory).toBe("");
    expect(result.warnings.join(" ")).toMatch(/USD|Low confidence/);
  });

  it("requires either statement text or images", () => {
    expect(statementAnalysisRequestSchema.safeParse({ name: "empty.pdf" }).success).toBe(false);
  });
});
