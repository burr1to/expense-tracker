import { describe, expect, it } from "vitest";
import type { LedgerTransaction } from "../types";
import { dailyCashFlow } from "./calendar";

const transaction = (kind: "income" | "expense", amountMinor: number, occurredOn = "2026-07-17"): LedgerTransaction => ({
  id: `${kind}-${amountMinor}`,
  userId: "user-1",
  kind,
  category: kind === "income" ? "salary" : "food",
  amountMinor,
  occurredOn,
  note: "",
  subcategory: null,
  area: null,
  paymentMode: "cash",
  paymentAccountId: null,
  createdAt: `${occurredOn}T00:00:00.000Z`,
  receipt: null,
});

describe("dailyCashFlow", () => {
  it("keeps income and expenses and calculates the signed daily net", () => {
    const totals = dailyCashFlow([
      transaction("income", 10_000),
      transaction("expense", 2_500),
      transaction("expense", 1_500),
    ]);

    expect(totals.get("2026-07-17")).toEqual({
      income: 10_000,
      expenses: 4_000,
      net: 6_000,
    });
  });

  it("groups transactions by their ledger date", () => {
    const totals = dailyCashFlow([
      transaction("income", 5_000, "2026-07-01"),
      transaction("expense", 7_000, "2026-07-02"),
    ]);

    expect(totals.get("2026-07-01")?.net).toBe(5_000);
    expect(totals.get("2026-07-02")?.net).toBe(-7_000);
  });
});
