import { describe, expect, it } from "vitest";
import { CATEGORIES } from "./categories";
import { countImportDuplicates, detectRecurringPatterns, parseVoiceTransaction, transactionWarnings } from "./transaction-intelligence";
import type { LedgerTransaction, PaymentAccount, RecurringEntry, TransactionDraft } from "../types";

const transaction = (changes: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  id: "t1", userId: "u1", kind: "expense", category: "utilities", amountMinor: 100_000, occurredOn: "2026-01-01", note: "Internet", subcategory: null, area: "Home",
  paymentMode: "cash", paymentAccountId: null, locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null, locationSource: null, savedPlaceId: null, createdAt: "2026-01-01T08:00:00.000Z", ...changes,
});

describe("transaction intelligence", () => {
  it("detects a stable monthly pattern and suppresses an existing schedule", () => {
    const history = [
      transaction({ id: "a", occurredOn: "2026-01-03" }),
      transaction({ id: "b", occurredOn: "2026-02-03", amountMinor: 101_000 }),
      transaction({ id: "c", occurredOn: "2026-03-03", amountMinor: 99_500 }),
      transaction({ id: "d", occurredOn: "2026-04-03" }),
    ];
    const [pattern] = detectRecurringPatterns(history);
    expect(pattern).toMatchObject({ recurrenceUnit: "month", recurrenceInterval: 1, evidenceCount: 4, category: "utilities" });
    const scheduled: RecurringEntry = { id: "r1", userId: "u1", kind: "expense", category: "utilities", amountMinor: 100_000, paymentAccountId: null, note: "Internet", tags: [], dayOfMonth: 3, recurrenceUnit: "month", recurrenceInterval: 1, anchorDate: "2026-01-03", nextDueOn: "2026-05-03", active: true };
    expect(detectRecurringPatterns(history, [scheduled])).toEqual([]);
  });

  it("warns about exact duplicates and robustly unusual expenses without blocking", () => {
    const history = Array.from({ length: 6 }, (_, index) => transaction({ id: `h${index}`, occurredOn: `2026-01-${String(index + 1).padStart(2, "0")}`, category: "food", amountMinor: 10_000 + index * 100, note: "Lunch", area: "Thamel" }));
    const duplicate = transactionWarnings({ kind: "expense", category: "food", amountMinor: 10_000, occurredOn: "2026-01-01", note: "Lunch", area: "Thamel", paymentMode: "cash", paymentAccountId: "" }, history);
    expect(duplicate[0]?.type).toBe("duplicate");
    const unusual = transactionWarnings({ kind: "expense", category: "food", amountMinor: 100_000, occurredOn: "2026-02-01", note: "Dinner", area: "", paymentMode: "cash", paymentAccountId: "" }, history);
    expect(unusual.some((warning) => warning.type === "unusual")).toBe(true);
  });

  it("counts duplicate imports against history and inside the same file", () => {
    const draft: TransactionDraft = { kind: "expense", category: "utilities", amount: "1000", occurredOn: "2026-01-01", note: "Internet", subcategory: "", area: "Home", paymentMode: "cash", paymentAccountId: "" };
    expect(countImportDuplicates([draft, draft], [transaction()])).toBe(2);
  });

  it("parses useful voice fields while leaving the result reviewable", () => {
    const account: PaymentAccount = { id: "p1", importId: "import-1", userId: "u1", type: "esewa", provider: "esewa", label: "Daily wallet", balanceMinor: 0, balanceAsOf: "2026-01-01", balanceRecordedAt: "2026-01-01T00:00:00.000Z", currentBalanceMinor: 0, createdAt: "2026-01-01T00:00:00.000Z" };
    const result = parseVoiceTransaction("Expense four hundred fifty food at Thamel via eSewa yesterday", CATEGORIES, [account], new Date("2026-08-11T08:00:00Z"));
    expect(result).toMatchObject({ amount: "450", kind: "expense", category: "food", area: "Thamel", paymentMode: "online", paymentAccountId: "p1", occurredOn: "2026-08-10" });
  });
});
