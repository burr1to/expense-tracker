import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getBetaSession } from "../../../lib/auth";
import { getPrisma } from "../../../lib/prisma";
import { hashPin, verifyPin } from "../../../lib/pin";
import { NEPAL_MOBILE_BANKS } from "../../../lib/payment-accounts";
import { removeStoredReceipts, verifyStoredReceipt } from "../../../lib/receipt-storage";
import { KATHMANDU_BOUNDS } from "../../../lib/kathmandu-locations";
import { expectedAccountBalanceThrough, withCurrentAccountBalance } from "../../../lib/account-balances";
import { CATEGORIES, importedCategoryColor, SUBCATEGORIES } from "../../../lib/categories";
import { CATEGORY_ICON_NAMES } from "../../../lib/category-icons";
import { dateOnlyInTimeZone, firstRecurringOccurrence, nextRecurringOccurrence } from "../../../lib/recurrence";
import type { AccountReconciliation, AccountTransfer, CategoryIconName, LedgerTransaction, PaymentAccount, RecurrenceUnit } from "../../../types";

export const dynamic = "force-dynamic";

const locationSchema = z.object({
  label: z.string().trim().min(1).max(120),
  address: z.string().trim().max(240),
  latitude: z.number().min(KATHMANDU_BOUNDS.south).max(KATHMANDU_BOUNDS.north),
  longitude: z.number().min(KATHMANDU_BOUNDS.west).max(KATHMANDU_BOUNDS.east),
  accuracy: z.number().int().positive().max(100_000).nullable(),
  source: z.enum(["pin", "search", "current_location", "saved"]),
  savedPlaceId: z.string().nullable(),
}).nullable();
const savedPlaceSchema = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.enum(["pin", "home", "work", "food", "shopping", "health", "favorite"]),
  address: z.string().trim().max(240),
  latitude: z.number().min(KATHMANDU_BOUNDS.south).max(KATHMANDU_BOUNDS.north),
  longitude: z.number().min(KATHMANDU_BOUNDS.west).max(KATHMANDU_BOUNDS.east),
});
const transactionSchema = z.object({
  kind: z.enum(["income", "expense"]), category: z.string().min(1).max(80), amountMinor: z.number().int().positive(),
  occurredOn: z.string().date(), note: z.string().max(240), subcategory: z.string().trim().max(80).nullable(),
  area: z.string().trim().max(120).nullable(), paymentMode: z.enum(["cash", "cheque", "online"]), paymentAccountId: z.string().nullable(),
  location: locationSchema.optional(),
}).superRefine((value, context) => {
  if (value.paymentMode === "online" && !value.paymentAccountId) context.addIssue({ code: "custom", path: ["paymentAccountId"], message: "Choose an online payment account." });
  if (value.paymentMode !== "online" && value.paymentAccountId) context.addIssue({ code: "custom", path: ["paymentAccountId"], message: "Payment accounts can only be used with online payments." });
});
const receiptSchema = z.object({ name: z.string().trim().min(1).max(120), mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]), size: z.number().int().positive().max(3 * 1024 * 1024), storagePath: z.string().min(1).max(300) });
const savedTransactionSchema = transactionSchema.extend({ receipt: receiptSchema.optional(), removeReceipt: z.boolean().optional() });
const receiptSplitTransactionSchema = transactionSchema.refine((transaction) => transaction.kind === "expense", { message: "Receipt scans can only create expenses.", path: ["kind"] });
const receiptSplitSchema = z.object({
  receipt: receiptSchema.extend({ mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]) }),
  totalMinor: z.number().int().positive(),
  transactions: z.array(receiptSplitTransactionSchema).min(1).max(20),
});
const budgetSchema = z.object({ monthKey: z.string().regex(/^\d{4}-\d{2}$/), category: z.string().min(1).max(80), amountMinor: z.number().int().positive() });
const recurringSchema = z.object({
  kind: z.enum(["income", "expense"]),
  category: z.string().min(1).max(80),
  amountMinor: z.number().int().positive(),
  note: z.string().max(240),
  tags: z.array(z.string().max(40)).max(8),
  recurrenceUnit: z.enum(["day", "week", "month", "year"]),
  recurrenceInterval: z.number().int().min(1).max(365),
  startOn: z.string().date(),
}).superRefine((value, context) => {
  const maximum = value.recurrenceUnit === "day" ? 365 : value.recurrenceUnit === "week" ? 52 : value.recurrenceUnit === "month" ? 12 : 5;
  if (value.recurrenceInterval > maximum) context.addIssue({ code: "custom", path: ["recurrenceInterval"], message: `This schedule cannot repeat more than every ${maximum} ${value.recurrenceUnit}s.` });
});
const goalSchema = z.object({ name: z.string().trim().min(1).max(80), targetMinor: z.number().int().positive(), savedMinor: z.number().int().min(0), targetDate: z.string().date().nullable() });
const categoryIconSchema = z.enum(CATEGORY_ICON_NAMES);
const categorySchema = z.object({ name: z.string().trim().min(1).max(30), kind: z.enum(["income", "expense", "both"]), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), icon: categoryIconSchema.default("tag") });
const subcategorySchema = z.object({ categoryId: z.string().min(1).max(80), name: z.string().trim().min(1).max(80), icon: categoryIconSchema });
const importedCategorySchema = z.object({ key: z.string().startsWith("csv:").max(80), name: z.string().trim().min(1).max(30), kind: z.enum(["income", "expense", "both"]), icon: categoryIconSchema.default("tag") });
const importedSubcategorySchema = z.object({ key: z.string().startsWith("csvsub:").max(250), category: z.string().min(1).max(80), name: z.string().trim().min(1).max(80), icon: categoryIconSchema.default("tag") });
const transactionImportPayloadSchema = z.object({
  transactions: z.array(transactionSchema).max(1000),
  newCategories: z.array(importedCategorySchema).max(100),
  newSubcategories: z.array(importedSubcategorySchema).max(250).default([]),
}).superRefine((value, context) => {
  const keys = new Set<string>();
  for (const [index, category] of value.newCategories.entries()) {
    if (keys.has(category.key)) context.addIssue({ code: "custom", path: ["newCategories", index, "key"], message: "Imported category keys must be unique." });
    keys.add(category.key);
  }
  const subcategoryKeys = new Set<string>();
  for (const [index, subcategory] of value.newSubcategories.entries()) {
    if (subcategoryKeys.has(subcategory.key)) context.addIssue({ code: "custom", path: ["newSubcategories", index, "key"], message: "Imported subcategory keys must be unique." });
    subcategoryKeys.add(subcategory.key);
  }
});
const transactionImportSchema = z.union([
  z.array(transactionSchema).max(1000).transform((transactions) => ({ transactions, newCategories: [], newSubcategories: [] })),
  transactionImportPayloadSchema,
]);
const paymentAccountSchema = z.object({ type: z.enum(["mobile_banking", "esewa", "khalti", "connect_ips"]), provider: z.string().trim().min(1).max(100), label: z.string().trim().max(60), balanceMinor: z.number().int(), balanceAsOf: z.string().date() });
const accountBalanceSchema = z.object({ balanceMinor: z.number().int(), balanceAsOf: z.string().date() });
const accountReconciliationSchema = z.object({
  paymentAccountId: z.string().min(1),
  monthKey: z.string().regex(/^\d{4}-\d{2}$/),
  checkedOn: z.string().date(),
  actualBalanceMinor: z.number().int(),
  adjustmentNote: z.string().trim().max(300),
});
const resetReconciliationSchema = z.object({ confirmation: z.literal("RESET") });
const transferSchema = z.object({ fromAccountId: z.string().min(1), toAccountId: z.string().min(1), amountMinor: z.number().int().positive(), occurredOn: z.string().date(), note: z.string().trim().max(240) }).superRefine((value, context) => {
  if (value.fromAccountId === value.toAccountId) context.addIssue({ code: "custom", path: ["toAccountId"], message: "Choose two different accounts." });
});
const profileSchema = z.object({ displayName: z.string().trim().min(1).max(50), currency: z.enum(["NPR", "USD", "AUD"]), hideAmounts: z.boolean(), autoLockMinutes: z.number().int().min(0).max(120) });
const dueSchema = z.object({ kind: z.enum(["payment", "receivable", "lent", "borrowed"]), title: z.string().trim().min(1).max(100), person: z.string().trim().max(80), amountMinor: z.number().int().positive(), category: z.string().min(1).max(80), occurredOn: z.string().date().nullable(), dueOn: z.string().date(), remindOn: z.string().date().nullable(), note: z.string().trim().max(300), receipt: receiptSchema.optional() });
const duePaymentSchema = z.object({ amountMinor: z.number().int().positive(), occurredOn: z.string().date(), note: z.string().trim().max(240), addToLedger: z.boolean() });
const pinSchema = z.string().regex(/^\d{4,6}$/, "PIN must contain 4 to 6 digits.");
const requestSchema = z.object({ action: z.string(), id: z.string().optional(), payload: z.unknown().optional() });

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateOnly = (value: Date | null) => value ? value.toISOString().slice(0, 10) : null;
const TRANSACTION_UNDO_WINDOW_MS = 30_000;
const DELETED_TRANSACTION_RETENTION_MS = 24 * 60 * 60 * 1000;
const receiptData = async (receipt: z.infer<typeof receiptSchema>, id: string) => {
  await verifyStoredReceipt(receipt.storagePath, id, receipt.mimeType, receipt.size);
  return { name: receipt.name, mimeType: receipt.mimeType, size: receipt.size, storagePath: receipt.storagePath, data: null };
};
const receiptSelect = { id: true, name: true, mimeType: true, size: true } as const;

