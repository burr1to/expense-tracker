import { describe, expect, it } from "vitest";
import { budgetScopeFor, isFullBackupCsv, lastBackupSummary, parseBackupCsv, restoredRequestId, serializeBackupCsv, type BackupRecord } from "./backup";

const exportedAt = "2026-07-26T08:00:00.000Z";
const baseRecords: BackupRecord[] = [
  { entity: "metadata", backupId: "backup", payload: { app: "SaveYoRupee", exportedAt } },
  { entity: "profile", backupId: "profile", payload: { displayName: "Personal ledger", currency: "NPR", hideAmounts: false, autoLockMinutes: 5 } },
];

describe("full backup CSV", () => {
  it("round-trips relational records, quoted text, and receipt bytes", () => {
    const records: BackupRecord[] = [
      ...baseRecords,
      { entity: "custom_category", backupId: "category-1", payload: { name: "Investments", kind: "both", color: "#557f69", icon: "money", createdAt: exportedAt, updatedAt: exportedAt } },
      { entity: "custom_subcategory", backupId: "subcategory-1", payload: { categoryId: "category-1", name: "Mutual funds", icon: "money", createdAt: exportedAt, updatedAt: exportedAt } },
      { entity: "payment_account", backupId: "account-1", payload: { importId: "11111111-1111-4111-8111-111111111111", type: "esewa", provider: "esewa", label: "Daily wallet", balanceMinor: 125000, balanceAsOf: "2026-07-25", balanceRecordedAt: exportedAt, createdAt: exportedAt, updatedAt: exportedAt } },
      { entity: "account_reconciliation", backupId: "reconciliation-1", payload: { paymentAccountId: "account-1", monthKey: "2026-07", checkedOn: "2026-07-25", startingBalanceMinor: 120000, startingBalanceAsOf: "2026-06-30", incomeMinor: 10000, expenseMinor: 5000, transfersInMinor: 0, transfersOutMinor: 0, expectedBalanceMinor: 125000, actualBalanceMinor: 125000, adjustmentMinor: 0, adjustmentNote: "", approvedAt: exportedAt, createdAt: exportedAt } },
      { entity: "transaction", backupId: "transaction-1", payload: { kind: "expense", category: "food", amountMinor: 75000, occurredOn: "2026-07-25", note: "Lunch, \"team\"\nSecond line", subcategory: "Lunch", area: "Thamel", paymentMode: "online", paymentAccountId: "account-1", locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null, locationSource: null, savedPlaceId: null, receiptScanId: "scan-1", createdAt: exportedAt, updatedAt: exportedAt } },
      { entity: "receipt", backupId: "receipt-1", payload: { transactionId: "transaction-1", dueItemId: null, name: "bill.png", mimeType: "image/png", size: 2, contentBase64: "aGk=", contentSha256: "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4", createdAt: exportedAt } },
      { entity: "receipt_scan", backupId: "scan-1", payload: { name: "camera.jpg", mimeType: "image/jpeg", size: 2, contentBase64: "aGk=", contentSha256: "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4", createdAt: exportedAt } },
    ];

    const csv = serializeBackupCsv(records);
    const parsed = parseBackupCsv(csv);

    expect(isFullBackupCsv(csv)).toBe(true);
    expect(parsed.metadata.exportedAt).toBe(exportedAt);
    expect(parsed.counts).toEqual({ custom_category: 1, custom_subcategory: 1, payment_account: 1, account_reconciliation: 1, transaction: 1, receipt: 1, receipt_scan: 1 });
    expect(parsed.records.find((record) => record.entity === "transaction")?.payload).toMatchObject({ note: "Lunch, \"team\"\nSecond line", paymentAccountId: "account-1", receiptScanId: "scan-1" });
  });

  it("rejects missing relational records before restore", () => {
    const csv = serializeBackupCsv([
      ...baseRecords,
      { entity: "transaction", backupId: "transaction-1", payload: { kind: "expense", category: "food", amountMinor: 75000, occurredOn: "2026-07-25", note: "", subcategory: null, area: null, paymentMode: "online", paymentAccountId: "missing-account", locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null, locationSource: null, savedPlaceId: null, receiptScanId: null, createdAt: exportedAt, updatedAt: exportedAt } },
    ]);

    expect(() => parseBackupCsv(csv)).toThrow("references a missing paymentAccountId");
  });

  it("gives custom categories from older backups a safe default icon", () => {
    const csv = serializeBackupCsv([
      ...baseRecords,
      { entity: "custom_category", backupId: "category-1", payload: { name: "Investments", kind: "both", color: "#557f69", createdAt: exportedAt, updatedAt: exportedAt } },
    ]);

    expect(parseBackupCsv(csv).records.find((record) => record.entity === "custom_category")?.payload).toMatchObject({ icon: "tag" });
  });

  it("rejects transactions linked to a missing receipt scan", () => {
    const csv = serializeBackupCsv([
      ...baseRecords,
      { entity: "transaction", backupId: "transaction-1", payload: { kind: "expense", category: "food", amountMinor: 75000, occurredOn: "2026-07-25", note: "", subcategory: null, area: null, paymentMode: "cash", paymentAccountId: null, locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null, locationSource: null, savedPlaceId: null, receiptScanId: "missing-scan", createdAt: exportedAt, updatedAt: exportedAt } },
    ]);

    expect(() => parseBackupCsv(csv)).toThrow("references a missing receiptScanId");
  });

  it("rejects reconciliation records linked to a missing account", () => {
    const csv = serializeBackupCsv([
      ...baseRecords,
      { entity: "account_reconciliation", backupId: "reconciliation-1", payload: { paymentAccountId: "missing-account", monthKey: "2026-07", checkedOn: "2026-07-25", startingBalanceMinor: 120000, startingBalanceAsOf: "2026-06-30", incomeMinor: 10000, expenseMinor: 5000, transfersInMinor: 0, transfersOutMinor: 0, expectedBalanceMinor: 125000, actualBalanceMinor: 125000, adjustmentMinor: 0, adjustmentNote: "", approvedAt: exportedAt, createdAt: exportedAt } },
    ]);

    expect(() => parseBackupCsv(csv)).toThrow("references a missing paymentAccountId");
  });

  it("keeps Cash in hand, IME Pay and Other accounts with their last digits", () => {
    const account = (backupId: string, type: string, provider: string, accountTail: string | null) => ({ entity: "payment_account" as const, backupId, payload: { type, provider, label: "", accountTail, balanceMinor: 5000, balanceAsOf: "2026-07-25", balanceRecordedAt: exportedAt, createdAt: exportedAt, updatedAt: exportedAt } });
    const csv = serializeBackupCsv([...baseRecords, account("cash", "cash", "Cash", null), account("ime", "ime_pay", "ime_pay", null), account("coop", "other", "Sahara Co-op", "4821")]);

    const accounts = parseBackupCsv(csv).records.filter((record) => record.entity === "payment_account");
    expect(accounts.map((record) => (record.payload as { type: string }).type)).toEqual(["cash", "ime_pay", "other"]);
    expect(accounts[2].payload).toMatchObject({ accountTail: "4821" });
    expect(() => parseBackupCsv(serializeBackupCsv([...baseRecords, account("bad", "other", "Sahara Co-op", "48211")]))).toThrow();
  });

  it("does not confuse ordinary transaction exports with full backups", () => {
    expect(isFullBackupCsv("date,type,category,amount\n2026-07-25,expense,food,750")).toBe(false);
  });

  it("accepts both legacy monthly and richer recurring schedules", () => {
    const csv = serializeBackupCsv([
      ...baseRecords,
      { entity: "payment_account", backupId: "account-1", payload: { importId: "11111111-1111-4111-8111-111111111111", type: "esewa", provider: "esewa", label: "Daily wallet", balanceMinor: 125000, balanceAsOf: "2026-07-25", balanceRecordedAt: exportedAt, createdAt: exportedAt, updatedAt: exportedAt } },
      { entity: "recurring_entry", backupId: "legacy", payload: { kind: "expense", category: "housing", amountMinor: 2000000, note: "Rent", tags: [], dayOfMonth: 1, nextDueOn: "2026-08-01", active: true, createdAt: exportedAt, updatedAt: exportedAt } },
      { entity: "recurring_entry", backupId: "fortnightly", payload: { kind: "income", category: "salary", amountMinor: 500000, paymentAccountId: "account-1", note: "Contract work", tags: [], dayOfMonth: null, recurrenceUnit: "week", recurrenceInterval: 2, anchorDate: "2026-07-27", nextDueOn: "2026-08-10", active: true, createdAt: exportedAt, updatedAt: exportedAt } },
    ]);

    const recurring = parseBackupCsv(csv).records.filter((record) => record.entity === "recurring_entry");
    expect(recurring).toHaveLength(2);
    expect(recurring[0].payload).not.toHaveProperty("recurrenceUnit");
    expect(recurring[1].payload).toMatchObject({ recurrenceUnit: "week", recurrenceInterval: 2, anchorDate: "2026-07-27", paymentAccountId: "account-1" });
  });
});

