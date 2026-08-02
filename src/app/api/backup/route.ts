import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, getBetaSession } from "../../../lib/auth";
import {
  BACKUP_MAX_BYTES,
  type BackupEntity,
  type BackupPayload,
  type BackupRecord,
  parseBackupCsv,
  serializeBackupCsv,
} from "../../../lib/backup";
import { getPrisma } from "../../../lib/prisma";
import {
  ensureReceiptsBucket,
  getSupabaseStorageAdmin,
  newReceiptPath,
  RECEIPTS_BUCKET,
  removeStoredReceipts,
} from "../../../lib/receipt-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const dateOnly = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const iso = (value: Date) => value.toISOString();
const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const asDateTime = (value: string) => new Date(value);

function recordsOf<E extends BackupEntity>(records: readonly BackupRecord[], entity: E) {
  return records
    .filter((record) => record.entity === entity)
    .map((record) => ({ backupId: record.backupId, payload: record.payload as BackupPayload<E> }));
}

async function receiptBase64(receipt: { storagePath: string | null; data?: Uint8Array<ArrayBufferLike> | null }) {
  if (receipt.storagePath) {
    await ensureReceiptsBucket();
    const { data, error } = await getSupabaseStorageAdmin().storage.from(RECEIPTS_BUCKET).download(receipt.storagePath);
    if (error || !data) throw new Error("A receipt file could not be read. The backup was not created.");
    return Buffer.from(await data.arrayBuffer()).toString("base64");
  }
  if (!receipt.data) throw new Error("A receipt file is missing. The backup was not created.");
  return Buffer.from(receipt.data).toString("base64");
}

