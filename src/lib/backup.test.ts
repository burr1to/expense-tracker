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
      { entity: "transaction", backupId: "transaction-1", payload: { kind: "expense", category: "food", amountMinor: 75000, occurredOn: "2026-07-25", note: "Lunch, \"team\"\nSecond line", subcategory: "Lunch", area: "Thamel", paymentMode: "online", paymentAccountId: "account-1", locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null, locationSource: null, savedPlaceId: null, receiptScanId: "scan-1", createdAt: exportedAt, updatedAt: exportedAt } },
      { entity: "receipt", backupId: "receipt-1", payload: { transactionId: "transaction-1", dueItemId: null, name: "bill.png", mimeType: "image/png", size: 2, contentBase64: "aGk=", contentSha256: "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4", createdAt: exportedAt } },
      { entity: "receipt_scan", backupId: "scan-1", payload: { name: "camera.jpg", mimeType: "image/jpeg", size: 2, contentBase64: "aGk=", contentSha256: "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4", createdAt: exportedAt } },
    ];

    const csv = serializeBackupCsv(records);
    const parsed = parseBackupCsv(csv);

    expect(isFullBackupCsv(csv)).toBe(true);
    expect(parsed.metadata.exportedAt).toBe(exportedAt);
    expect(parsed.counts).toEqual({ payment_account: 1, transaction: 1, receipt: 1, receipt_scan: 1 });
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

  it("does not confuse ordinary transaction exports with full backups", () => {
    expect(isFullBackupCsv("date,type,category,amount\n2026-07-25,expense,food,750")).toBe(false);
  });
});
