import { describe, expect, it } from "vitest";
import { batchRowToDraft, batchSummary, frequentCategories, isBlankRow, newBatchRow, rowIssues, suggestFromHistory, type BatchDefaults } from "./batch-entry";
import type { LedgerTransaction } from "../types";

const defaults: BatchDefaults = { kind: "expense", occurredOn: "2026-10-30", paymentMode: "cash", paymentAccountId: "" };
const entry = (over: Partial<LedgerTransaction>) => ({ id: "t", userId: "u1", kind: "expense", category: "food", amountMinor: 5000, occurredOn: "2026-10-01", createdAt: "2026-10-01T00:00:00Z", note: "Tea", paymentMode: "cash", paymentAccountId: null, ...over }) as LedgerTransaction;

describe("batch rows", () => {
  it("starts from the shared defaults and blocks on amount and category", () => {
    const row = newBatchRow(defaults);
    expect(isBlankRow(row)).toBe(true);
    expect(rowIssues(row)).toEqual(["amount", "category"]);
  });

  it("needs an account for online rows", () => {
    const row = newBatchRow(defaults, { amount: "300", category: "transport", paymentMode: "online" });
    expect(rowIssues(row)).toEqual(["account"]);
  });

  it("sums out and in separately and counts blocked rows", () => {
    const rows = [
      newBatchRow(defaults, { amount: "50", category: "food" }),
      newBatchRow(defaults, { amount: "1,200", category: "other" }),
      newBatchRow(defaults, { kind: "income", amount: "80000", category: "salary" }),
      newBatchRow(defaults, { amount: "10" }),
    ];
    expect(batchSummary(rows)).toMatchObject({ count: 4, blocked: 1, outMinor: 125000 + 1000, inMinor: 8000000, ready: false });
    expect(batchSummary(rows.slice(0, 3)).ready).toBe(true);
  });

  it("turns a row into a draft that keeps its id for retry dedupe", () => {
    const row = newBatchRow(defaults, { note: " Taxi ", amount: "1,300", category: "transport", paymentMode: "cash", paymentAccountId: "stale" });
    expect(batchRowToDraft(row)).toMatchObject({ note: "Taxi", amount: "1300", paymentAccountId: "", clientRequestId: row.id, shared: false });
    expect(batchRowToDraft({ ...row, subcategory: " Taxi / ride " }).subcategory).toBe("Taxi / ride");
  });
});

describe("suggestFromHistory", () => {
  it("returns the newest matching entry for the same kind and owner", () => {
    const history = [
      entry({ category: "food", occurredOn: "2026-09-01" }),
      entry({ category: "shopping", occurredOn: "2026-10-02" }),
      entry({ category: "other", userId: "u2", occurredOn: "2026-10-20" }),
    ];
    expect(suggestFromHistory(" tea ", "expense", history, "u1")?.category).toBe("shopping");
    expect(suggestFromHistory("tea", "income", history, "u1")).toBeNull();
    expect(suggestFromHistory("t", "expense", history, "u1")).toBeNull();
  });

  it("carries the subcategory of the matching entry", () => {
    expect(suggestFromHistory("tea", "expense", [entry({ subcategory: "Cafe" })], "u1")?.subcategory).toBe("Cafe");
  });
});

describe("frequentCategories", () => {
  it("orders this owner's categories for a kind by how often they were used", () => {
    const history = [entry({ category: "food" }), entry({ category: "transport" }), entry({ category: "transport" }), entry({ category: "salary", kind: "income" }), entry({ category: "health", userId: "u2" })];
    expect(frequentCategories("expense", history, "u1")).toEqual(["transport", "food"]);
  });
});