async function buildBackup(userId: string) {
  const db = getPrisma();
  const [user, categories, subcategories, savedPlaces, accounts, reconciliations, transactions, transfers, budgets, recurring, goals, dues, receipts, receiptScans] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, currency: true, hideAmounts: true, autoLockMinutes: true } }),
    db.customCategory.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.customSubcategory.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.savedPlace.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.paymentAccount.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.accountReconciliation.findMany({ where: { userId }, orderBy: { approvedAt: "asc" } }),
    db.transaction.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    db.accountTransfer.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.budget.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.recurringEntry.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    db.savingsGoal.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, include: { contributions: { orderBy: { createdAt: "asc" } } } }),
    db.dueItem.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, include: { payments: { orderBy: { createdAt: "asc" } } } }),
    db.receiptAttachment.findMany({ where: { userId, OR: [{ dueItemId: { not: null } }, { transaction: { deletedAt: null } }] }, orderBy: { createdAt: "asc" } }),
    db.receiptScan.findMany({ where: { userId, transactions: { some: { deletedAt: null } } }, orderBy: { createdAt: "asc" } }),
  ]);
  const includedTransactionIds = new Set(transactions.map((item) => item.id));

  const records: BackupRecord[] = [
    { entity: "metadata", backupId: "backup", payload: { app: "SaveYoRupee", exportedAt: new Date().toISOString() } },
    { entity: "profile", backupId: "profile", payload: { displayName: user.name, currency: user.currency, hideAmounts: user.hideAmounts, autoLockMinutes: user.autoLockMinutes } },
    ...categories.map((item): BackupRecord => ({ entity: "custom_category", backupId: item.id, payload: { name: item.name, kind: item.kind, color: item.color, icon: item.icon, createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt) } })),
    ...subcategories.map((item): BackupRecord => ({ entity: "custom_subcategory", backupId: item.id, payload: { categoryId: item.categoryId, name: item.name, icon: item.icon, createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt) } })),
    ...savedPlaces.map((item): BackupRecord => ({ entity: "saved_place", backupId: item.id, payload: { name: item.name, icon: item.icon, address: item.address, latitude: item.latitude, longitude: item.longitude, createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt), lastUsedAt: iso(item.lastUsedAt) } })),
    ...accounts.map((item): BackupRecord => ({ entity: "payment_account", backupId: item.id, payload: { importId: item.importId, type: item.type, provider: item.provider, label: item.label, balanceMinor: item.balanceMinor, balanceAsOf: dateOnly(item.balanceAsOf), balanceRecordedAt: iso(item.balanceRecordedAt), createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt) } })),
    ...reconciliations.map((item): BackupRecord => ({ entity: "account_reconciliation", backupId: item.id, payload: { paymentAccountId: item.paymentAccountId, monthKey: item.monthKey, checkedOn: dateOnly(item.checkedOn), startingBalanceMinor: item.startingBalanceMinor, startingBalanceAsOf: dateOnly(item.startingBalanceAsOf), incomeMinor: item.incomeMinor, expenseMinor: item.expenseMinor, transfersInMinor: item.transfersInMinor, transfersOutMinor: item.transfersOutMinor, expectedBalanceMinor: item.expectedBalanceMinor, actualBalanceMinor: item.actualBalanceMinor, adjustmentMinor: item.adjustmentMinor, adjustmentNote: item.adjustmentNote, approvedAt: iso(item.approvedAt), createdAt: iso(item.createdAt) } })),
    ...transactions.map((item): BackupRecord => ({ entity: "transaction", backupId: item.id, payload: { kind: item.kind, category: item.category, amountMinor: item.amountMinor, occurredOn: dateOnly(item.occurredOn), note: item.note, subcategory: item.subcategory, area: item.area, paymentMode: item.paymentMode, paymentAccountId: item.paymentAccountId, locationLabel: item.locationLabel, locationAddress: item.locationAddress, locationLatitude: item.locationLatitude, locationLongitude: item.locationLongitude, locationAccuracy: item.locationAccuracy, locationSource: item.locationSource, savedPlaceId: item.savedPlaceId, receiptScanId: item.receiptScanId, createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt) } })),
    ...transfers.map((item): BackupRecord => ({ entity: "account_transfer", backupId: item.id, payload: { fromAccountId: item.fromAccountId, toAccountId: item.toAccountId, amountMinor: item.amountMinor, occurredOn: dateOnly(item.occurredOn), note: item.note, createdAt: iso(item.createdAt) } })),
    ...budgets.map((item): BackupRecord => ({ entity: "budget", backupId: item.id, payload: { monthKey: item.monthKey, category: item.category, amountMinor: item.amountMinor, createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt) } })),
    ...recurring.map((item): BackupRecord => ({ entity: "recurring_entry", backupId: item.id, payload: { kind: item.kind, category: item.category, amountMinor: item.amountMinor, note: item.note, tags: item.tags, dayOfMonth: item.dayOfMonth, recurrenceUnit: item.recurrenceUnit, recurrenceInterval: item.recurrenceInterval, anchorDate: dateOnly(item.anchorDate), nextDueOn: dateOnly(item.nextDueOn), active: item.active, createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt) } })),
    ...goals.flatMap((goal): BackupRecord[] => [
      { entity: "savings_goal", backupId: goal.id, payload: { name: goal.name, targetMinor: goal.targetMinor, savedMinor: goal.savedMinor, targetDate: dateOnly(goal.targetDate), createdAt: iso(goal.createdAt), updatedAt: iso(goal.updatedAt) } },
      ...goal.contributions.map((item): BackupRecord => ({ entity: "savings_goal_contribution", backupId: item.id, payload: { goalId: item.goalId, amountMinor: item.amountMinor, isOpeningBalance: item.isOpeningBalance, createdAt: iso(item.createdAt) } })),
    ]),
    ...dues.flatMap((due): BackupRecord[] => [
      { entity: "due_item", backupId: due.id, payload: { kind: due.kind, title: due.title, person: due.person, amountMinor: due.amountMinor, category: due.category, occurredOn: dateOnly(due.occurredOn), dueOn: dateOnly(due.dueOn), remindOn: dateOnly(due.remindOn), snoozedUntil: dateOnly(due.snoozedUntil), note: due.note, status: due.status, completedOn: dateOnly(due.completedOn), createdAt: iso(due.createdAt), updatedAt: iso(due.updatedAt) } },
      ...due.payments.map((item): BackupRecord => ({ entity: "due_payment", backupId: item.id, payload: { dueItemId: item.dueItemId, amountMinor: item.amountMinor, occurredOn: dateOnly(item.occurredOn), note: item.note, transactionId: item.transactionId && includedTransactionIds.has(item.transactionId) ? item.transactionId : null, createdAt: iso(item.createdAt) } })),
    ]),
  ];

  for (const receipt of receipts) {
    const contentBase64 = await receiptBase64(receipt);
    records.push({
      entity: "receipt",
      backupId: receipt.id,
      payload: {
        transactionId: receipt.transactionId,
        dueItemId: receipt.dueItemId,
        name: receipt.name,
        mimeType: receipt.mimeType,
        size: receipt.size,
        contentBase64,
        contentSha256: createHash("sha256").update(Buffer.from(contentBase64, "base64")).digest("hex"),
        createdAt: iso(receipt.createdAt),
      },
    });
  }
  for (const receiptScan of receiptScans) {
    const contentBase64 = await receiptBase64(receiptScan);
    records.push({
      entity: "receipt_scan",
      backupId: receiptScan.id,
      payload: {
        name: receiptScan.name,
        mimeType: receiptScan.mimeType,
        size: receiptScan.size,
        contentBase64,
        contentSha256: createHash("sha256").update(Buffer.from(contentBase64, "base64")).digest("hex"),
        createdAt: iso(receiptScan.createdAt),
      },
    });
  }
  return serializeBackupCsv(records);
}