describe("later backup fields", () => {
  const dueRecord = (backupId: string, extra: Record<string, unknown> = {}): BackupRecord => ({ entity: "due_item", backupId, payload: { kind: "lent", title: "Bike repair", person: "Ram", amountMinor: 500000, category: "loan", occurredOn: "2026-07-20", dueOn: "2026-08-20", remindOn: null, snoozedUntil: null, note: "", status: "open", completedOn: null, createdAt: exportedAt, updatedAt: exportedAt, ...extra } });
  const loanMovement = (clientRequestId: string | null): BackupRecord => ({ entity: "transaction", backupId: "transaction-1", payload: { kind: "expense", category: "loan", amountMinor: 500000, occurredOn: "2026-07-20", note: "Lent to Ram", subcategory: "Lent", area: null, paymentMode: "cash", paymentAccountId: null, locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null, locationSource: null, savedPlaceId: null, receiptScanId: null, clientRequestId, createdAt: exportedAt, updatedAt: exportedAt } });

  it("keeps the newer profile settings, interest rates and loan links through the CSV", () => {
    const profile: BackupRecord = { entity: "profile", backupId: "profile", payload: { displayName: "Personal ledger", currency: "NPR", hideAmounts: true, autoLockMinutes: 5, learningEnabled: true, calendarSystem: "BS", safeToSpendBufferMinor: 250000, emailReminders: true, browserReminders: false } };
    const parsed = parseBackupCsv(serializeBackupCsv([baseRecords[0], profile, dueRecord("due-1", { annualRatePercent: 12.5 }), loanMovement("due-open:due-1")]));

    expect(parsed.records.find((record) => record.entity === "profile")?.payload).toEqual(profile.payload);
    expect(parsed.records.find((record) => record.entity === "due_item")?.payload).toMatchObject({ annualRatePercent: 12.5 });
    expect(parsed.records.find((record) => record.entity === "transaction")?.payload).toMatchObject({ clientRequestId: "due-open:due-1" });
  });

  it("still accepts a backup made before those fields existed", () => {
    const parsed = parseBackupCsv(serializeBackupCsv([...baseRecords, dueRecord("due-1"), { ...loanMovement(null), payload: { ...(loanMovement(null).payload as Record<string, unknown>), clientRequestId: undefined } }]));

    expect(parsed.records.find((record) => record.entity === "profile")?.payload).not.toHaveProperty("calendarSystem");
    expect(parsed.counts).toEqual({ due_item: 1, transaction: 1 });
  });

  it("points a loan's opening movement at its due's new id and drops links to dues that are gone", () => {
    const dueIds = new Map([["due-1", "new-due-1"]]);

    expect(restoredRequestId("due-open:due-1", dueIds)).toBe("due-open:new-due-1");
    expect(restoredRequestId("due-open:due-missing", dueIds)).toBeNull();
    expect(restoredRequestId("split:abc12345:lent", dueIds)).toBe("split:abc12345:lent");
    expect(restoredRequestId("7f9c2d1e-0000-4000-8000-000000000000", dueIds)).toBe("7f9c2d1e-0000-4000-8000-000000000000");
    expect(restoredRequestId(null, dueIds)).toBeNull();
    expect(restoredRequestId(undefined, dueIds)).toBeNull();
  });

  it("restores festival budgets as festival envelopes", () => {
    expect(budgetScopeFor("FEST:dashain-2083")).toBe("festival");
    expect(budgetScopeFor("2026-10")).toBe("month");
    expect(budgetScopeFor("BS:2083-06")).toBe("month");
  });
});

describe("lastBackupSummary", () => {
  const now = new Date("2026-10-07T12:00:00.000Z");

  it("counts Nepal calendar days since the last download", () => {
    expect(lastBackupSummary("2026-10-07T03:00:00.000Z", now)).toEqual({ label: "Last backup: today", stale: false });
    // 20:00 UTC on 6 Oct is already 7 Oct in Kathmandu.
    expect(lastBackupSummary("2026-10-06T20:00:00.000Z", now)).toEqual({ label: "Last backup: today", stale: false });
    expect(lastBackupSummary("2026-10-06T10:00:00.000Z", now)).toEqual({ label: "Last backup: yesterday", stale: false });
    expect(lastBackupSummary("2026-09-30T10:00:00.000Z", now)).toEqual({ label: "Last backup: 7 days ago", stale: false });
    expect(lastBackupSummary("2026-09-01T10:00:00.000Z", now)).toEqual({ label: "Last backup: 36 days ago", stale: true });
  });

  it("is honest when Logs hold no download", () => {
    expect(lastBackupSummary(null, now)).toEqual({ label: "No backup downloaded in the last 90 days", stale: true });
  });
});