async function userId() {
  const session = await getBetaSession(await headers());
  return session?.user.id ?? null;
}

function serialize(data: Awaited<ReturnType<typeof loadLedger>>) {
  const transactions: LedgerTransaction[] = data.transactions.map((item) => {
    const { deletedAt, receiptScan, ...transaction } = item;
    void deletedAt;
    return { ...transaction, receipt: transaction.receipt ?? receiptScan, kind: item.kind as LedgerTransaction["kind"], paymentMode: item.paymentMode as LedgerTransaction["paymentMode"], locationSource: item.locationSource as LedgerTransaction["locationSource"], occurredOn: dateOnly(item.occurredOn)!, createdAt: item.createdAt.toISOString(), paymentAccount: null };
  });
  const transfers: AccountTransfer[] = data.transfers.map((item) => ({ ...item, occurredOn: dateOnly(item.occurredOn)!, createdAt: item.createdAt.toISOString() }));
  const paymentAccounts: PaymentAccount[] = data.paymentAccounts.map((item) => serializeAccount(item, transactions, transfers));
  const accountById = new Map(paymentAccounts.map((item) => [item.id, item]));
  for (const transaction of transactions) if (transaction.paymentAccountId) transaction.paymentAccount = accountById.get(transaction.paymentAccountId) ?? null;
  return {
    profile: { id: data.user.id, displayName: data.user.name, currency: data.user.currency, hideAmounts: data.user.hideAmounts, autoLockMinutes: data.user.autoLockMinutes, hasPin: Boolean(data.user.pinHash) },
    transactions,
    budgets: data.budgets,
    recurringEntries: data.recurring.map((item) => ({
      ...item,
      recurrenceUnit: item.recurrenceUnit as RecurrenceUnit,
      anchorDate: dateOnly(item.anchorDate),
      nextDueOn: dateOnly(item.nextDueOn),
    })),
    goals: data.goals.map((item) => ({
      ...item,
      targetDate: dateOnly(item.targetDate),
      contributions: item.contributions.map((contribution) => ({ ...contribution, createdAt: contribution.createdAt.toISOString() })),
    })),
    customCategories: data.categories.map((item) => ({ ...item, label: item.name, custom: true })),
    customSubcategories: data.subcategories.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    paymentAccounts,
    reconciliations: data.reconciliations.map((item): AccountReconciliation => ({
      ...item,
      checkedOn: dateOnly(item.checkedOn)!,
      startingBalanceAsOf: dateOnly(item.startingBalanceAsOf)!,
      approvedAt: item.approvedAt.toISOString(),
      createdAt: item.createdAt.toISOString(),
    })),
    savedPlaces: data.savedPlaces.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), lastUsedAt: item.lastUsedAt.toISOString() })),
    transfers,
    dueItems: data.dueItems.map((item) => ({ ...item, occurredOn: dateOnly(item.occurredOn), dueOn: dateOnly(item.dueOn), remindOn: dateOnly(item.remindOn), snoozedUntil: dateOnly(item.snoozedUntil), completedOn: dateOnly(item.completedOn), createdAt: item.createdAt.toISOString(), payments: item.payments.map((payment) => ({ ...payment, occurredOn: dateOnly(payment.occurredOn), createdAt: payment.createdAt.toISOString() })) })),
  };
}