type BackupFileRecord = {
  backupId: string;
  payload: { name: string; mimeType: string; size: number; contentBase64: string; contentSha256: string };
};

async function uploadBackupFiles(userId: string, records: BackupFileRecord[]) {
  if (!records.length) return new Map<string, string>();
  await ensureReceiptsBucket();
  const uploaded = new Map<string, string>();
  try {
    for (const record of records) {
      const path = newReceiptPath(userId, record.payload.mimeType);
      const bytes = Buffer.from(record.payload.contentBase64, "base64");
      if (createHash("sha256").update(bytes).digest("hex") !== record.payload.contentSha256) throw new Error(`Receipt ${record.payload.name} failed its integrity check.`);
      const { error } = await getSupabaseStorageAdmin().storage.from(RECEIPTS_BUCKET).upload(
        path,
        bytes,
        { contentType: record.payload.mimeType, upsert: false },
      );
      if (error) throw new Error(`Could not restore receipt ${record.payload.name}.`);
      uploaded.set(record.backupId, path);
    }
    return uploaded;
  } catch (error) {
    await removeStoredReceipts([...uploaded.values()]).catch(() => undefined);
    throw error;
  }
}

async function restoreBackup(userId: string, csv: string) {
  const parsed = parseBackupCsv(csv);
  const profile = recordsOf(parsed.records, "profile")[0].payload;
  const categories = recordsOf(parsed.records, "custom_category");
  const subcategories = recordsOf(parsed.records, "custom_subcategory");
  const places = recordsOf(parsed.records, "saved_place");
  const accounts = recordsOf(parsed.records, "payment_account");
  const reconciliations = recordsOf(parsed.records, "account_reconciliation");
  const transactions = recordsOf(parsed.records, "transaction");
  const transfers = recordsOf(parsed.records, "account_transfer");
  const budgets = recordsOf(parsed.records, "budget");
  const recurring = recordsOf(parsed.records, "recurring_entry");
  const goals = recordsOf(parsed.records, "savings_goal");
  const contributions = recordsOf(parsed.records, "savings_goal_contribution");
  const dues = recordsOf(parsed.records, "due_item");
  const duePayments = recordsOf(parsed.records, "due_payment");
  const receipts = recordsOf(parsed.records, "receipt");
  const receiptScans = recordsOf(parsed.records, "receipt_scan");
  const db = getPrisma();
  const [oldReceipts, oldReceiptScans] = await Promise.all([
    db.receiptAttachment.findMany({ where: { userId }, select: { storagePath: true } }),
    db.receiptScan.findMany({ where: { userId }, select: { storagePath: true } }),
  ]);
  const oldReceiptPaths = [...oldReceipts.map((item) => item.storagePath), ...oldReceiptScans.map((item) => item.storagePath)];
  const uploadedReceipts = await uploadBackupFiles(userId, receipts);
  let uploadedReceiptScans: Map<string, string>;
  try {
    uploadedReceiptScans = await uploadBackupFiles(userId, receiptScans);
  } catch (error) {
    await removeStoredReceipts([...uploadedReceipts.values()]).catch(() => undefined);
    throw error;
  }

  const categoryIds = new Map(categories.map((record) => [record.backupId, crypto.randomUUID()]));
  const subcategoryIds = new Map(subcategories.map((record) => [record.backupId, crypto.randomUUID()]));
  const placeIds = new Map(places.map((record) => [record.backupId, crypto.randomUUID()]));
  const accountIds = new Map(accounts.map((record) => [record.backupId, crypto.randomUUID()]));
  const reconciliationIds = new Map(reconciliations.map((record) => [record.backupId, crypto.randomUUID()]));
  const transactionIds = new Map(transactions.map((record) => [record.backupId, crypto.randomUUID()]));
  const receiptScanIds = new Map(receiptScans.map((record) => [record.backupId, crypto.randomUUID()]));
  const transferIds = new Map(transfers.map((record) => [record.backupId, crypto.randomUUID()]));
  const budgetIds = new Map(budgets.map((record) => [record.backupId, crypto.randomUUID()]));
  const recurringIds = new Map(recurring.map((record) => [record.backupId, crypto.randomUUID()]));
  const goalIds = new Map(goals.map((record) => [record.backupId, crypto.randomUUID()]));
  const contributionIds = new Map(contributions.map((record) => [record.backupId, crypto.randomUUID()]));
  const dueIds = new Map(dues.map((record) => [record.backupId, crypto.randomUUID()]));
  const duePaymentIds = new Map(duePayments.map((record) => [record.backupId, crypto.randomUUID()]));
  const categoryId = (value: string) => categoryIds.get(value) ?? value;

  try {
    await db.$transaction(async (transaction) => {
      await transaction.receiptAttachment.deleteMany({ where: { userId } });
      await transaction.duePayment.deleteMany({ where: { userId } });
      await transaction.dueItem.deleteMany({ where: { userId } });
      await transaction.savingsGoalContribution.deleteMany({ where: { userId } });
      await transaction.savingsGoal.deleteMany({ where: { userId } });
      await transaction.accountReconciliation.deleteMany({ where: { userId } });
      await transaction.accountTransfer.deleteMany({ where: { userId } });
      await transaction.transaction.deleteMany({ where: { userId } });
      await transaction.receiptScan.deleteMany({ where: { userId } });
      await transaction.budget.deleteMany({ where: { userId } });
      await transaction.recurringEntry.deleteMany({ where: { userId } });
      await transaction.paymentAccount.deleteMany({ where: { userId } });
      await transaction.savedPlace.deleteMany({ where: { userId } });
      await transaction.customSubcategory.deleteMany({ where: { userId } });
      await transaction.customCategory.deleteMany({ where: { userId } });
      await transaction.user.update({ where: { id: userId }, data: { name: profile.displayName, currency: profile.currency, hideAmounts: profile.hideAmounts, autoLockMinutes: profile.autoLockMinutes } });

      if (categories.length) await transaction.customCategory.createMany({ data: categories.map(({ backupId, payload }) => ({ id: categoryIds.get(backupId)!, userId, name: payload.name, kind: payload.kind, color: payload.color, icon: payload.icon, createdAt: asDateTime(payload.createdAt), updatedAt: asDateTime(payload.updatedAt) })) });
      if (subcategories.length) await transaction.customSubcategory.createMany({ data: subcategories.map(({ backupId, payload }) => ({ id: subcategoryIds.get(backupId)!, userId, categoryId: categoryId(payload.categoryId), name: payload.name, icon: payload.icon, createdAt: asDateTime(payload.createdAt), updatedAt: asDateTime(payload.updatedAt) })) });
      if (places.length) await transaction.savedPlace.createMany({ data: places.map(({ backupId, payload }) => ({ id: placeIds.get(backupId)!, userId, name: payload.name, icon: payload.icon, address: payload.address, latitude: payload.latitude, longitude: payload.longitude, createdAt: asDateTime(payload.createdAt), updatedAt: asDateTime(payload.updatedAt), lastUsedAt: asDateTime(payload.lastUsedAt) })) });
      if (accounts.length) await transaction.paymentAccount.createMany({ data: accounts.map(({ backupId, payload }) => ({ id: accountIds.get(backupId)!, importId: payload.importId ?? crypto.randomUUID(), userId, type: payload.type, provider: payload.provider, label: payload.label, balanceMinor: payload.balanceMinor, balanceAsOf: asDate(payload.balanceAsOf), balanceRecordedAt: asDateTime(payload.balanceRecordedAt), createdAt: asDateTime(payload.createdAt), updatedAt: asDateTime(payload.updatedAt) })) });
      if (reconciliations.length) await transaction.accountReconciliation.createMany({ data: reconciliations.map(({ backupId, payload }) => ({ id: reconciliationIds.get(backupId)!, userId, paymentAccountId: accountIds.get(payload.paymentAccountId)!, monthKey: payload.monthKey, checkedOn: asDate(payload.checkedOn), startingBalanceMinor: payload.startingBalanceMinor, startingBalanceAsOf: asDate(payload.startingBalanceAsOf), incomeMinor: payload.incomeMinor, expenseMinor: payload.expenseMinor, transfersInMinor: payload.transfersInMinor, transfersOutMinor: payload.transfersOutMinor, expectedBalanceMinor: payload.expectedBalanceMinor, actualBalanceMinor: payload.actualBalanceMinor, adjustmentMinor: payload.adjustmentMinor, adjustmentNote: payload.adjustmentNote, approvedAt: asDateTime(payload.approvedAt), createdAt: asDateTime(payload.createdAt) })) });
      if (receiptScans.length) await transaction.receiptScan.createMany({ data: receiptScans.map(({ backupId, payload }) => ({ id: receiptScanIds.get(backupId)!, userId, name: payload.name, mimeType: payload.mimeType, size: payload.size, storagePath: uploadedReceiptScans.get(backupId)!, createdAt: asDateTime(payload.createdAt) })) });
      if (transactions.length) await transaction.transaction.createMany({ data: transactions.map(({ backupId, payload }) => ({ id: transactionIds.get(backupId)!, userId, kind: payload.kind, category: categoryId(payload.category), amountMinor: payload.amountMinor, occurredOn: asDate(payload.occurredOn), note: payload.note, subcategory: payload.subcategory, area: payload.area, paymentMode: payload.paymentMode, paymentAccountId: payload.paymentAccountId ? accountIds.get(payload.paymentAccountId)! : null, locationLabel: payload.locationLabel, locationAddress: payload.locationAddress, locationLatitude: payload.locationLatitude, locationLongitude: payload.locationLongitude, locationAccuracy: payload.locationAccuracy, locationSource: payload.locationSource, savedPlaceId: payload.savedPlaceId ? placeIds.get(payload.savedPlaceId)! : null, receiptScanId: payload.receiptScanId ? receiptScanIds.get(payload.receiptScanId)! : null, createdAt: asDateTime(payload.createdAt), updatedAt: asDateTime(payload.updatedAt) })) });
      if (transfers.length) await transaction.accountTransfer.createMany({ data: transfers.map(({ backupId, payload }) => ({ id: transferIds.get(backupId)!, userId, fromAccountId: accountIds.get(payload.fromAccountId)!, toAccountId: accountIds.get(payload.toAccountId)!, amountMinor: payload.amountMinor, occurredOn: asDate(payload.occurredOn), note: payload.note, createdAt: asDateTime(payload.createdAt) })) });
      if (budgets.length) await transaction.budget.createMany({ data: budgets.map(({ backupId, payload }) => ({ id: budgetIds.get(backupId)!, userId, monthKey: payload.monthKey, category: categoryId(payload.category), amountMinor: payload.amountMinor, createdAt: asDateTime(payload.createdAt), updatedAt: asDateTime(payload.updatedAt) })) });
      if (recurring.length) await transaction.recurringEntry.createMany({ data: recurring.map(({ backupId, payload }) => ({
        id: recurringIds.get(backupId)!,
        userId,
        kind: payload.kind,
        category: categoryId(payload.category),
        amountMinor: payload.amountMinor,
        note: payload.note,
        tags: payload.tags,
        dayOfMonth: (payload.recurrenceUnit ?? "month") === "week" ? null : payload.dayOfMonth ?? Number((payload.anchorDate ?? payload.nextDueOn).slice(8, 10)),
        recurrenceUnit: payload.recurrenceUnit ?? "month",
        recurrenceInterval: payload.recurrenceInterval ?? 1,
        anchorDate: asDate(payload.anchorDate ?? payload.nextDueOn),
        nextDueOn: asDate(payload.nextDueOn),
        active: payload.active,
        createdAt: asDateTime(payload.createdAt),
        updatedAt: asDateTime(payload.updatedAt),
      })) });
      if (goals.length) await transaction.savingsGoal.createMany({ data: goals.map(({ backupId, payload }) => ({ id: goalIds.get(backupId)!, userId, name: payload.name, targetMinor: payload.targetMinor, savedMinor: payload.savedMinor, targetDate: payload.targetDate ? asDate(payload.targetDate) : null, createdAt: asDateTime(payload.createdAt), updatedAt: asDateTime(payload.updatedAt) })) });
      if (contributions.length) await transaction.savingsGoalContribution.createMany({ data: contributions.map(({ backupId, payload }) => ({ id: contributionIds.get(backupId)!, userId, goalId: goalIds.get(payload.goalId)!, amountMinor: payload.amountMinor, isOpeningBalance: payload.isOpeningBalance, createdAt: asDateTime(payload.createdAt) })) });
      if (dues.length) await transaction.dueItem.createMany({ data: dues.map(({ backupId, payload }) => ({ id: dueIds.get(backupId)!, userId, kind: payload.kind, title: payload.title, person: payload.person, amountMinor: payload.amountMinor, category: categoryId(payload.category), occurredOn: payload.occurredOn ? asDate(payload.occurredOn) : null, dueOn: asDate(payload.dueOn), remindOn: payload.remindOn ? asDate(payload.remindOn) : null, snoozedUntil: payload.snoozedUntil ? asDate(payload.snoozedUntil) : null, note: payload.note, status: payload.status, completedOn: payload.completedOn ? asDate(payload.completedOn) : null, createdAt: asDateTime(payload.createdAt), updatedAt: asDateTime(payload.updatedAt) })) });
      if (duePayments.length) await transaction.duePayment.createMany({ data: duePayments.map(({ backupId, payload }) => ({ id: duePaymentIds.get(backupId)!, userId, dueItemId: dueIds.get(payload.dueItemId)!, amountMinor: payload.amountMinor, occurredOn: asDate(payload.occurredOn), note: payload.note, transactionId: payload.transactionId ? transactionIds.get(payload.transactionId)! : null, createdAt: asDateTime(payload.createdAt) })) });
      if (receipts.length) await transaction.receiptAttachment.createMany({ data: receipts.map(({ backupId, payload }) => ({ id: crypto.randomUUID(), userId, transactionId: payload.transactionId ? transactionIds.get(payload.transactionId)! : null, dueItemId: payload.dueItemId ? dueIds.get(payload.dueItemId)! : null, name: payload.name, mimeType: payload.mimeType, size: payload.size, storagePath: uploadedReceipts.get(backupId)!, data: null, createdAt: asDateTime(payload.createdAt) })) });
    }, { timeout: 30_000 });
  } catch (error) {
    await removeStoredReceipts([...uploadedReceipts.values(), ...uploadedReceiptScans.values()]).catch(() => undefined);
    throw error;
  }

  await removeStoredReceipts(oldReceiptPaths).catch((error) => console.warn("Restored backup but could not remove replaced receipt files.", error));
  return parsed;
}

