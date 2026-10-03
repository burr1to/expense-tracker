import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "../../../generated/prisma/client";
import { getAuthenticatedSession } from "../../../lib/auth";
import { getPrisma } from "../../../lib/prisma";
import { hashPin, verifyPin } from "../../../lib/pin";
import { NEPAL_MOBILE_BANKS, paymentAccountLabel } from "../../../lib/payment-accounts";
import { diffFields, DUE_KIND_LABELS, periodText, type ActivityChange, type ActivityDraft } from "../../../lib/activity-log";
import { purgeExpiredActivity, recordActivity } from "../../../lib/activity-recorder";
import { STORAGE_PERIOD_KEY } from "../../../lib/period";
import { removeStoredReceipts, verifyStoredReceipt } from "../../../lib/receipt-storage";
import { KATHMANDU_BOUNDS } from "../../../lib/kathmandu-locations";
import { expectedAccountBalanceThrough } from "../../../lib/account-balances";
import { asDate, dateOnly, loadLedger, purgeExpiredDeletedTransactions, serialize } from "../../../lib/ledger-snapshot";
import { CATEGORIES, importedCategoryColor, SUBCATEGORIES } from "../../../lib/categories";
import { CATEGORY_ICON_NAMES } from "../../../lib/category-icons";
import { IMPORT_BATCH_SIZE } from "../../../lib/import-job";
import { todayInput } from "../../../lib/dates";
import { canPostOnAccount } from "../../../lib/household";
import { escapeHtml, sendLedgerEmail } from "../../../lib/outbound-mail";
import { buildReminderDigest } from "../../../lib/reminder-digest";
import { dateOnlyInTimeZone, firstRecurringOccurrence, nextRecurringOccurrence, recurrenceLabel } from "../../../lib/recurrence";
import type { CategoryIconName, DueItem, LedgerTransaction, PaymentAccount, RecurrenceUnit } from "../../../types";

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
  shared: z.boolean().optional(),
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
const budgetSchema = z.object({ monthKey: z.string().regex(STORAGE_PERIOD_KEY), category: z.string().min(1).max(80), amountMinor: z.number().int().positive(), shared: z.boolean().optional() });
const recurringSchema = z.object({
  kind: z.enum(["income", "expense"]),
  category: z.string().min(1).max(80),
  amountMinor: z.number().int().positive(),
  paymentAccountId: z.string().nullable().optional(),
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
type ParsedTransactionImport = {
  transactions: z.infer<typeof transactionSchema>[];
  newCategories: z.infer<typeof importedCategorySchema>[];
  newSubcategories: z.infer<typeof importedSubcategorySchema>[];
};
const paymentAccountSchema = z.object({ type: z.enum(["mobile_banking", "esewa", "khalti", "connect_ips"]), provider: z.string().trim().min(1).max(100), label: z.string().trim().max(60), balanceMinor: z.number().int(), balanceAsOf: z.string().date(), shared: z.boolean().optional() });
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
const profileSchema = z.object({ displayName: z.string().trim().min(1).max(50), currency: z.enum(["NPR", "USD", "AUD"]), hideAmounts: z.boolean(), autoLockMinutes: z.number().int().min(0).max(120), calendarSystem: z.enum(["AD", "BS"]), safeToSpendBufferMinor: z.number().int().min(0).max(1_000_000_000), emailReminders: z.boolean(), browserReminders: z.boolean() });
const dueSchema = z.object({ kind: z.enum(["payment", "receivable", "lent", "borrowed"]), title: z.string().trim().min(1).max(100), person: z.string().trim().max(80), amountMinor: z.number().int().positive(), category: z.string().min(1).max(80), occurredOn: z.string().date().nullable(), dueOn: z.string().date(), remindOn: z.string().date().nullable(), note: z.string().trim().max(300), annualRatePercent: z.number().min(0).max(200).nullable().optional(), receipt: receiptSchema.optional() });
const duePaymentSchema = z.object({ amountMinor: z.number().int().positive(), occurredOn: z.string().date(), note: z.string().trim().max(240), addToLedger: z.boolean() });
const pinSchema = z.string().regex(/^\d{4,6}$/, "PIN must contain 4 to 6 digits.");
const requestSchema = z.object({ action: z.string(), id: z.string().optional(), payload: z.unknown().optional() });

const TRANSACTION_UNDO_WINDOW_MS = 30_000;

function serializeImportJob(job: { id: string; status: string; totalRows: number; processedRows: number; error: string | null; createdAt: Date; completedAt: Date | null }) {
  return { id: job.id, status: job.status, totalRows: job.totalRows, processedRows: job.processedRows, error: job.error, createdAt: job.createdAt.toISOString(), completedAt: job.completedAt?.toISOString() ?? null };
}
const receiptData = async (receipt: z.infer<typeof receiptSchema>, id: string) => {
  await verifyStoredReceipt(receipt.storagePath, id, receipt.mimeType, receipt.size);
  return { name: receipt.name, mimeType: receipt.mimeType, size: receipt.size, storagePath: receipt.storagePath, data: null };
};

async function userId() {
  const session = await getAuthenticatedSession(await headers());
  return session?.user.id ?? null;
}

async function assertHouseholdAccount(actorId: string, paymentAccountId: string | null, shared: boolean) {
  if (!paymentAccountId) return;
  const db = getPrisma();
  const account = await db.paymentAccount.findFirst({ where: { id: paymentAccountId }, select: { userId: true, shared: true } });
  if (!account) throw new Error("Choose an online payment account.");
  if (account.userId === actorId) return;
  const actor = await db.householdMember.findFirst({
    where: { userId: actorId, status: "active" },
    select: { household: { select: { members: { where: { status: "active" }, select: { userId: true } } } } },
  });
  const peerIds = actor?.household.members.flatMap((member) => member.userId && member.userId !== actorId ? [member.userId] : []) ?? [];
  if (!canPostOnAccount(actorId, account, shared, peerIds)) throw new Error("A shared entry can only use an account both of you have marked as shared.");
}


export async function GET() {
  const id = await userId();
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [ledger] = await Promise.all([
    loadLedger(id),
    purgeExpiredDeletedTransactions(id).catch((error) => console.warn("Could not purge expired deleted transactions.", error)),
    purgeExpiredActivity(id).catch((error) => console.warn("Could not purge expired activity.", error)),
  ]);
  return NextResponse.json(serialize(ledger));
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
    // Each successful action reports what it did; the entries are written after the change and returned for toasts.
    // Descriptions run after the change has committed; one that fails is reported and skipped, never surfaced as a failed change.
    // A description may return null when the save changed nothing worth recording.
    const pendingActivity: (() => Promise<ActivityDraft | null>)[] = [];
    const log = (describe: () => Promise<ActivityDraft | null>) => { pendingActivity.push(describe); };
    const flushActivity = async () => {
      const drafts = await Promise.all(pendingActivity.splice(0).map(async (describe) => {
        try { return await describe(); }
        catch (error) { console.error("Could not describe a ledger change for Logs.", error); return null; }
      }));
      return recordActivity(id, drafts.filter((draft): draft is ActivityDraft => draft !== null));
    };
    let customCategoryNames: Map<string, string> | null = null;
    // Label lookups fall back instead of throwing, so describing a change can never fail a change that already happened.
    const categoryLabel = async (categoryId: string) => {
      const builtIn = CATEGORIES.find((category) => category.id === categoryId);
      if (builtIn) return builtIn.label;
      try {
        customCategoryNames ??= new Map((await db.customCategory.findMany({ where: { userId: id }, select: { id: true, name: true } })).map((category) => [category.id, category.name]));
      } catch { customCategoryNames = new Map(); }
      return customCategoryNames.get(categoryId) ?? "Uncategorised";
    };
    const accountName = async (accountId: string | null) => {
      if (!accountId) return null;
      try {
        const account = await db.paymentAccount.findFirst({ where: { id: accountId }, select: { type: true, provider: true, label: true } });
        return account ? accountLabelOf(account) : "Removed account";
      } catch { return "Account"; }
    };
    const accountLabelOf = (account: { type: string; provider: string; label: string }) => paymentAccountLabel(account as unknown as PaymentAccount);
    const paymentText = async (mode: string, accountId: string | null) => mode === "online" ? await accountName(accountId) ?? "Online" : mode === "cheque" ? "Cheque" : "Cash";
    const entryLabel = async (entry: { note: string | null; category: string }) => entry.note?.trim() || await categoryLabel(entry.category);
    const kindNoun = (kind: string) => kind === "income" ? "income" : "an expense";
    const assertAccountDatesAreOpen = async (entries: readonly { paymentAccountId: string | null; occurredOn: string; createdAt?: string }[]) => {
      const now = new Date();
      const unique = [...new Map(entries.filter((entry) => entry.paymentAccountId).map((entry) => [`${entry.paymentAccountId}:${entry.occurredOn}:${entry.createdAt ?? "new"}`, entry])).values()];
      const accountIds = [...new Set(unique.map((entry) => entry.paymentAccountId!))];
      if (!accountIds.length) return;
      const reconciliations = await db.accountReconciliation.findMany({ where: { paymentAccountId: { in: accountIds } }, orderBy: { checkedOn: "desc" }, select: { paymentAccountId: true, checkedOn: true, approvedAt: true } });
      const firstLocked = unique.map((entry) => reconciliations.find((reconciliation) => reconciliation.paymentAccountId === entry.paymentAccountId && (reconciliation.checkedOn > asDate(entry.occurredOn) || (reconciliation.checkedOn.getTime() === asDate(entry.occurredOn).getTime() && reconciliation.approvedAt >= (entry.createdAt ? new Date(entry.createdAt) : now))))).find(Boolean);
      if (firstLocked) throw new Error(`This activity belongs to an approved reconciliation through ${dateOnly(firstLocked!.checkedOn)}. Add a current transaction or reconcile a later period instead of changing audited history.`);
    };
    const validateImportRequest = async (payload: ParsedTransactionImport) => {
      const values = payload.transactions;
      await assertAccountDatesAreOpen(values.map((value) => ({ paymentAccountId: value.paymentAccountId, occurredOn: value.occurredOn })));
      const accountIds = [...new Set(values.flatMap((value) => value.paymentAccountId ? [value.paymentAccountId] : []))];
      if (accountIds.length) {
        const ownedAccounts = await db.paymentAccount.count({ where: { userId: id, id: { in: accountIds } } });
        if (ownedAccounts !== accountIds.length) throw new Error("One or more online payment accounts are invalid.");
      }
      const existingCategories = await db.customCategory.findMany({ where: { userId: id }, select: { id: true } });
      const allowedCategoryIds = new Set([...CATEGORIES.map((category) => category.id), ...existingCategories.map((category) => category.id)]);
      for (const category of payload.newCategories) {
        if (CATEGORIES.some((existing) => existing.id.toLowerCase() === category.name.toLowerCase() || existing.label.toLowerCase() === category.name.toLowerCase())) throw new Error(`${category.name} is already a built-in category.`);
      }
      return allowedCategoryIds;
    };
    const writeImportBatch = async (payload: ParsedTransactionImport, importJobId: string | null = null) => {
      const values = payload.transactions;
      const allowedCategoryIds = await validateImportRequest(payload);
      return db.$transaction(async (transaction) => {
        const importedCategoryIds = new Map<string, string>();
        const createdCategoryIds: string[] = [];
        if (payload.newCategories.length) {
          const categoryNames = payload.newCategories.map((category) => category.name);
          const existingBefore = await transaction.customCategory.findMany({ where: { userId: id, name: { in: categoryNames } }, select: { id: true, name: true } });
          const existingIds = new Set(existingBefore.map((category) => category.id));
          await transaction.customCategory.createMany({
            data: payload.newCategories.map((category) => ({ userId: id, name: category.name, kind: category.kind, color: importedCategoryColor(category.name), icon: category.icon })),
            skipDuplicates: true,
          });
          const savedCategories = await transaction.customCategory.findMany({ where: { userId: id, name: { in: categoryNames } }, select: { id: true, name: true } });
          const savedIdsByName = new Map(savedCategories.map((category) => [category.name, category.id]));
          for (const category of payload.newCategories) {
            const categoryId = savedIdsByName.get(category.name);
            if (!categoryId) throw new Error(`Could not create ${category.name}.`);
            importedCategoryIds.set(category.key, categoryId);
          }
          createdCategoryIds.push(...savedCategories.filter((category) => !existingIds.has(category.id)).map((category) => category.id));
        }
        const importedIds = new Set(importedCategoryIds.values());
        const subcategoriesToSave = new Map<string, { userId: string; categoryId: string; name: string; icon: CategoryIconName }>();
        for (const subcategory of payload.newSubcategories) {
          const categoryId = importedCategoryIds.get(subcategory.category) ?? subcategory.category;
          if (!allowedCategoryIds.has(categoryId) && !importedIds.has(categoryId)) throw new Error(`${subcategory.name} references an invalid category.`);
          if (SUBCATEGORIES[categoryId]?.options.some((name) => name.toLowerCase() === subcategory.name.toLowerCase())) continue;
          subcategoriesToSave.set(`${categoryId}:${subcategory.name.toLowerCase()}`, { userId: id, categoryId, name: subcategory.name, icon: subcategory.icon });
        }
        const createdSubcategoryIds: string[] = [];
        if (subcategoriesToSave.size) {
          const candidates = [...subcategoriesToSave.values()];
          const existingSubcategories = await transaction.customSubcategory.findMany({
            where: { userId: id, categoryId: { in: [...new Set(candidates.map((subcategory) => subcategory.categoryId))] } },
            select: { id: true, categoryId: true, name: true },
          });
          const existingKeys = new Set(existingSubcategories.map((subcategory) => `${subcategory.categoryId}:${subcategory.name.toLowerCase()}`));
          const missingSubcategories = candidates.filter((subcategory) => !existingKeys.has(`${subcategory.categoryId}:${subcategory.name.toLowerCase()}`));
          if (missingSubcategories.length) await transaction.customSubcategory.createMany({ data: missingSubcategories, skipDuplicates: true });
          const savedSubcategories = await transaction.customSubcategory.findMany({
            where: { userId: id, categoryId: { in: [...new Set(candidates.map((subcategory) => subcategory.categoryId))] }, name: { in: candidates.map((subcategory) => subcategory.name) } },
            select: { id: true, categoryId: true, name: true },
          });
          createdSubcategoryIds.push(...savedSubcategories.filter((subcategory) => !existingKeys.has(`${subcategory.categoryId}:${subcategory.name.toLowerCase()}`)).map((subcategory) => subcategory.id));
        }
        const mappedValues = values.map((value) => ({ ...value, category: importedCategoryIds.get(value.category) ?? value.category }));
        if (mappedValues.some((value) => !allowedCategoryIds.has(value.category) && !importedIds.has(value.category))) throw new Error("One or more transaction categories are invalid.");
        await transaction.transaction.createMany({ data: mappedValues.map(({ location, ...value }) => ({
          ...value,
          occurredOn: asDate(value.occurredOn),
          userId: id,
          importJobId,
          locationLabel: location?.label ?? null,
          locationAddress: location?.address ?? null,
          locationLatitude: location?.latitude ?? null,
          locationLongitude: location?.longitude ?? null,
          locationAccuracy: location?.accuracy ?? null,
          locationSource: location?.source ?? null,
          savedPlaceId: null,
        })) });
        return { createdCategoryIds, createdSubcategoryIds };
      }, { timeout: 15_000 });
    };
    const rollbackImportJob = async (jobId: string, message: string) => {
      const failed = await db.$transaction(async (transaction) => {
        const job = await transaction.importJob.findFirstOrThrow({ where: { id: jobId, userId: id } });
        await transaction.transaction.deleteMany({ where: { userId: id, importJobId: jobId } });
        if (job.createdSubcategoryIds.length) {
          const createdSubcategories = await transaction.customSubcategory.findMany({ where: { userId: id, id: { in: job.createdSubcategoryIds } }, select: { id: true, categoryId: true, name: true } });
          if (createdSubcategories.length) {
            const usedSubcategories = await transaction.transaction.findMany({ where: { userId: id, OR: createdSubcategories.map((subcategory) => ({ category: subcategory.categoryId, subcategory: { equals: subcategory.name, mode: "insensitive" as const } })) }, select: { category: true, subcategory: true } });
            const usedKeys = new Set(usedSubcategories.map((subcategory) => `${subcategory.category}:${subcategory.subcategory?.toLowerCase()}`));
            const unusedIds = createdSubcategories.filter((subcategory) => !usedKeys.has(`${subcategory.categoryId}:${subcategory.name.toLowerCase()}`)).map((subcategory) => subcategory.id);
            if (unusedIds.length) await transaction.customSubcategory.deleteMany({ where: { userId: id, id: { in: unusedIds } } });
          }
        }
        if (job.createdCategoryIds.length) {
          const usedCategories = await transaction.transaction.findMany({ where: { userId: id, category: { in: job.createdCategoryIds } }, select: { category: true } });
          const usedBudgets = await transaction.budget.findMany({ where: { userId: id, category: { in: job.createdCategoryIds } }, select: { category: true } });
          const usedIds = new Set([...usedCategories, ...usedBudgets].map((category) => category.category));
          const unusedIds = job.createdCategoryIds.filter((categoryId) => !usedIds.has(categoryId));
          if (unusedIds.length) await transaction.customCategory.deleteMany({ where: { userId: id, id: { in: unusedIds } } });
        }
        return transaction.importJob.update({ where: { id: jobId }, data: { status: "failed", error: message, lockExpiresAt: null, completedAt: new Date() } });
      });
      return serializeImportJob(failed);
    };
    const processImportJob = async (jobId: string) => {
      const current = await db.importJob.findFirst({ where: { id: jobId, userId: id } });
      if (!current) throw new Error("Import job not found.");
      if (current.status === "completed" || current.status === "failed") return serializeImportJob(current);
      const now = new Date();
      const claimed = await db.importJob.updateMany({
        where: { id: jobId, userId: id, OR: [{ status: "queued" }, { status: "processing", lockExpiresAt: { lte: now } }] },
        data: { status: "processing", lockExpiresAt: new Date(now.getTime() + 30_000) },
      });
      const job = await db.importJob.findFirstOrThrow({ where: { id: jobId, userId: id } });
      if (!claimed.count) return serializeImportJob(job);
      try {
        const payload = transactionImportPayloadSchema.parse(job.payload) as ParsedTransactionImport;
        const batch = payload.transactions.slice(job.processedRows, job.processedRows + IMPORT_BATCH_SIZE);
        const created = await writeImportBatch({ ...payload, transactions: batch }, job.id);
        const processedRows = job.processedRows + batch.length;
        const complete = processedRows >= job.totalRows;
        if (complete) log(async () => ({ action: "transactions.imported", area: "data", entityId: job.id, title: `Imported ${job.totalRows.toLocaleString("en")} transaction${job.totalRows === 1 ? "" : "s"}`, meta: { count: job.totalRows, newCategories: job.createdCategoryIds.length + created.createdCategoryIds.length } }));
        const updated = await db.importJob.update({ where: { id: job.id }, data: {
          status: complete ? "completed" : "queued",
          processedRows,
          createdCategoryIds: { set: [...job.createdCategoryIds, ...created.createdCategoryIds] },
          createdSubcategoryIds: { set: [...job.createdSubcategoryIds, ...created.createdSubcategoryIds] },
          lockExpiresAt: null,
          completedAt: complete ? new Date() : null,
        } });
        return serializeImportJob(updated);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The import could not be completed.";
        const failed = await rollbackImportJob(job.id, message);
        log(async () => ({ action: "transactions.import_failed", area: "data", entityId: job.id, title: "Import failed and was undone", subject: message, meta: { count: job.totalRows } }));
        return failed;
      }
    };
    switch (input.action) {
      case "saveTransaction": {
        const value = savedTransactionSchema.parse(input.payload);
        const { receipt, removeReceipt, location, ...entry } = value;
        await assertAccountDatesAreOpen([{ paymentAccountId: entry.paymentAccountId, occurredOn: entry.occurredOn }]);
        const previous = recordId ? await db.transaction.findFirstOrThrow({ where: { id: recordId, userId: id, deletedAt: null }, select: { paymentAccountId: true, occurredOn: true, createdAt: true, kind: true, category: true, amountMinor: true, note: true, subcategory: true, paymentMode: true, shared: true, locationLabel: true, receiptScanId: true, receipt: { select: { id: true } } } }) : null;
        if (previous) await assertAccountDatesAreOpen([{ paymentAccountId: previous.paymentAccountId, occurredOn: dateOnly(previous.occurredOn)!, createdAt: previous.createdAt.toISOString() }]);
        await assertHouseholdAccount(id, entry.paymentAccountId, entry.shared ?? false);
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
        let savedTransactionId = recordId;
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
          savedTransactionId = transactionId;
          const oldReceipt = removeReceipt || receipt ? await transaction.receiptAttachment.findFirst({ where: { transactionId, userId: id }, select: { storagePath: true } }) : null;
          if (removeReceipt && !receipt) await transaction.receiptAttachment.deleteMany({ where: { transactionId, userId: id } });
          if (storedReceipt) await transaction.receiptAttachment.upsert({ where: { transactionId }, update: storedReceipt, create: { ...storedReceipt, userId: id, transactionId } });
          return [oldReceipt?.storagePath && oldReceipt.storagePath !== receipt?.storagePath ? oldReceipt.storagePath : null, detachedScanPath];
        });
        await removeStoredReceipts(pathsToRemove);
        log(async (): Promise<ActivityDraft | null> => {
          const subject = await entryLabel(entry);
          if (!previous) return { action: "transaction.created", area: "transactions", entityId: savedTransactionId, title: `Added ${kindNoun(entry.kind)}`, subject, amountMinor: entry.amountMinor, meta: { kind: entry.kind, receipt: Boolean(receipt) } };
          const describe = async (item: { kind: string; category: string; amountMinor: number; occurredOn: Date; note: string; subcategory: string | null; paymentMode: string; paymentAccountId: string | null; shared: boolean; locationLabel: string | null }) => ({
            kind: item.kind === "income" ? "Income" : "Expense",
            category: await categoryLabel(item.category),
            amountMinor: item.amountMinor,
            occurredOn: item.occurredOn,
            note: item.note.trim(),
            subcategory: item.subcategory,
            payment: await paymentText(item.paymentMode, item.paymentAccountId),
            place: item.locationLabel,
            shared: item.shared,
          });
          const hadReceipt = Boolean(previous.receipt || previous.receiptScanId);
          const changes: ActivityChange[] = diffFields(await describe(previous), await describe({ ...data, shared: data.shared ?? false }), [
            { key: "kind", label: "Type" }, { key: "category", label: "Category" }, { key: "amountMinor", label: "Amount", kind: "money" },
            { key: "occurredOn", label: "Date", kind: "date" }, { key: "note", label: "Note" }, { key: "subcategory", label: "Subcategory" },
            { key: "payment", label: "Paid with" }, { key: "place", label: "Place" }, { key: "shared", label: "Shared", kind: "flag" },
          ]);
          if (receipt) changes.push({ field: "Receipt", from: hadReceipt ? "Attached" : null, to: hadReceipt ? "Replaced" : "Attached" });
          else if (removeReceipt && hadReceipt) changes.push({ field: "Receipt", from: "Attached", to: null });
          return changes.length ? { action: "transaction.edited", area: "transactions", entityId: recordId, title: "Edited a transaction", subject, amountMinor: entry.amountMinor, changes, meta: { kind: entry.kind } } : null;
        });
        break;
      }
      case "listImportJobs": {
        const jobs = await db.importJob.findMany({ where: { userId: id, status: { in: ["queued", "processing"] } }, orderBy: { createdAt: "asc" }, take: 10 });
        return NextResponse.json({ jobs: jobs.map(serializeImportJob) });
      }
      case "startImportJob": {
        const value = transactionImportSchema.parse(input.payload) as ParsedTransactionImport;
        if (!value.transactions.length) throw new Error("There are no valid rows to import.");
        await validateImportRequest(value);
        const job = await db.importJob.create({ data: { userId: id, totalRows: value.transactions.length, payload: value as unknown as Prisma.InputJsonValue } });
        return NextResponse.json({ job: serializeImportJob(job) });
      }
      case "processImportJob": {
        const { jobId } = z.object({ jobId: z.string().min(1) }).parse(input.payload);
        const job = await processImportJob(jobId);
        return NextResponse.json({ job, activity: await flushActivity() });
      }
      case "importTransactions": {
        const value = transactionImportSchema.parse(input.payload) as ParsedTransactionImport;
        if (!value.transactions.length) throw new Error("There are no valid rows to import.");
        const created = await writeImportBatch(value);
        const count = value.transactions.length;
        log(async () => ({ action: "transactions.imported", area: "data", title: `Imported ${count.toLocaleString("en")} transaction${count === 1 ? "" : "s"}`, meta: { count, newCategories: created.createdCategoryIds.length } }));
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
        let splitCreated = true;
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
          splitCreated = false;
        }
        const count = value.transactions.length;
        if (splitCreated) log(async () => ({ action: "transactions.receipt_split", area: "transactions", title: count === 1 ? "Added an expense from a receipt" : `Added ${count} expenses from a receipt`, subject: value.receipt.name, amountMinor: value.totalMinor, meta: { count } }));
        break;
      }
      case "deleteTransaction": {
        if (!recordId) throw new Error("Missing transaction id.");
        const existing = await db.transaction.findFirstOrThrow({ where: { id: recordId, userId: id, deletedAt: null }, select: { paymentAccountId: true, occurredOn: true, createdAt: true, kind: true, category: true, note: true, amountMinor: true } });
        await assertAccountDatesAreOpen([{ paymentAccountId: existing.paymentAccountId, occurredOn: dateOnly(existing.occurredOn)!, createdAt: existing.createdAt.toISOString() }]);
        await db.transaction.update({ where: { id: recordId }, data: { deletedAt: new Date() } });
        log(async () => ({ action: "transaction.deleted", area: "transactions", entityId: recordId, title: `Deleted ${kindNoun(existing.kind)}`, subject: await entryLabel(existing), amountMinor: existing.amountMinor, meta: { kind: existing.kind } }));
        break;
      }
      case "restoreTransaction": {
        if (!recordId) throw new Error("Missing transaction id.");
        const existing = await db.transaction.findFirstOrThrow({ where: { id: recordId, userId: id, deletedAt: { not: null } }, select: { paymentAccountId: true, occurredOn: true, createdAt: true, deletedAt: true, kind: true, category: true, note: true, amountMinor: true } });
        if (!existing.deletedAt || Date.now() - existing.deletedAt.getTime() > TRANSACTION_UNDO_WINDOW_MS) throw new Error("The Undo window for this transaction has expired.");
        await assertAccountDatesAreOpen([{ paymentAccountId: existing.paymentAccountId, occurredOn: dateOnly(existing.occurredOn)!, createdAt: existing.createdAt.toISOString() }]);
        await db.transaction.update({ where: { id: recordId }, data: { deletedAt: null } });
        log(async () => ({ action: "transaction.restored", area: "transactions", entityId: recordId, title: `Restored ${kindNoun(existing.kind)}`, subject: await entryLabel(existing), amountMinor: existing.amountMinor, meta: { kind: existing.kind } }));
        break;
      }
      case "saveSavedPlace": {
        const value = savedPlaceSchema.parse(input.payload);
        if (recordId) {
          const before = await db.savedPlace.findFirstOrThrow({ where: { id: recordId, userId: id }, select: { name: true, icon: true, address: true, latitude: true, longitude: true } });
          await db.savedPlace.updateMany({ where: { id: recordId, userId: id }, data: value });
          const changes = diffFields({ ...before, pin: `${before.latitude},${before.longitude}` }, { ...value, pin: `${value.latitude},${value.longitude}` }, [{ key: "name", label: "Name" }, { key: "icon", label: "Icon" }, { key: "address", label: "Address" }]);
          if (before.latitude !== value.latitude || before.longitude !== value.longitude) changes.push({ field: "Map pin", from: "Previous spot", to: "Moved" });
          if (changes.length) log(async () => ({ action: "place.edited", area: "categories", entityId: recordId, title: "Edited a saved place", subject: value.name, changes }));
        } else {
          const place = await db.savedPlace.create({ data: { ...value, userId: id } });
          log(async () => ({ action: "place.created", area: "categories", entityId: place.id, title: "Saved a place", subject: value.name }));
        }
        break;
      }
      case "deleteSavedPlace": {
        if (!recordId) throw new Error("Missing saved place id.");
        const place = await db.savedPlace.findFirst({ where: { id: recordId, userId: id }, select: { name: true } });
        const removed = await db.savedPlace.deleteMany({ where: { id: recordId, userId: id } });
        if (removed.count) log(async () => ({ action: "place.deleted", area: "categories", entityId: recordId, title: "Removed a saved place", subject: place?.name }));
        break;
      }
      case "saveBudget": {
        const value = budgetSchema.parse(input.payload);
        const data = { monthKey: value.monthKey, category: value.category, amountMinor: value.amountMinor, ...(value.shared === undefined ? {} : { shared: value.shared }) };
        const before = recordId
          ? await db.budget.findFirst({ where: { id: recordId, userId: id }, select: { id: true, monthKey: true, category: true, amountMinor: true, shared: true } })
          : await db.budget.findUnique({ where: { userId_monthKey_category: { userId: id, monthKey: value.monthKey, category: value.category } }, select: { id: true, monthKey: true, category: true, amountMinor: true, shared: true } });
        let budgetId = before?.id ?? null;
        if (recordId) await db.budget.updateMany({ where: { id: recordId, userId: id }, data });
        else budgetId = (await db.budget.upsert({ where: { userId_monthKey_category: { userId: id, monthKey: value.monthKey, category: value.category } }, update: data, create: { ...data, userId: id } })).id;
        log(async (): Promise<ActivityDraft | null> => {
          const subject = `${await categoryLabel(value.category)} · ${periodText(value.monthKey)}`;
          if (!before) return { action: "budget.created", area: "planning", entityId: budgetId, title: "Set a budget", subject, amountMinor: value.amountMinor };
          const after = { ...before, ...data, shared: data.shared ?? before.shared };
          const changes = diffFields({ ...before, category: await categoryLabel(before.category), monthKey: periodText(before.monthKey) }, { ...after, category: await categoryLabel(after.category), monthKey: periodText(after.monthKey) }, [
            { key: "category", label: "Category" }, { key: "monthKey", label: "Period" }, { key: "amountMinor", label: "Limit", kind: "money" }, { key: "shared", label: "Shared", kind: "flag" },
          ]);
          return changes.length ? { action: "budget.edited", area: "planning", entityId: budgetId, title: "Changed a budget", subject, amountMinor: value.amountMinor, changes } : null;
        });
        break;
      }
      case "deleteBudget": {
        if (!recordId) throw new Error("Missing budget id.");
        const budget = await db.budget.findFirst({ where: { id: recordId, userId: id }, select: { category: true, monthKey: true, amountMinor: true } });
        const removed = await db.budget.deleteMany({ where: { id: recordId, userId: id } });
        if (removed.count && budget) log(async () => ({ action: "budget.deleted", area: "planning", entityId: recordId, title: "Removed a budget", subject: `${await categoryLabel(budget.category)} · ${periodText(budget.monthKey)}`, amountMinor: budget.amountMinor }));
        break;
      }
      case "saveRecurring": {
        const value = recurringSchema.parse(input.payload);
        if (value.paymentAccountId) await db.paymentAccount.findFirstOrThrow({ where: { id: value.paymentAccountId, userId: id } });
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
          paymentAccountId: value.paymentAccountId ?? null,
          note: value.note,
          tags: value.tags,
          recurrenceUnit: value.recurrenceUnit,
          recurrenceInterval: value.recurrenceInterval,
          anchorDate: asDate(value.startOn),
          dayOfMonth: value.recurrenceUnit === "day" || value.recurrenceUnit === "week" ? null : Number(value.startOn.slice(8, 10)),
          nextDueOn: asDate(nextDueOn),
        };
        if (recordId && existing) {
          await db.recurringEntry.updateMany({ where: { id: recordId, userId: id }, data });
          log(async (): Promise<ActivityDraft | null> => {
            const describe = async (item: { kind: string; category: string; amountMinor: number; note: string; paymentAccountId: string | null; recurrenceUnit: string; recurrenceInterval: number; anchorDate: Date }) => ({
              kind: item.kind === "income" ? "Income" : "Expense",
              category: await categoryLabel(item.category),
              amountMinor: item.amountMinor,
              note: item.note.trim(),
              account: await accountName(item.paymentAccountId) ?? "Cash",
              schedule: recurrenceLabel({ recurrenceUnit: item.recurrenceUnit as RecurrenceUnit, recurrenceInterval: item.recurrenceInterval }),
              startsOn: item.anchorDate,
          });
          const changes = diffFields(await describe(existing), await describe(data), [
            { key: "kind", label: "Type" }, { key: "category", label: "Category" }, { key: "amountMinor", label: "Amount", kind: "money" }, { key: "note", label: "Note" },
            { key: "account", label: "Paid with" }, { key: "schedule", label: "Repeats" }, { key: "startsOn", label: "Starts", kind: "date" },
          ]);
          return changes.length ? { action: "recurring.edited", area: "planning", entityId: recordId, title: "Edited a recurring entry", subject: await entryLabel(value), amountMinor: value.amountMinor, changes } : null;
          });
        } else {
          const created = await db.recurringEntry.create({ data: { ...data, userId: id } });
          log(async () => ({ action: "recurring.created", area: "planning", entityId: created.id, title: "Added a recurring entry", subject: await entryLabel(value), amountMinor: value.amountMinor, meta: { kind: value.kind, repeats: recurrenceLabel(value) } }));
        }
        break;
      }
      case "deleteRecurring": {
        if (!recordId) throw new Error("Missing recurring entry id.");
        const recurring = await db.recurringEntry.findFirst({ where: { id: recordId, userId: id }, select: { note: true, category: true, amountMinor: true } });
        const removed = await db.recurringEntry.deleteMany({ where: { id: recordId, userId: id } });
        if (removed.count && recurring) log(async () => ({ action: "recurring.deleted", area: "planning", entityId: recordId, title: "Removed a recurring entry", subject: await entryLabel(recurring), amountMinor: recurring.amountMinor }));
        break;
      }
      case "confirmRecurring": {
        if (!recordId) throw new Error("Missing recurring entry id.");
        const confirmed = await db.$transaction(async (transaction) => {
          const recurring = await transaction.recurringEntry.findFirstOrThrow({ where: { id: recordId, userId: id } });
          const scheduledOn = dateOnly(recurring.nextDueOn)!;
          if (!recurring.active) throw new Error("This recurring entry is paused.");
          if (scheduledOn > dateOnlyInTimeZone("Asia/Kathmandu")) throw new Error("This recurring entry is not due yet.");
          if (recurring.paymentAccountId) await transaction.paymentAccount.findFirstOrThrow({ where: { id: recurring.paymentAccountId, userId: id } });
          await assertAccountDatesAreOpen([{ paymentAccountId: recurring.paymentAccountId, occurredOn: scheduledOn }]);
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
          const created = await transaction.transaction.create({ data: { userId: id, kind: recurring.kind, category: recurring.category, amountMinor: recurring.amountMinor, occurredOn: recurring.nextDueOn, note: recurring.note, paymentMode: recurring.paymentAccountId ? "online" : "cash", paymentAccountId: recurring.paymentAccountId } });
          return { recurring, transactionId: created?.id ?? null };
        });
        log(async () => ({ action: "recurring.recorded", area: "transactions", entityId: confirmed.transactionId, title: `Recorded scheduled ${confirmed.recurring.kind === "income" ? "income" : "expense"}`, subject: await entryLabel(confirmed.recurring), amountMinor: confirmed.recurring.amountMinor, meta: { kind: confirmed.recurring.kind } }));
        break;
      }
      case "saveGoal": {
        const value = goalSchema.parse(input.payload);
        const data = { ...value, savedMinor: Math.min(value.savedMinor, value.targetMinor), targetDate: value.targetDate ? asDate(value.targetDate) : null };
        if (recordId) {
          const details = { name: data.name, targetMinor: data.targetMinor, targetDate: data.targetDate };
          const before = await db.savingsGoal.findFirstOrThrow({ where: { id: recordId, userId: id }, select: { name: true, targetMinor: true, targetDate: true } });
          await db.savingsGoal.updateMany({ where: { id: recordId, userId: id }, data: details });
          const changes = diffFields(before, details, [{ key: "name", label: "Name" }, { key: "targetMinor", label: "Target", kind: "money" }, { key: "targetDate", label: "Target date", kind: "date" }]);
          if (changes.length) log(async () => ({ action: "goal.edited", area: "planning", entityId: recordId, title: "Edited a savings goal", subject: data.name, amountMinor: data.targetMinor, changes }));
        } else {
          const goal = await db.savingsGoal.create({
            data: {
              ...data,
              userId: id,
              contributions: data.savedMinor > 0 ? { create: { userId: id, amountMinor: data.savedMinor, isOpeningBalance: true } } : undefined,
            },
          });
          log(async () => ({ action: "goal.created", area: "planning", entityId: goal.id, title: "Created a savings goal", subject: data.name, amountMinor: data.targetMinor, meta: { savedMinor: data.savedMinor } }));
        }
        break;
      }
      case "contributeToGoal": {
        if (!recordId) throw new Error("Missing goal id.");
        const amountMinor = z.object({ amountMinor: z.number().int().positive() }).parse(input.payload).amountMinor;
        const contribution = await db.$transaction(async (transaction) => {
          const goal = await transaction.savingsGoal.findFirstOrThrow({ where: { id: recordId, userId: id } });
          const addedMinor = Math.min(amountMinor, goal.targetMinor - goal.savedMinor);
          if (addedMinor <= 0) throw new Error("This goal is already complete.");
          const updated = await transaction.savingsGoal.updateMany({
            where: { id: goal.id, userId: id, savedMinor: goal.savedMinor },
            data: { savedMinor: { increment: addedMinor } },
          });
          if (!updated.count) throw new Error("The goal changed while this contribution was being added. Please try again.");
          await transaction.savingsGoalContribution.create({ data: { userId: id, goalId: goal.id, amountMinor: addedMinor } });
          return { name: goal.name, addedMinor, completed: goal.savedMinor + addedMinor >= goal.targetMinor };
        });
        log(async () => ({ action: "goal.contributed", area: "planning", entityId: recordId, title: contribution.completed ? "Reached a savings goal" : "Added to a savings goal", subject: contribution.name, amountMinor: contribution.addedMinor, meta: { completed: contribution.completed } }));
        break;
      }
      case "deleteGoal": {
        if (!recordId) throw new Error("Missing goal id.");
        const goal = await db.savingsGoal.findFirst({ where: { id: recordId, userId: id }, select: { name: true, savedMinor: true } });
        const removed = await db.savingsGoal.deleteMany({ where: { id: recordId, userId: id } });
        if (removed.count && goal) log(async () => ({ action: "goal.deleted", area: "planning", entityId: recordId, title: "Deleted a savings goal", subject: goal.name, amountMinor: goal.savedMinor }));
        break;
      }
      case "saveCustomCategory": {
        const category = await db.customCategory.create({ data: { ...categorySchema.parse(input.payload), userId: id } });
        log(async () => ({ action: "category.created", area: "categories", entityId: category.id, title: "Created a category", subject: category.name }));
        break;
      }
      case "updateCustomCategoryIcon": {
        if (!recordId) throw new Error("Missing category id.");
        const icon = z.object({ icon: categoryIconSchema }).parse(input.payload).icon;
        const before = await db.customCategory.findFirst({ where: { id: recordId, userId: id }, select: { name: true, icon: true } });
        const updated = await db.customCategory.updateMany({ where: { id: recordId, userId: id }, data: { icon } });
        if (!updated.count) throw new Error("Category not found.");
        if (before && before.icon !== icon) log(async () => ({ action: "category.icon_changed", area: "categories", entityId: recordId, title: "Changed a category icon", subject: before.name, changes: [{ field: "Icon", from: before.icon, to: icon }] }));
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
        log(async () => ({ action: "category.deleted", area: "categories", entityId: category.id, title: "Deleted a category", subject: category.name }));
        break;
      }
      case "saveCustomSubcategory": {
        const value = subcategorySchema.parse(input.payload);
        const categoryExists = CATEGORIES.some((category) => category.id === value.categoryId) || Boolean(await db.customCategory.findFirst({ where: { id: value.categoryId, userId: id }, select: { id: true } }));
        if (!categoryExists) throw new Error("Choose an available category.");
        if (SUBCATEGORIES[value.categoryId]?.options.some((name) => name.toLowerCase() === value.name.toLowerCase())) throw new Error("That subcategory already exists.");
        const duplicate = await db.customSubcategory.findFirst({ where: { userId: id, categoryId: value.categoryId, name: { equals: value.name, mode: "insensitive" } }, select: { id: true } });
        if (duplicate) throw new Error("That subcategory already exists.");
        const subcategory = await db.customSubcategory.create({ data: { ...value, userId: id } });
        log(async () => ({ action: "subcategory.created", area: "categories", entityId: subcategory.id, title: "Created a subcategory", subject: `${await categoryLabel(value.categoryId)} › ${value.name}` }));
        break;
      }
      case "deleteCustomSubcategory": {
        if (!recordId) throw new Error("Missing subcategory id.");
        const subcategory = await db.customSubcategory.findFirst({ where: { id: recordId, userId: id }, select: { name: true, categoryId: true } });
        const removed = await db.customSubcategory.deleteMany({ where: { id: recordId, userId: id } });
        if (removed.count && subcategory) log(async () => ({ action: "subcategory.deleted", area: "categories", entityId: recordId, title: "Deleted a subcategory", subject: `${await categoryLabel(subcategory.categoryId)} › ${subcategory.name}` }));
        break;
      }
      case "savePaymentAccount": {
        const user = await db.user.findUniqueOrThrow({ where: { id }, select: { pinHash: true } });
        if (!user.pinHash) return NextResponse.json({ error: "Set up a ledger PIN in Security before adding an account." }, { status: 409 });
        const value = paymentAccountSchema.parse(input.payload);
        if (value.type !== "mobile_banking" && value.provider !== value.type) throw new Error("The payment provider does not match the account type.");
        if (value.type === "mobile_banking" && !NEPAL_MOBILE_BANKS.includes(value.provider as typeof NEPAL_MOBILE_BANKS[number])) throw new Error("Choose a bank from the supported Nepal bank list.");
        const account = await db.paymentAccount.create({ data: { ...value, shared: value.shared ?? false, balanceAsOf: asDate(value.balanceAsOf), balanceRecordedAt: new Date(), userId: id } });
        log(async () => ({ action: "account.created", area: "accounts", entityId: account.id, title: "Added an account", subject: accountLabelOf(account), amountMinor: value.balanceMinor, meta: { balanceAsOf: value.balanceAsOf } }));
        break;
      }
      case "updatePaymentAccountBalance": {
        if (!recordId) throw new Error("Missing payment account id.");
        const value = accountBalanceSchema.parse(input.payload);
        const reconciled = await db.accountReconciliation.count({ where: { paymentAccountId: recordId, userId: id } });
        if (reconciled) return NextResponse.json({ error: "This account has an audit history. Use monthly reconciliation to update its balance." }, { status: 409 });
        const before = await db.paymentAccount.findFirstOrThrow({ where: { id: recordId, userId: id }, select: { type: true, provider: true, label: true, balanceMinor: true, balanceAsOf: true } });
        await db.paymentAccount.updateMany({ where: { id: recordId, userId: id }, data: { balanceMinor: value.balanceMinor, balanceAsOf: asDate(value.balanceAsOf), balanceRecordedAt: new Date() } });
        const changes = diffFields(before, { ...before, balanceMinor: value.balanceMinor, balanceAsOf: asDate(value.balanceAsOf) }, [{ key: "balanceMinor", label: "Balance", kind: "money" }, { key: "balanceAsOf", label: "As of", kind: "date" }]);
        if (changes.length) log(async () => ({ action: "account.balance_updated", area: "accounts", entityId: recordId, title: "Updated an account balance", subject: accountLabelOf(before), amountMinor: value.balanceMinor, changes }));
        break;
      }
      case "approveAccountReconciliation": {
        const value = accountReconciliationSchema.parse(input.payload);
        if (!value.checkedOn.startsWith(`${value.monthKey}-`)) throw new Error("The checked date must be inside the selected month.");
        const today = dateOnlyInTimeZone("Asia/Kathmandu");
        if (value.checkedOn > today) throw new Error("A reconciliation cannot be approved for a future date.");
        const reconciliation = await db.$transaction(async (transaction) => {
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
          return { account, expectedBalanceMinor: preview.expectedBalanceMinor, adjustmentMinor };
        }, { isolationLevel: "Serializable" });
        log(async () => ({
          action: "account.reconciled",
          area: "accounts",
          entityId: value.paymentAccountId,
          title: "Reconciled an account",
          subject: `${accountLabelOf(reconciliation.account)} · ${periodText(value.monthKey)}`,
          amountMinor: value.actualBalanceMinor,
          changes: reconciliation.adjustmentMinor ? [{ field: "Balance", from: { money: reconciliation.expectedBalanceMinor }, to: { money: value.actualBalanceMinor } }] : [],
          meta: { adjustmentMinor: reconciliation.adjustmentMinor, note: value.adjustmentNote || null, checkedOn: value.checkedOn },
        }));
        break;
      }
      case "resetAccountReconciliation": {
        if (!recordId) throw new Error("Missing payment account id.");
        resetReconciliationSchema.parse(input.payload);
        const reset = await db.$transaction(async (transaction) => {
          const account = await transaction.paymentAccount.findFirstOrThrow({ where: { id: recordId, userId: id }, select: { id: true, createdAt: true, type: true, provider: true, label: true } });
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
          const removed = await transaction.accountReconciliation.deleteMany({ where: { paymentAccountId: account.id, userId: id } });
          return { account, removed: removed?.count ?? 0 };
        }, { isolationLevel: "Serializable" });
        log(async () => ({ action: "account.reconciliation_reset", area: "accounts", entityId: recordId, title: "Reset an account's reconciliations", subject: accountLabelOf(reset.account), meta: { removed: reset.removed } }));
        break;
      }
      case "deletePaymentAccount": {
        if (!recordId) throw new Error("Missing payment account id.");
        const reconciled = await db.accountReconciliation.count({ where: { paymentAccountId: recordId, userId: id } });
        if (reconciled) return NextResponse.json({ error: "A reconciled account cannot be removed because that would erase its audit history." }, { status: 409 });
        const account = await db.paymentAccount.findFirst({ where: { id: recordId, userId: id }, select: { type: true, provider: true, label: true, balanceMinor: true } });
        const removed = await db.paymentAccount.deleteMany({ where: { id: recordId, userId: id } });
        if (removed.count && account) log(async () => ({ action: "account.deleted", area: "accounts", entityId: recordId, title: "Removed an account", subject: accountLabelOf(account) }));
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
        const transfer = await db.accountTransfer.create({ data: { ...value, occurredOn: asDate(value.occurredOn), userId: id } });
        log(async () => ({ action: "transfer.created", area: "accounts", entityId: transfer.id, title: "Moved money between accounts", subject: `${await accountName(value.fromAccountId)} → ${await accountName(value.toAccountId)}`, amountMinor: value.amountMinor }));
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
        log(async () => ({ action: "transfer.deleted", area: "accounts", entityId: recordId, title: "Deleted a transfer", subject: `${await accountName(existing.fromAccountId)} → ${await accountName(existing.toAccountId)}`, amountMinor: existing.amountMinor }));
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
          log(async (): Promise<ActivityDraft | null> => {
            const describe = async (item: { kind: string; title: string; person: string; amountMinor: number; category: string; dueOn: Date; remindOn: Date | null; note: string; annualRatePercent?: number | null }) => ({
              ...item, kind: DUE_KIND_LABELS[item.kind] ?? item.kind, category: await categoryLabel(item.category), rate: item.annualRatePercent == null ? null : `${item.annualRatePercent}% a year`,
          });
          const changes = diffFields(await describe(existing), await describe(data), [
            { key: "kind", label: "Type" }, { key: "title", label: "Title" }, { key: "person", label: "Person" }, { key: "amountMinor", label: "Amount", kind: "money" },
            { key: "category", label: "Category" }, { key: "dueOn", label: "Due", kind: "date" }, { key: "remindOn", label: "Reminder", kind: "date" }, { key: "note", label: "Note" }, { key: "rate", label: "Interest" },
          ]);
          if (receipt) changes.push({ field: "Receipt", from: null, to: "Attached" });
          return changes.length ? { action: "due.edited", area: "dues", entityId: recordId, title: "Edited a due", subject: value.title, amountMinor: value.amountMinor, changes } : null;
          });
        } else {
          dueItemId = (await db.dueItem.create({ data: { ...data, userId: id } })).id;
          log(async () => ({ action: "due.created", area: "dues", entityId: dueItemId, title: "Added a due", subject: value.title, amountMinor: value.amountMinor, meta: { kind: value.kind, type: DUE_KIND_LABELS[value.kind] ?? value.kind, dueOn: value.dueOn } }));
        }
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
        const due = await db.dueItem.findFirst({ where: { id: recordId, userId: id }, select: { title: true, amountMinor: true } });
        const removed = await db.dueItem.deleteMany({ where: { id: recordId, userId: id } });
        await removeStoredReceipts([receipt?.storagePath]);
        if (removed.count && due) log(async () => ({ action: "due.deleted", area: "dues", entityId: recordId, title: "Deleted a due", subject: due.title, amountMinor: due.amountMinor }));
        break;
      }
      case "snoozeDueItem": {
        if (!recordId) throw new Error("Missing due item id.");
        const { until } = z.object({ until: z.string().date() }).parse(input.payload);
        const due = await db.dueItem.findFirstOrThrow({ where: { id: recordId, userId: id } });
        if (due.status !== "open") throw new Error("This item is already settled.");
        await db.dueItem.update({ where: { id: due.id }, data: { snoozedUntil: asDate(until) } });
        log(async () => ({ action: "due.snoozed", area: "dues", entityId: due.id, title: "Snoozed a reminder", subject: due.title, changes: [{ field: "Remind again", from: null, to: { date: until } }] }));
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
        const settled = paid + amountMinor >= due.amountMinor;
        log(async () => ({ action: settled ? "due.settled" : "due.payment_recorded", area: "dues", entityId: due.id, title: settled ? "Settled a due" : "Recorded a repayment", subject: due.title, amountMinor, meta: { addedToLedger: value.addToLedger, remainingMinor: Math.max(0, due.amountMinor - paid - amountMinor) } }));
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
        log(async () => ({ action: "due.settled", area: "dues", entityId: due.id, title: "Settled a due", subject: due.title, amountMinor: remaining, meta: { addedToLedger: addToLedger, remainingMinor: 0 } }));
        break;
      }
      case "updateProfile": {
        const value = profileSchema.parse(input.payload);
        const before = await db.user.findUniqueOrThrow({ where: { id }, select: { pinHash: true, name: true, currency: true, hideAmounts: true, autoLockMinutes: true, calendarSystem: true, safeToSpendBufferMinor: true, emailReminders: true, browserReminders: true } });
        const after = { name: value.displayName, currency: value.currency, hideAmounts: value.hideAmounts, autoLockMinutes: before.pinHash ? value.autoLockMinutes : 0, calendarSystem: value.calendarSystem, safeToSpendBufferMinor: value.safeToSpendBufferMinor, emailReminders: value.emailReminders, browserReminders: value.browserReminders };
        await db.user.update({ where: { id }, data: after });
        const settingsView = (item: Omit<typeof after, "currency" | "calendarSystem"> & { currency: string; calendarSystem: string }) => ({
          ...item,
          autoLockMinutes: item.autoLockMinutes ? `After ${item.autoLockMinutes} minute${item.autoLockMinutes === 1 ? "" : "s"}` : "Off",
          calendarSystem: item.calendarSystem === "BS" ? "Bikram Sambat" : "Gregorian",
        });
        const changes = diffFields(settingsView(before), settingsView(after), [
          { key: "name", label: "Display name" }, { key: "currency", label: "Currency" }, { key: "hideAmounts", label: "Hide amounts", kind: "flag" },
          { key: "autoLockMinutes", label: "Auto-lock" }, { key: "calendarSystem", label: "Calendar" }, { key: "safeToSpendBufferMinor", label: "Safe-to-spend buffer", kind: "money" },
          { key: "emailReminders", label: "Email reminders", kind: "flag" }, { key: "browserReminders", label: "Browser reminders", kind: "flag" },
        ]);
        if (changes.length) log(async () => ({ action: "settings.updated", area: "settings", title: changes.length === 1 ? `Changed ${changes[0].field.toLowerCase()}` : `Changed ${changes.length} settings`, changes }));
        break;
      }
      case "savePin": {
        const value = z.object({ pin: pinSchema, currentPin: z.string().optional() }).parse(input.payload);
        const user = await db.user.findUniqueOrThrow({ where: { id }, select: { pinHash: true } });
        if (user.pinHash && (!value.currentPin || !await verifyPin(value.currentPin, user.pinHash))) return NextResponse.json({ error: "Current PIN did not match." }, { status: 401 });
        await db.user.update({ where: { id }, data: { pinHash: await hashPin(value.pin) } });
        log(async () => ({ action: user.pinHash ? "pin.changed" : "pin.set", area: "security", title: user.pinHash ? "Changed your ledger PIN" : "Set a ledger PIN" }));
        break;
      }
      case "removePin": {
        const value = z.object({ currentPin: pinSchema }).parse(input.payload);
        const user = await db.user.findUniqueOrThrow({ where: { id }, select: { pinHash: true } });
        if (!user.pinHash || !await verifyPin(value.currentPin, user.pinHash)) return NextResponse.json({ error: "Current PIN did not match." }, { status: 401 });
        await db.user.update({ where: { id }, data: { pinHash: null, autoLockMinutes: 0 } });
        log(async () => ({ action: "pin.removed", area: "security", title: "Removed your ledger PIN" }));
        break;
      }
      case "sendDueReminders": {
        const today = todayInput();
        const me = await db.user.findUniqueOrThrow({ where: { id }, select: { email: true, emailReminders: true, lastReminderEmailOn: true } });
        if (!me.emailReminders || dateOnly(me.lastReminderEmailOn) === today) return NextResponse.json({ ok: true });
        const [dues, recurring] = await Promise.all([
          db.dueItem.findMany({ where: { userId: id, status: "open" }, include: { payments: { select: { amountMinor: true } } } }),
          db.recurringEntry.findMany({ where: { userId: id, active: true } }),
        ]);
        const notices = buildReminderDigest({
          today,
          dues: dues.map((item) => ({
            id: item.id,
            userId: id,
            kind: item.kind as DueItem["kind"],
            title: item.title,
            person: item.person,
            amountMinor: item.amountMinor,
            category: item.category,
            occurredOn: dateOnly(item.occurredOn),
            dueOn: dateOnly(item.dueOn)!,
            remindOn: dateOnly(item.remindOn),
            snoozedUntil: dateOnly(item.snoozedUntil),
            note: item.note,
            status: item.status as DueItem["status"],
            annualRatePercent: item.annualRatePercent,
            completedOn: dateOnly(item.completedOn),
            createdAt: item.createdAt.toISOString(),
            payments: item.payments.map((payment, index) => ({ id: `${item.id}-${index}`, userId: id, dueItemId: item.id, amountMinor: payment.amountMinor, occurredOn: today, note: "", transactionId: null, createdAt: item.createdAt.toISOString() })),
          })),
          recurring: recurring.flatMap((item) => {
            const nextDueOn = dateOnly(item.nextDueOn);
            if (!nextDueOn) return [];
            return [{ id: item.id, active: item.active, kind: item.kind as "income" | "expense", note: item.note, category: item.category, amountMinor: item.amountMinor, nextDueOn }];
          }),
        });
        await db.user.update({ where: { id }, data: { lastReminderEmailOn: asDate(today) } });
        if (notices.length) {
          const html = `<p>Here is what is due today or tomorrow in SaveYoRupee.</p><ul>${notices.map((notice) => `<li><strong>${escapeHtml(notice.title)}</strong> — ${escapeHtml(notice.body)}</li>`).join("")}</ul>`;
          try { await sendLedgerEmail(me.email, "SaveYoRupee reminders", html); }
          catch (error) { console.warn("Could not send reminder email.", error); }
        }
        return NextResponse.json({ ok: true });
      }
      case "inviteHousehold": {
        const email = z.object({ email: z.string().trim().email().max(120) }).parse(input.payload).email.toLowerCase();
        const me = await db.user.findUniqueOrThrow({ where: { id }, select: { email: true, name: true } });
        if (email === me.email.toLowerCase()) throw new Error("Invite the other person's email.");
        const taken = await db.householdMember.findUnique({ where: { email } });
        if (taken) throw new Error("That email already belongs to a household.");
        const existing = await db.householdMember.findFirst({ where: { userId: id, status: "active" }, include: { household: { include: { members: true } } } });
        let householdId = existing?.householdId;
        if (existing) {
          if (existing.role !== "owner") throw new Error("Only the person who started the household can invite someone.");
          if (existing.household.members.length >= 2) throw new Error("A household ledger is for two people.");
        } else {
          const created = await db.household.create({ data: { name: "Shared ledger", members: { create: { userId: id, email: me.email.toLowerCase(), name: me.name, role: "owner", status: "active" } } } });
          householdId = created.id;
        }
        await db.householdMember.create({ data: { householdId: householdId!, email, name: "", role: "member", status: "invited" } });
        const origin = new URL(request.url).origin;
        try {
          await sendLedgerEmail(email, "Join a SaveYoRupee household", `<p>${escapeHtml(me.name)} invited you to a shared ledger.</p><p><a href="${origin}/profile">Open SaveYoRupee</a> and accept while signed in as ${escapeHtml(email)}.</p>`);
        } catch (error) {
          console.warn("Household invite email failed.", error);
        }
        log(async () => ({ action: "household.invited", area: "household", title: "Invited someone to your household", subject: email }));
        break;
      }
      case "acceptHousehold": {
        const me = await db.user.findUniqueOrThrow({ where: { id }, select: { email: true, name: true } });
        const invite = await db.householdMember.findFirst({ where: { email: me.email.toLowerCase(), status: "invited" } });
        if (!invite) throw new Error("There is no household invite for this email.");
        const already = await db.householdMember.findFirst({ where: { userId: id, status: "active" } });
        if (already) throw new Error("You already belong to a household.");
        await db.householdMember.update({ where: { id: invite.id }, data: { userId: id, status: "active", name: me.name } });
        log(async () => ({ action: "household.joined", area: "household", entityId: invite.householdId, title: "Joined a household" }));
        break;
      }
      case "removeHouseholdMember": {
        const email = z.object({ email: z.string().trim().email() }).parse(input.payload).email.toLowerCase();
        const mine = await db.householdMember.findFirst({ where: { userId: id, status: "active", role: "owner" } });
        if (!mine) throw new Error("Only the person who started the household can remove someone.");
        const removed = await db.householdMember.deleteMany({ where: { householdId: mine.householdId, email, role: "member" } });
        if (!removed.count) throw new Error("That person is not in your household.");
        log(async () => ({ action: "household.member_removed", area: "household", entityId: mine.householdId, title: "Removed someone from your household", subject: email }));
        break;
      }
      case "leaveHousehold": {
        const mine = await db.householdMember.findFirst({ where: { userId: id, status: "active" }, include: { household: { include: { members: true } } } });
        if (!mine) throw new Error("You are not in a household.");
        if (mine.role === "owner") {
          if (mine.household.members.length > 1) throw new Error("Remove the other person before closing the household.");
          await db.household.delete({ where: { id: mine.householdId } });
          log(async () => ({ action: "household.closed", area: "household", entityId: mine.householdId, title: "Closed your household" }));
        } else {
          await db.householdMember.delete({ where: { id: mine.id } });
          log(async () => ({ action: "household.left", area: "household", entityId: mine.householdId, title: "Left a household" }));
        }
        break;
      }
      case "setPaymentAccountShared": {
        if (!recordId) throw new Error("Missing payment account id.");
        const value = z.object({ shared: z.boolean() }).parse(input.payload);
        const before = await db.paymentAccount.findFirst({ where: { id: recordId, userId: id }, select: { type: true, provider: true, label: true, shared: true } });
        const updated = await db.paymentAccount.updateMany({ where: { id: recordId, userId: id }, data: { shared: value.shared } });
        if (!updated.count) throw new Error("That account is not yours to share.");
        if (before && before.shared !== value.shared) log(async () => ({ action: value.shared ? "account.shared" : "account.unshared", area: "household", entityId: recordId, title: value.shared ? "Shared an account with your household" : "Stopped sharing an account", subject: accountLabelOf(before) }));
        break;
      }
      default: return NextResponse.json({ error: "Unknown ledger action." }, { status: 400 });
    }
    const entries = await flushActivity();
    return NextResponse.json({ ...serialize(await loadLedger(id)), activity: entries });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Request failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