function serializeAccount(item: Awaited<ReturnType<typeof loadLedger>>["paymentAccounts"][number], transactions: readonly LedgerTransaction[], transfers: readonly AccountTransfer[]): PaymentAccount {
  const account: PaymentAccount = { id: item.id, importId: item.importId, userId: item.userId, type: item.type as PaymentAccount["type"], provider: item.provider, label: item.label, balanceMinor: item.balanceMinor, balanceAsOf: dateOnly(item.balanceAsOf)!, balanceRecordedAt: item.balanceRecordedAt.toISOString(), currentBalanceMinor: 0, createdAt: item.createdAt.toISOString() };
  return withCurrentAccountBalance(account, transactions, transfers);
}

async function loadLedger(id: string) {
  const db = getPrisma();
  const [user, transactions, budgets, recurring, goals, categories, subcategories, paymentAccounts, reconciliations, savedPlaces, transfers, dueItems] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, currency: true, hideAmounts: true, autoLockMinutes: true, pinHash: true } }),
    db.transaction.findMany({ where: { userId: id, deletedAt: null }, orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }], include: { receipt: { select: receiptSelect }, receiptScan: { select: receiptSelect }, paymentAccount: true } }),
    db.budget.findMany({ where: { userId: id }, orderBy: { monthKey: "desc" } }),
    db.recurringEntry.findMany({ where: { userId: id }, orderBy: { nextDueOn: "asc" } }),
    db.savingsGoal.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" }, include: { contributions: { orderBy: { createdAt: "desc" } } } }),
    db.customCategory.findMany({ where: { userId: id }, orderBy: { name: "asc" } }),
    db.customSubcategory.findMany({ where: { userId: id }, orderBy: [{ categoryId: "asc" }, { name: "asc" }] }),
    db.paymentAccount.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" } }),
    db.accountReconciliation.findMany({ where: { userId: id }, orderBy: [{ checkedOn: "desc" }, { approvedAt: "desc" }] }),
    db.savedPlace.findMany({ where: { userId: id }, orderBy: { lastUsedAt: "desc" } }),
    db.accountTransfer.findMany({ where: { userId: id }, orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }] }),
    db.dueItem.findMany({ where: { userId: id }, orderBy: [{ status: "asc" }, { dueOn: "asc" }], include: { payments: { orderBy: { occurredOn: "desc" } }, receipt: { select: receiptSelect } } }),
  ]);
  return { user, transactions, budgets, recurring, goals, categories, subcategories, paymentAccounts, reconciliations, savedPlaces, transfers, dueItems };
}

async function purgeExpiredDeletedTransactions(id: string) {
  const db = getPrisma();
  const expired = await db.transaction.findMany({
    where: { userId: id, deletedAt: { lt: new Date(Date.now() - DELETED_TRANSACTION_RETENTION_MS) } },
    select: { id: true, receiptScanId: true, receipt: { select: { storagePath: true } } },
  });
  if (!expired.length) return;

  await db.transaction.deleteMany({ where: { userId: id, id: { in: expired.map((item) => item.id) } } });
  const paths = expired.flatMap((item) => item.receipt?.storagePath ? [item.receipt.storagePath] : []);
  for (const receiptScanId of new Set(expired.flatMap((item) => item.receiptScanId ? [item.receiptScanId] : []))) {
    if (await db.transaction.count({ where: { receiptScanId } })) continue;
    const scan = await db.receiptScan.findFirst({ where: { id: receiptScanId, userId: id }, select: { storagePath: true } });
    await db.receiptScan.deleteMany({ where: { id: receiptScanId, userId: id } });
    if (scan?.storagePath) paths.push(scan.storagePath);
  }
  await removeStoredReceipts(paths);
}

