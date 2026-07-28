import { describe, expect, it } from "vitest";
import { isFullBackupCsv, parseBackupCsv, serializeBackupCsv, type BackupRecord } from "./backup";

const exportedAt = "2026-07-26T08:00:00.000Z";
const baseRecords: BackupRecord[] = [
  { entity: "metadata", backupId: "backup", payload: { app: "SaveYoRupee", exportedAt } },
  { entity: "profile", backupId: "profile", payload: { displayName: "Personal ledger", currency: "NPR", hideAmounts: false, autoLockMinutes: 5 } },
];

describe("full backup CSV", () => {
  it("round-trips relational records, quoted text, and receipt bytes", () => {
    const records: BackupRecord[] = [
      ...baseRecords,
      { entity: "payment_account", backupId: "account-1", payload: { type: "esewa", provider: "esewa", label: "Daily wallet", balanceMinor: 125000, balanceAsOf: "2026-07-25", balanceRecordedAt: exportedAt, createdAt: exportedAt, updatedAt: exportedAt } },
      { entity: "account_reconciliation", backupId: "reconciliation-1", payload: { paymentAccountId: "account-1", monthKey: "2026-07", checkedOn: "2026-07-25", startingBalanceMinor: 120000, startingBalanceAsOf: "2026-06-30", incomeMinor: 10000, expenseMinor: 5000, transfersInMinor: 0, transfersOutMinor: 0, expectedBalanceMinor: 125000, actualBalanceMinor: 125000, adjustmentMinor: 0, adjustmentNote: "", approvedAt: exportedAt, createdAt: exportedAt } },
      { entity: "transaction", backupId: "transaction-1", payload: { kind: "expense", category: "food", amountMinor: 75000, occurredOn: "2026-07-25", note: "Lunch, \"team\"\nSecond line", subcategory: "Lunch", area: "Thamel", paymentMode: "online", paymentAccountId: "account-1", locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null, locationSource: null, savedPlaceId: null, receiptScanId: "scan-1", createdAt: exportedAt, updatedAt: exportedAt } },
      { entity: "receipt", backupId: "receipt-1", payload: { transactionId: "transaction-1", dueItemId: null, name: "bill.png", mimeType: "image/png", size: 2, contentBase64: "aGk=", contentSha256: "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4", createdAt: exportedAt } },
      { entity: "receipt_scan", backupId: "scan-1", payload: { name: "camera.jpg", mimeType: "image/jpeg", size: 2, contentBase64: "aGk=", contentSha256: "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4", createdAt: exportedAt } },
    ];

    const csv = serializeBackupCsv(records);
    const parsed = parseBackupCsv(csv);

    expect(isFullBackupCsv(csv)).toBe(true);
    expect(parsed.metadata.exportedAt).toBe(exportedAt);
    expect(parsed.counts).toEqual({ payment_account: 1, account_reconciliation: 1, transaction: 1, receipt: 1, receipt_scan: 1 });
    expect(parsed.records.find((record) => record.entity === "transaction")?.payload).toMatchObject({ note: "Lunch, \"team\"\nSecond line", paymentAccountId: "account-1", receiptScanId: "scan-1" });
  });

  it("rejects missing relational records before restore", () => {
    const csv = serializeBackupCsv([
      ...baseRecords,
      { entity: "transaction", backupId: "transaction-1", payload: { kind: "expense", category: "food", amountMinor: 75000, occurredOn: "2026-07-25", note: "", subcategory: null, area: null, paymentMode: "online", paymentAccountId: "missing-account", locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null, locationSource: null, savedPlaceId: null, receiptScanId: null, createdAt: exportedAt, updatedAt: exportedAt } },
    ]);

    expect(() => parseBackupCsv(csv)).toThrow("references a missing paymentAccountId");
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

  it("does not confuse ordinary transaction exports with full backups", () => {
    expect(isFullBackupCsv("date,type,category,amount\n2026-07-25,expense,food,750")).toBe(false);
  });

  it("accepts both legacy monthly and richer recurring schedules", () => {
    const csv = serializeBackupCsv([
      ...baseRecords,
      { entity: "recurring_entry", backupId: "legacy", payload: { kind: "expense", category: "housing", amountMinor: 2000000, note: "Rent", tags: [], dayOfMonth: 1, nextDueOn: "2026-08-01", active: true, createdAt: exportedAt, updatedAt: exportedAt } },
      { entity: "recurring_entry", backupId: "fortnightly", payload: { kind: "income", category: "salary", amountMinor: 500000, note: "Contract work", tags: [], dayOfMonth: null, recurrenceUnit: "week", recurrenceInterval: 2, anchorDate: "2026-07-27", nextDueOn: "2026-08-10", active: true, createdAt: exportedAt, updatedAt: exportedAt } },
    ]);

    const recurring = parseBackupCsv(csv).records.filter((record) => record.entity === "recurring_entry");
    expect(recurring).toHaveLength(2);
    expect(recurring[0].payload).not.toHaveProperty("recurrenceUnit");
    expect(recurring[1].payload).toMatchObject({ recurrenceUnit: "week", recurrenceInterval: 2, anchorDate: "2026-07-27" });
  });
});