export async function GET() {
  const session = await getBetaSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const backup = await buildBackup(session.user.id);
    if (Buffer.byteLength(backup, "utf8") > BACKUP_MAX_BYTES) throw new Error("This backup is larger than 75 MB. Remove some receipt files and try again.");
    const day = new Date().toISOString().slice(0, 10);
    return new NextResponse(backup, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="save-yo-rupee-full-backup-${day}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create the backup." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const requestHeaders = await headers();
  const session = await getBetaSession(requestHeaders);
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > BACKUP_MAX_BYTES + 1024 * 1024) return NextResponse.json({ error: "Keep backup files under 75 MB." }, { status: 413 });
  try {
    const form = await request.formData();
    const password = z.string().min(1).max(128).parse(form.get("password"));
    const backup = form.get("backup");
    if (!(backup instanceof File)) return NextResponse.json({ error: "Choose a backup CSV to restore." }, { status: 400 });
    if (backup.size > BACKUP_MAX_BYTES) return NextResponse.json({ error: "Keep backup files under 75 MB." }, { status: 413 });
    try {
      await auth.api.verifyPassword({ body: { password }, headers: requestHeaders });
    } catch {
      return NextResponse.json({ error: "Password did not match." }, { status: 401 });
    }
    const csv = await backup.text();
    const restored = await restoreBackup(session.user.id, csv);
    return NextResponse.json({ restoredAt: new Date().toISOString(), exportedAt: restored.metadata.exportedAt, counts: restored.counts });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Could not restore this backup.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