export async function GET() {
  const id = await userId();
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await purgeExpiredDeletedTransactions(id).catch((error) => console.warn("Could not purge expired deleted transactions.", error));
  return NextResponse.json(serialize(await loadLedger(id)));
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const id = await userId();
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = requestSchema.parse(await request.json());
    const db = getPrisma();
    const recordId = input.id;
    const assertAccountDatesAreOpen = async (entries: readonly { paymentAccountId: string | null; occurredOn: string; createdAt?: string }[]) => {
      const now = new Date();
      const unique = [...new Map(entries.filter((entry) => entry.paymentAccountId).map((entry) => [`${entry.paymentAccountId}:${entry.occurredOn}:${entry.createdAt ?? "new"}`, entry])).values()];
      const locked = await Promise.all(unique.map((entry) => db.accountReconciliation.findFirst({
        where: {
          userId: id,
          paymentAccountId: entry.paymentAccountId!,
          OR: [
            { checkedOn: { gt: asDate(entry.occurredOn) } },
            { checkedOn: asDate(entry.occurredOn), approvedAt: { gte: entry.createdAt ? new Date(entry.createdAt) : now } },
          ],
        },
        orderBy: { checkedOn: "desc" },
        select: { checkedOn: true },
      })));
      const firstLocked = locked.find(Boolean);
      if (firstLocked) throw new Error(`This activity belongs to an approved reconciliation through ${dateOnly(firstLocked!.checkedOn)}. Add a current transaction or reconcile a later period instead of changing audited history.`);
    };
    switch (input.action) {
      case "saveTransaction": {
        const value = savedTransactionSchema.parse(input.payload);
        const { receipt, removeReceipt, location, ...entry } = value;
        await assertAccountDatesAreOpen([{ paymentAccountId: entry.paymentAccountId, occurredOn: entry.occurredOn }]);
        if (recordId) {
          const existing = await db.transaction.findFirstOrThrow({ where: { id: recordId, userId: id, deletedAt: null }, select: { paymentAccountId: true, occurredOn: true, createdAt: true } });
          await assertAccountDatesAreOpen([{ paymentAccountId: existing.paymentAccountId, occurredOn: dateOnly(existing.occurredOn)!, createdAt: existing.createdAt.toISOString() }]);
        }
        if (entry.paymentAccountId) await db.paymentAccount.findFirstOrThrow({ where: { id: entry.paymentAccountId, userId: id } });
        const savedPlaceId = location?.savedPlaceId ?? null;
        if (savedPlaceId) {
          const savedPlace = await db.savedPlace.findFirstOrThrow({ where: { id: savedPlaceId, userId: id } });
          await db.savedPlace.update({ where: { id: savedPlace.id }, data: { lastUsedAt: new Date() } });
        }
        const data = {
          ...entry,
          occurredOn: asDate(entry.occurredOn),
          locationLabel: location?.label ?? null,
          locationAddress: location?.address ?? null,
          locationLatitude: location?.latitude ?? null,
          locationLongitude: location?.longitude ?? null,
          locationAccuracy: location?.accuracy ?? null,
          locationSource: location?.source ?? null,
          savedPlaceId,
        };
        const storedReceipt = receipt ? await receiptData(receipt, id) : null;
        const pathsToRemove = await db.$transaction(async (transaction) => {
          let transactionId = recordId;
          let detachedScanPath: string | null = null;
          if (recordId) {
            const existing = await transaction.transaction.findFirstOrThrow({ where: { id: recordId, userId: id, deletedAt: null }, select: { id: true, receiptScanId: true } });
            await transaction.transaction.update({ where: { id: existing.id }, data: { ...data, ...((removeReceipt || receipt) && existing.receiptScanId ? { receiptScanId: null } : {}) } });
            if ((removeReceipt || receipt) && existing.receiptScanId) {
              const remaining = await transaction.transaction.count({ where: { receiptScanId: existing.receiptScanId } });
              if (!remaining) {
                const scan = await transaction.receiptScan.findFirst({ where: { id: existing.receiptScanId, userId: id }, select: { storagePath: true } });
                await transaction.receiptScan.deleteMany({ where: { id: existing.receiptScanId, userId: id } });
                detachedScanPath = scan?.storagePath ?? null;
              }
            }
          } else transactionId = (await transaction.transaction.create({ data: { ...data, userId: id } })).id;
          if (!transactionId) throw new Error("Could not identify the saved transaction.");
          const oldReceipt = removeReceipt || receipt ? await transaction.receiptAttachment.findFirst({ where: { transactionId, userId: id }, select: { storagePath: true } }) : null;
          if (removeReceipt && !receipt) await transaction.receiptAttachment.deleteMany({ where: { transactionId, userId: id } });
          if (storedReceipt) await transaction.receiptAttachment.upsert({ where: { transactionId }, update: storedReceipt, create: { ...storedReceipt, userId: id, transactionId } });
          return [oldReceipt?.storagePath && oldReceipt.storagePath !== receipt?.storagePath ? oldReceipt.storagePath : null, detachedScanPath];
        });
        await removeStoredReceipts(pathsToRemove);
        break;
      }
      case "importTransactions": {
        const { transactions: values, newCategories, newSubcategories } = transactionImportSchema.parse(input.payload);
        await assertAccountDatesAreOpen(values.map((value) => ({ paymentAccountId: value.paymentAccountId, occurredOn: value.occurredOn })));
        const accountIds = [...new Set(values.flatMap((value) => value.paymentAccountId ? [value.paymentAccountId] : []))];
        if (accountIds.length) {
          const ownedAccounts = await db.paymentAccount.count({ where: { userId: id, id: { in: accountIds } } });
          if (ownedAccounts !== accountIds.length) throw new Error("One or more online payment accounts are invalid.");
        }
        const existingCategories = await db.customCategory.findMany({ where: { userId: id }, select: { id: true } });
        const allowedCategoryIds = new Set([...CATEGORIES.map((category) => category.id), ...existingCategories.map((category) => category.id)]);
        for (const category of newCategories) {
          if (CATEGORIES.some((existing) => existing.id.toLowerCase() === category.name.toLowerCase() || existing.label.toLowerCase() === category.name.toLowerCase())) throw new Error(`${category.name} is already a built-in category.`);
        }
        await db.$transaction(async (transaction) => {
          const importedCategoryIds = new Map<string, string>();
          if (newCategories.length) {
            await transaction.customCategory.createMany({
              data: newCategories.map((category) => ({ userId: id, name: category.name, kind: category.kind, color: importedCategoryColor(category.name), icon: category.icon })),
              skipDuplicates: true,
            });
            const savedCategories = await transaction.customCategory.findMany({ where: { userId: id, name: { in: newCategories.map((category) => category.name) } }, select: { id: true, name: true } });
            const savedIdsByName = new Map(savedCategories.map((category) => [category.name, category.id]));
            for (const category of newCategories) {
              const categoryId = savedIdsByName.get(category.name);
              if (!categoryId) throw new Error(`Could not create ${category.name}.`);
              importedCategoryIds.set(category.key, categoryId);
            }
          }
          const importedIds = new Set(importedCategoryIds.values());
          const subcategoriesToSave = new Map<string, { userId: string; categoryId: string; name: string; icon: CategoryIconName }>();
          for (const subcategory of newSubcategories) {
            const categoryId = importedCategoryIds.get(subcategory.category) ?? subcategory.category;
            if (!allowedCategoryIds.has(categoryId) && !importedIds.has(categoryId)) throw new Error(`${subcategory.name} references an invalid category.`);
            if (SUBCATEGORIES[categoryId]?.options.some((name) => name.toLowerCase() === subcategory.name.toLowerCase())) continue;
            subcategoriesToSave.set(`${categoryId}:${subcategory.name.toLowerCase()}`, { userId: id, categoryId, name: subcategory.name, icon: subcategory.icon });
          }
          if (subcategoriesToSave.size) {
            const candidates = [...subcategoriesToSave.values()];
            const existingSubcategories = await transaction.customSubcategory.findMany({
              where: { userId: id, categoryId: { in: [...new Set(candidates.map((subcategory) => subcategory.categoryId))] } },
              select: { categoryId: true, name: true },
            });
            const existingKeys = new Set(existingSubcategories.map((subcategory) => `${subcategory.categoryId}:${subcategory.name.toLowerCase()}`));
            const missingSubcategories = candidates.filter((subcategory) => !existingKeys.has(`${subcategory.categoryId}:${subcategory.name.toLowerCase()}`));
            if (missingSubcategories.length) await transaction.customSubcategory.createMany({ data: missingSubcategories, skipDuplicates: true });
          }
          const mappedValues = values.map((value) => ({ ...value, category: importedCategoryIds.get(value.category) ?? value.category }));
          if (mappedValues.some((value) => !allowedCategoryIds.has(value.category) && !importedIds.has(value.category))) throw new Error("One or more transaction categories are invalid.");
          await transaction.transaction.createMany({ data: mappedValues.map(({ location, ...value }) => ({
            ...value,
            occurredOn: asDate(value.occurredOn),
            userId: id,
            locationLabel: location?.label ?? null,
            locationAddress: location?.address ?? null,
            locationLatitude: location?.latitude ?? null,
            locationLongitude: location?.longitude ?? null,
            locationAccuracy: location?.accuracy ?? null,
            locationSource: location?.source ?? null,
            savedPlaceId: null,
          })) });
        }, { timeout: 15_000 });
        break;
      }
      case "saveReceiptSplit": {
        const value = receiptSplitSchema.parse(input.payload);
        await assertAccountDatesAreOpen(value.transactions.map((transaction) => ({ paymentAccountId: transaction.paymentAccountId, occurredOn: transaction.occurredOn })));
        const splitTotal = value.transactions.reduce((sum, transaction) => sum + transaction.amountMinor, 0);
        if (splitTotal !== value.totalMinor) throw new Error("Split amounts must equal the receipt total.");
        const customCategories = await db.customCategory.findMany({ where: { userId: id, kind: { in: ["expense", "both"] } }, select: { id: true } });
        const allowedCategories = new Set([...CATEGORIES.filter((category) => category.kind === "expense" || category.kind === "both").map((category) => category.id), ...customCategories.map((category) => category.id)]);
        if (value.transactions.some((transaction) => !allowedCategories.has(transaction.category))) throw new Error("One or more receipt categories are invalid.");
        const accountIds = [...new Set(value.transactions.flatMap((transaction) => transaction.paymentAccountId ? [transaction.paymentAccountId] : []))];
        if (accountIds.length) {
          const ownedAccounts = await db.paymentAccount.count({ where: { userId: id, id: { in: accountIds } } });
          if (ownedAccounts !== accountIds.length) throw new Error("One or more online payment accounts are invalid.");
        }
        await receiptData(value.receipt, id);
        try {
          await db.$transaction(async (transaction) => {
            const scan = await transaction.receiptScan.create({ data: {
              userId: id,
              name: value.receipt.name,
              mimeType: value.receipt.mimeType,
              size: value.receipt.size,
              storagePath: value.receipt.storagePath,
            } });
            await transaction.transaction.createMany({ data: value.transactions.map(({ location, ...entry }) => ({
              ...entry,
              occurredOn: asDate(entry.occurredOn),
              userId: id,
              receiptScanId: scan.id,
              locationLabel: location?.label ?? null,
              locationAddress: location?.address ?? null,
              locationLatitude: location?.latitude ?? null,
              locationLongitude: location?.longitude ?? null,
              locationAccuracy: location?.accuracy ?? null,
              locationSource: location?.source ?? null,
              savedPlaceId: null,
            })) });
          });
        } catch (error) {
          const alreadySaved = typeof error === "object" && error !== null && "code" in error && error.code === "P2002"
            && await db.receiptScan.count({ where: { userId: id, storagePath: value.receipt.storagePath } });
          if (!alreadySaved) throw error;
        }
        break;
      }
      case "deleteTransaction": {
        if (!recordId) throw new Error("Missing transaction id.");
        const existing = await db.transaction.findFirstOrThrow({ where: { id: recordId, userId: id, deletedAt: null }, select: { paymentAccountId: true, occurredOn: true, createdAt: true } });
        await assertAccountDatesAreOpen([{ paymentAccountId: existing.paymentAccountId, occurredOn: dateOnly(existing.occurredOn)!, createdAt: existing.createdAt.toISOString() }]);
        await db.transaction.update({ where: { id: recordId }, data: { deletedAt: new Date() } });
        break;
      }
      case "restoreTransaction": {
        if (!recordId) throw new Error("Missing transaction id.");
        const existing = await db.transaction.findFirstOrThrow({ where: { id: recordId, userId: id, deletedAt: { not: null } }, select: { paymentAccountId: true, occurredOn: true, createdAt: true, deletedAt: true } });
        if (!existing.deletedAt || Date.now() - existing.deletedAt.getTime() > TRANSACTION_UNDO_WINDOW_MS) throw new Error("The Undo window for this transaction has expired.");
        await assertAccountDatesAreOpen([{ paymentAccountId: existing.paymentAccountId, occurredOn: dateOnly(existing.occurredOn)!, createdAt: existing.createdAt.toISOString() }]);
        await db.transaction.update({ where: { id: recordId }, data: { deletedAt: null } });
        break;
      }
      case "saveSavedPlace": {
        const value = savedPlaceSchema.parse(input.payload);
        if (recordId) await db.savedPlace.updateMany({ where: { id: recordId, userId: id }, data: value });
        else await db.savedPlace.create({ data: { ...value, userId: id } });
        break;
      }
      case "deleteSavedPlace": {
        if (!recordId) throw new Error("Missing saved place id.");
        await db.savedPlace.deleteMany({ where: { id: recordId, userId: id } });
        break;
      }
      case "saveBudget": {
        const value = budgetSchema.parse(input.payload);
        if (recordId) await db.budget.updateMany({ where: { id: recordId, userId: id }, data: value });
        else await db.budget.upsert({ where: { userId_monthKey_category: { userId: id, monthKey: value.monthKey, category: value.category } }, update: value, create: { ...value, userId: id } });
        break;
      }
      case "deleteBudget": await db.budget.deleteMany({ where: { id: recordId, userId: id } }); break;
      case "saveRecurring": {
        const value = recurringSchema.parse(input.payload);
        const schedule = { recurrenceUnit: value.recurrenceUnit, recurrenceInterval: value.recurrenceInterval, anchorDate: value.startOn };
        const existing = recordId ? await db.recurringEntry.findFirstOrThrow({ where: { id: recordId, userId: id } }) : null;
        const scheduleUnchanged = existing
          && existing.recurrenceUnit === value.recurrenceUnit
          && existing.recurrenceInterval === value.recurrenceInterval
          && dateOnly(existing.anchorDate) === value.startOn;
        const nextDueOn = scheduleUnchanged
          ? dateOnly(existing.nextDueOn)!
          : firstRecurringOccurrence(schedule, dateOnlyInTimeZone("Asia/Kathmandu"));
        const data = {
          kind: value.kind,
          category: value.category,
          amountMinor: value.amountMinor,
          note: value.note,
          tags: value.tags,
          recurrenceUnit: value.recurrenceUnit,
          recurrenceInterval: value.recurrenceInterval,
          anchorDate: asDate(value.startOn),
          dayOfMonth: value.recurrenceUnit === "week" ? null : Number(value.startOn.slice(8, 10)),
          nextDueOn: asDate(nextDueOn),
        };
        if (recordId) await db.recurringEntry.updateMany({ where: { id: recordId, userId: id }, data });
        else await db.recurringEntry.create({ data: { ...data, userId: id } });
        break;
      }
      case "deleteRecurring": await db.recurringEntry.deleteMany({ where: { id: recordId, userId: id } }); break;
      case "confirmRecurring": {
        if (!recordId) throw new Error("Missing recurring entry id.");
        await db.$transaction(async (transaction) => {
          const recurring = await transaction.recurringEntry.findFirstOrThrow({ where: { id: recordId, userId: id } });
          const scheduledOn = dateOnly(recurring.nextDueOn)!;
          if (!recurring.active) throw new Error("This recurring entry is paused.");
          if (scheduledOn > dateOnlyInTimeZone("Asia/Kathmandu")) throw new Error("This recurring entry is not due yet.");
          const nextDueOn = nextRecurringOccurrence({
            recurrenceUnit: recurring.recurrenceUnit as RecurrenceUnit,
            recurrenceInterval: recurring.recurrenceInterval,
            anchorDate: dateOnly(recurring.anchorDate)!,
          }, scheduledOn);
          const updated = await transaction.recurringEntry.updateMany({
            where: { id: recurring.id, userId: id, nextDueOn: recurring.nextDueOn },
            data: { nextDueOn: asDate(nextDueOn) },
          });
          if (!updated.count) throw new Error("This recurring entry was already confirmed.");
          await transaction.transaction.create({ data: { userId: id, kind: recurring.kind, category: recurring.category, amountMinor: recurring.amountMinor, occurredOn: recurring.nextDueOn, note: recurring.note, paymentMode: "cash" } });
        });
        break;
      }
      case "saveGoal": {
        const value = goalSchema.parse(input.payload);
        const data = { ...value, savedMinor: Math.min(value.savedMinor, value.targetMinor), targetDate: value.targetDate ? asDate(value.targetDate) : null };
        if (recordId) {
          const details = { name: data.name, targetMinor: data.targetMinor, targetDate: data.targetDate };
          await db.savingsGoal.updateMany({ where: { id: recordId, userId: id }, data: details });
        } else {
          await db.savingsGoal.create({
            data: {
              ...data,
              userId: id,
              contributions: data.savedMinor > 0 ? { create: { userId: id, amountMinor: data.savedMinor, isOpeningBalance: true } } : undefined,
            },
          });
        }
        break;
      }
      case "contributeToGoal": {
        if (!recordId) throw new Error("Missing goal id.");
        const amountMinor = z.object({ amountMinor: z.number().int().positive() }).parse(input.payload).amountMinor;
        await db.$transaction(async (transaction) => {
          const goal = await transaction.savingsGoal.findFirstOrThrow({ where: { id: recordId, userId: id } });
          const addedMinor = Math.min(amountMinor, goal.targetMinor - goal.savedMinor);
          if (addedMinor <= 0) throw new Error("This goal is already complete.");
          const updated = await transaction.savingsGoal.updateMany({
            where: { id: goal.id, userId: id, savedMinor: goal.savedMinor },
            data: { savedMinor: { increment: addedMinor } },
          });
          if (!updated.count) throw new Error("The goal changed while this contribution was being added. Please try again.");
          await transaction.savingsGoalContribution.create({ data: { userId: id, goalId: goal.id, amountMinor: addedMinor } });
        });
        break;
      }
      case "deleteGoal": await db.savingsGoal.deleteMany({ where: { id: recordId, userId: id } }); break;
      case "saveCustomCategory": await db.customCategory.create({ data: { ...categorySchema.parse(input.payload), userId: id } }); break;
      case "updateCustomCategoryIcon": {
        if (!recordId) throw new Error("Missing category id.");
        const icon = z.object({ icon: categoryIconSchema }).parse(input.payload).icon;
        const updated = await db.customCategory.updateMany({ where: { id: recordId, userId: id }, data: { icon } });
        if (!updated.count) throw new Error("Category not found.");
        break;
      }
      case "deleteCustomCategory": {
        if (!recordId) throw new Error("Missing category id.");
        const category = await db.customCategory.findFirstOrThrow({ where: { id: recordId, userId: id } });
        const [transactions, budgets] = await Promise.all([
          db.transaction.count({ where: { userId: id, category: category.id, OR: [{ deletedAt: null }, { deletedAt: { gte: new Date(Date.now() - TRANSACTION_UNDO_WINDOW_MS) } }] } }),
          db.budget.count({ where: { userId: id, category: category.id } }),
        ]);
        if (transactions || budgets) return NextResponse.json({ error: "This category is in use. Reassign its entries before deleting it." }, { status: 409 });
        await db.$transaction([
          db.customSubcategory.deleteMany({ where: { userId: id, categoryId: category.id } }),
          db.customCategory.delete({ where: { id: category.id } }),
        ]);
        break;
      }
      case "saveCustomSubcategory": {
        const value = subcategorySchema.parse(input.payload);
        const categoryExists = CATEGORIES.some((category) => category.id === value.categoryId) || Boolean(await db.customCategory.findFirst({ where: { id: value.categoryId, userId: id }, select: { id: true } }));
        if (!categoryExists) throw new Error("Choose an available category.");
        if (SUBCATEGORIES[value.categoryId]?.options.some((name) => name.toLowerCase() === value.name.toLowerCase())) throw new Error("That subcategory already exists.");
        const duplicate = await db.customSubcategory.findFirst({ where: { userId: id, categoryId: value.categoryId, name: { equals: value.name, mode: "insensitive" } }, select: { id: true } });
        if (duplicate) throw new Error("That subcategory already exists.");
        await db.customSubcategory.create({ data: { ...value, userId: id } });
        break;
      }
      case "deleteCustomSubcategory": {
        if (!recordId) throw new Error("Missing subcategory id.");
        await db.customSubcategory.deleteMany({ where: { id: recordId, userId: id } });
        break;
      }
      case "savePaymentAccount": {
        const user = await db.user.findUniqueOrThrow({ where: { id }, select: { pinHash: true } });
        if (!user.pinHash) return NextResponse.json({ error: "Set up a ledger PIN in Security before adding an account." }, { status: 409 });
        const value = paymentAccountSchema.parse(input.payload);
        if (value.type !== "mobile_banking" && value.provider !== value.type) throw new Error("The payment provider does not match the account type.");
        if (value.type === "mobile_banking" && !NEPAL_MOBILE_BANKS.includes(value.provider as typeof NEPAL_MOBILE_BANKS[number])) throw new Error("Choose a bank from the supported Nepal bank list.");
        await db.paymentAccount.create({ data: { ...value, balanceAsOf: asDate(value.balanceAsOf), balanceRecordedAt: new Date(), userId: id } });
        break;
      }
      case "updatePaymentAccountBalance": {
        if (!recordId) throw new Error("Missing payment account id.");
        const value = accountBalanceSchema.parse(input.payload);
        const reconciled = await db.accountReconciliation.count({ where: { paymentAccountId: recordId, userId: id } });
        if (reconciled) return NextResponse.json({ error: "This account has an audit history. Use monthly reconciliation to update its balance." }, { status: 409 });
        await db.paymentAccount.updateMany({ where: { id: recordId, userId: id }, data: { balanceMinor: value.balanceMinor, balanceAsOf: asDate(value.balanceAsOf), balanceRecordedAt: new Date() } });
        break;
      }
      case "approveAccountReconciliation": {
        const value = accountReconciliationSchema.parse(input.payload);
        if (!value.checkedOn.startsWith(`${value.monthKey}-`)) throw new Error("The checked date must be inside the selected month.");
        const today = dateOnlyInTimeZone("Asia/Kathmandu");
        if (value.checkedOn > today) throw new Error("A reconciliation cannot be approved for a future date.");
        await db.$transaction(async (transaction) => {
          const account = await transaction.paymentAccount.findFirstOrThrow({ where: { id: value.paymentAccountId, userId: id } });
          if (dateOnly(account.balanceAsOf)! > value.checkedOn) throw new Error(`This account is already checked through ${dateOnly(account.balanceAsOf)}.`);
          const duplicate = await transaction.accountReconciliation.count({ where: { paymentAccountId: account.id, monthKey: value.monthKey } });
          if (duplicate) throw new Error("This account already has an approved reconciliation for that month.");
          const [activityTransactions, activityTransfers] = await Promise.all([
            transaction.transaction.findMany({
              where: { userId: id, paymentAccountId: account.id, deletedAt: null, occurredOn: { lte: asDate(value.checkedOn) } },
              select: { paymentAccountId: true, kind: true, amountMinor: true, occurredOn: true, createdAt: true },
            }),
            transaction.accountTransfer.findMany({
              where: {
                userId: id,
                occurredOn: { lte: asDate(value.checkedOn) },
                OR: [{ fromAccountId: account.id }, { toAccountId: account.id }],
              },
              select: { fromAccountId: true, toAccountId: true, amountMinor: true, occurredOn: true, createdAt: true },
            }),
          ]);
          const anchor: PaymentAccount = {
            id: account.id,
            importId: account.importId,
            userId: account.userId,
            type: account.type as PaymentAccount["type"],
            provider: account.provider,
            label: account.label,
            balanceMinor: account.balanceMinor,
            balanceAsOf: dateOnly(account.balanceAsOf)!,
            balanceRecordedAt: account.balanceRecordedAt.toISOString(),
            currentBalanceMinor: account.balanceMinor,
            createdAt: account.createdAt.toISOString(),
          };
          const preview = expectedAccountBalanceThrough(
            anchor,
            activityTransactions.map((item) => ({ ...item, kind: item.kind as LedgerTransaction["kind"], occurredOn: dateOnly(item.occurredOn)!, createdAt: item.createdAt.toISOString() })),
            activityTransfers.map((item) => ({ ...item, occurredOn: dateOnly(item.occurredOn)!, createdAt: item.createdAt.toISOString() })),
            value.checkedOn,
          );
          const adjustmentMinor = value.actualBalanceMinor - preview.expectedBalanceMinor;
          if (adjustmentMinor !== 0 && !value.adjustmentNote) throw new Error("Explain the difference before approving this reconciliation.");
          const approvedAt = new Date();
          await transaction.accountReconciliation.create({
            data: {
              userId: id,
              paymentAccountId: account.id,
              monthKey: value.monthKey,
              checkedOn: asDate(value.checkedOn),
              startingBalanceMinor: account.balanceMinor,
              startingBalanceAsOf: account.balanceAsOf,
              incomeMinor: preview.incomeMinor,
              expenseMinor: preview.expenseMinor,
              transfersInMinor: preview.transfersInMinor,
              transfersOutMinor: preview.transfersOutMinor,
              expectedBalanceMinor: preview.expectedBalanceMinor,
              actualBalanceMinor: value.actualBalanceMinor,
              adjustmentMinor,
              adjustmentNote: value.adjustmentNote,
              approvedAt,
            },
          });
          await transaction.paymentAccount.update({
            where: { id: account.id },
            data: { balanceMinor: value.actualBalanceMinor, balanceAsOf: asDate(value.checkedOn), balanceRecordedAt: approvedAt },
          });
        }, { isolationLevel: "Serializable" });
        break;
      }
      case "resetAccountReconciliation": {
        if (!recordId) throw new Error("Missing payment account id.");
        resetReconciliationSchema.parse(input.payload);
        await db.$transaction(async (transaction) => {
          const account = await transaction.paymentAccount.findFirstOrThrow({ where: { id: recordId, userId: id }, select: { id: true, createdAt: true } });
          const earliest = await transaction.accountReconciliation.findFirst({
            where: { paymentAccountId: account.id, userId: id },
            orderBy: [{ checkedOn: "asc" }, { approvedAt: "asc" }],
            select: { startingBalanceMinor: true, startingBalanceAsOf: true },
          });
          if (!earliest) throw new Error("This account has no reconciliation history to reset.");
          await transaction.paymentAccount.update({
            where: { id: account.id },
            data: { balanceMinor: earliest.startingBalanceMinor, balanceAsOf: earliest.startingBalanceAsOf, balanceRecordedAt: account.createdAt },
          });
          await transaction.accountReconciliation.deleteMany({ where: { paymentAccountId: account.id, userId: id } });
        }, { isolationLevel: "Serializable" });
        break;
      }
      case "deletePaymentAccount": {
        if (!recordId) throw new Error("Missing payment account id.");
        const reconciled = await db.accountReconciliation.count({ where: { paymentAccountId: recordId, userId: id } });
        if (reconciled) return NextResponse.json({ error: "A reconciled account cannot be removed because that would erase its audit history." }, { status: 409 });
        await db.paymentAccount.deleteMany({ where: { id: recordId, userId: id } });
        break;
      }
      case "saveTransfer": {
        const value = transferSchema.parse(input.payload);
        await assertAccountDatesAreOpen([
          { paymentAccountId: value.fromAccountId, occurredOn: value.occurredOn },
          { paymentAccountId: value.toAccountId, occurredOn: value.occurredOn },
        ]);
        const owned = await db.paymentAccount.findMany({ where: { userId: id, id: { in: [value.fromAccountId, value.toAccountId] } }, select: { id: true } });
        if (owned.length !== 2) throw new Error("Both transfer accounts must belong to you.");
        await db.accountTransfer.create({ data: { ...value, occurredOn: asDate(value.occurredOn), userId: id } });
        break;
      }
      case "deleteTransfer": {
        if (!recordId) throw new Error("Missing transfer id.");
        const existing = await db.accountTransfer.findFirstOrThrow({ where: { id: recordId, userId: id } });
        await assertAccountDatesAreOpen([
          { paymentAccountId: existing.fromAccountId, occurredOn: dateOnly(existing.occurredOn)!, createdAt: existing.createdAt.toISOString() },
          { paymentAccountId: existing.toAccountId, occurredOn: dateOnly(existing.occurredOn)!, createdAt: existing.createdAt.toISOString() },
        ]);
        await db.accountTransfer.deleteMany({ where: { id: recordId, userId: id } });
        break;
      }
      case "saveDueItem": {
        const value = dueSchema.parse(input.payload);
        if (value.remindOn && value.remindOn > value.dueOn) return NextResponse.json({ error: "The reminder must be on or before the due date." }, { status: 400 });
        const { receipt, ...dueValue } = value;
        const data = { ...dueValue, occurredOn: dueValue.occurredOn ? asDate(dueValue.occurredOn) : null, dueOn: asDate(dueValue.dueOn), remindOn: dueValue.remindOn ? asDate(dueValue.remindOn) : null };
        let dueItemId = recordId;
        if (recordId) {
          const existing = await db.dueItem.findFirstOrThrow({ where: { id: recordId, userId: id }, include: { payments: true } });
          const paid = existing.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
          if (paid && existing.kind !== value.kind) throw new Error("The due type cannot change after a repayment is recorded.");
          if (value.amountMinor < paid) throw new Error("The total amount cannot be less than the repayments already recorded.");
          await db.dueItem.update({ where: { id: existing.id }, data });
        }
        else dueItemId = (await db.dueItem.create({ data: { ...data, userId: id } })).id;
        if (receipt && dueItemId) {
          const oldReceipt = await db.receiptAttachment.findFirst({ where: { dueItemId, userId: id }, select: { storagePath: true } });
          const stored = await receiptData(receipt, id);
          await db.receiptAttachment.upsert({ where: { dueItemId }, update: stored, create: { ...stored, userId: id, dueItemId } });
          if (oldReceipt?.storagePath && oldReceipt.storagePath !== receipt.storagePath) await removeStoredReceipts([oldReceipt.storagePath]);
        }
        break;
      }
      case "deleteDueItem": {
        if (!recordId) throw new Error("Missing due item id.");
        const receipt = await db.receiptAttachment.findFirst({ where: { dueItemId: recordId, userId: id }, select: { storagePath: true } });
        await db.dueItem.deleteMany({ where: { id: recordId, userId: id } });
        await removeStoredReceipts([receipt?.storagePath]);
        break;
      }
      case "snoozeDueItem": {
        if (!recordId) throw new Error("Missing due item id.");
        const { until } = z.object({ until: z.string().date() }).parse(input.payload);
        const due = await db.dueItem.findFirstOrThrow({ where: { id: recordId, userId: id } });
        if (due.status !== "open") throw new Error("This item is already settled.");
        await db.dueItem.update({ where: { id: due.id }, data: { snoozedUntil: asDate(until) } });
        break;
      }
      case "recordDuePayment": {
        if (!recordId) throw new Error("Missing due item id.");
        const value = duePaymentSchema.parse(input.payload);
        const due = await db.dueItem.findFirstOrThrow({ where: { id: recordId, userId: id }, include: { payments: true } });
        if (due.status !== "open") throw new Error("This item is already settled.");
        const paid = due.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
        const amountMinor = Math.min(value.amountMinor, due.amountMinor - paid);
        if (amountMinor <= 0) throw new Error("This item has no remaining balance.");
        await db.$transaction(async (tx) => {
          let transactionId: string | null = null;
          if (value.addToLedger) {
            const transaction = await tx.transaction.create({ data: { userId: id, kind: due.kind === "lent" || due.kind === "receivable" ? "income" : "expense", category: due.category, amountMinor, occurredOn: asDate(value.occurredOn), note: value.note || `${due.kind === "lent" ? "Repayment from" : due.kind === "borrowed" ? "Repayment to" : due.kind === "payment" ? "Paid" : "Received"} ${due.person || due.title}`, paymentMode: "cash" } });
            transactionId = transaction.id;
          }
          await tx.duePayment.create({ data: { userId: id, dueItemId: due.id, amountMinor, occurredOn: asDate(value.occurredOn), note: value.note, transactionId } });
          if (paid + amountMinor >= due.amountMinor) await tx.dueItem.update({ where: { id: due.id }, data: { status: "completed", completedOn: asDate(value.occurredOn) } });
        });
        break;
      }
      case "completeDueItem": {
        if (!recordId) throw new Error("Missing due item id.");
        const { addToLedger, occurredOn: completedDate } = z.object({ addToLedger: z.boolean(), occurredOn: z.string().date() }).parse(input.payload);
        const due = await db.dueItem.findFirstOrThrow({ where: { id: recordId, userId: id }, include: { payments: true } });
        if (due.status !== "open") throw new Error("This item is already completed.");
        const paid = due.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
        const remaining = due.amountMinor - paid;
        if (remaining <= 0) throw new Error("This item has no remaining balance.");
        const occurredOn = asDate(completedDate);
        await db.$transaction(async (tx) => {
          let transactionId: string | null = null;
          if (addToLedger) {
            const transaction = await tx.transaction.create({ data: { userId: id, kind: due.kind === "receivable" || due.kind === "lent" ? "income" : "expense", category: due.category, amountMinor: remaining, occurredOn, note: due.title, paymentMode: "cash" } });
            transactionId = transaction.id;
          }
          await tx.duePayment.create({ data: { userId: id, dueItemId: due.id, amountMinor: remaining, occurredOn, note: "Marked complete", transactionId } });
          await tx.dueItem.update({ where: { id: due.id }, data: { status: "completed", completedOn: occurredOn } });
        });
        break;
      }
      case "updateProfile": {
        const value = profileSchema.parse(input.payload);
        const pin = await db.user.findUniqueOrThrow({ where: { id }, select: { pinHash: true } });
        await db.user.update({ where: { id }, data: { name: value.displayName, currency: value.currency, hideAmounts: value.hideAmounts, autoLockMinutes: pin.pinHash ? value.autoLockMinutes : 0 } });
        break;
      }
      case "savePin": {
        const value = z.object({ pin: pinSchema, currentPin: z.string().optional() }).parse(input.payload);
        const user = await db.user.findUniqueOrThrow({ where: { id }, select: { pinHash: true } });
        if (user.pinHash && (!value.currentPin || !await verifyPin(value.currentPin, user.pinHash))) return NextResponse.json({ error: "Current PIN did not match." }, { status: 401 });
        await db.user.update({ where: { id }, data: { pinHash: await hashPin(value.pin) } });
        break;
      }
      case "removePin": {
        const value = z.object({ currentPin: pinSchema }).parse(input.payload);
        const user = await db.user.findUniqueOrThrow({ where: { id }, select: { pinHash: true } });
        if (!user.pinHash || !await verifyPin(value.currentPin, user.pinHash)) return NextResponse.json({ error: "Current PIN did not match." }, { status: 401 });
        await db.user.update({ where: { id }, data: { pinHash: null, autoLockMinutes: 0 } });
        break;
      }
      default: return NextResponse.json({ error: "Unknown ledger action." }, { status: 400 });
    }
    return NextResponse.json(serialize(await loadLedger(id)));
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Request failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
