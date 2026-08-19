import { describe, expect, it } from "vitest";
import { aggregateLearningTransactions, matchLearningSuggestion, normalizeLearningOutput } from "./learning";
import type { LearningState, LedgerTransaction } from "../types";

const base = { locationLabel: null, area: "Bhatbhateni", kind: "expense", category: "food", subcategory: "Groceries", paymentMode: "online" } as Pick<LedgerTransaction, "locationLabel" | "area" | "kind" | "category" | "subcategory" | "paymentMode">;

describe("learning", () => {
  it("aggregates sanitized place/category facts without amounts, ids, or notes", () => {
    const result = aggregateLearningTransactions([base, { ...base, area: "  BHATBHATENI " }]);
    expect(result).toEqual([{ place: "Bhatbhateni", kind: "expense", category: "food", subcategory: "Groceries", paymentMode: "online", count: 2 }]);
    expect(JSON.stringify(result)).not.toMatch(/amount|note|transactionId/);
  });

  it("validates categories and subcategories returned by the model", () => {
    const categories = [{ id: "food", label: "Food", subcategories: ["Groceries"] }];
    const result = normalizeLearningOutput({ suggestions: [
      { place: "Bhatbhateni", kind: "expense", category: "food", subcategory: "Wrong", paymentMode: "online", confidence: 0.9, evidenceCount: 3 },
      { place: "Bad", kind: "expense", category: "invented", subcategory: null, paymentMode: "cash", confidence: 1, evidenceCount: 2 },
    ], summary: ["Groceries repeat at Bhatbhateni."] }, categories);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].subcategory).toBe("");
  });

  it("matches only enabled exact learned places for the current kind", () => {
    const state: LearningState = { enabled: true, suggestions: [{ place: "Bhatbhateni", kind: "expense", category: "food", subcategory: "Groceries", paymentMode: "online", confidence: 0.9, evidenceCount: 4 }], summary: [], lastTransactionId: "t1", lastRunAt: null };
    expect(matchLearningSuggestion(state, "bhatbhateni", "expense")?.category).toBe("food");
    expect(matchLearningSuggestion({ ...state, enabled: false }, "bhatbhateni", "expense")).toBeNull();
    expect(matchLearningSuggestion(state, "Bhat", "expense")).toBeNull();
  });
});
