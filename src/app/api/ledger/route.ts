import { addMonths } from "date-fns";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getBetaSession } from "../../../lib/auth";
import { getPrisma } from "../../../lib/prisma";
import { hashPin, verifyPin } from "../../../lib/pin";
import { NEPAL_MOBILE_BANKS } from "../../../lib/payment-accounts";
import { removeStoredReceipts, verifyStoredReceipt } from "../../../lib/receipt-storage";

export const dynamic = "force-dynamic";

const transactionSchema = z.object({
  kind: z.enum(["income", "expense"]), category: z.string().min(1).max(80), amountMinor: z.number().int().positive(),
  occurredOn: z.string().date(), note: z.string().max(240), subcategory: z.string().trim().max(80).nullable(),
  area: z.string().trim().max(120).nullable(), paymentMode: z.enum(["cash", "cheque", "online"]), paymentAccountId: z.string().nullable(),
}).superRefine((value, context) => {
  if (value.paymentMode === "online" && !value.paymentAccountId) context.addIssue({ code: "custom", path: ["paymentAccountId"], message: "Choose an online payment account." });
  if (value.paymentMode !== "online" && value.paymentAccountId) context.addIssue({ code: "custom", path: ["paymentAccountId"], message: "Payment accounts can only be used with online payments." });
});
const receiptSchema = z.object({ name: z.string().trim().min(1).max(120), mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]), size: z.number().int().positive().max(3 * 1024 * 1024), storagePath: z.string().min(1).max(300) });
const savedTransactionSchema = transactionSchema.extend({ receipt: receiptSchema.optional(), removeReceipt: z.boolean().optional() });
const budgetSchema = z.object({ monthKey: z.string().regex(/^\d{4}-\d{2}$/), category: z.string().min(1).max(80), amountMinor: z.number().int().positive() });
const recurringSchema = z.object({ kind: z.enum(["income", "expense"]), category: z.string().min(1).max(80), amountMinor: z.number().int().positive(), note: z.string().max(240), tags: z.array(z.string().max(40)).max(8), dayOfMonth: z.number().int().min(1).max(28), nextDueOn: z.string().date() });
const goalSchema = z.object({ name: z.string().trim().min(1).max(80), targetMinor: z.number().int().positive(), savedMinor: z.number().int().min(0), targetDate: z.string().date().nullable() });
const categorySchema = z.object({ name: z.string().trim().min(1).max(30), kind: z.enum(["income", "expense", "both"]), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) });
const paymentAccountSchema = z.object({ type: z.enum(["mobile_banking", "esewa", "khalti", "connect_ips"]), provider: z.string().trim().min(1).max(100), label: z.string().trim().max(60) });
const profileSchema = z.object({ displayName: z.string().trim().min(1).max(50), currency: z.enum(["NPR", "USD", "AUD"]), theme: z.enum(["light", "dark", "system"]), hideAmounts: z.boolean(), autoLockMinutes: z.number().int().min(0).max(120) });
const dueSchema = z.object({ kind: z.enum(["payment", "receivable", "lent", "borrowed"]), title: z.string().trim().min(1).max(100), person: z.string().trim().max(80), amountMinor: z.number().int().positive(), category: z.string().min(1).max(80), occurredOn: z.string().date().nullable(), dueOn: z.string().date(), remindOn: z.string().date().nullable(), note: z.string().trim().max(300), receipt: receiptSchema.optional() });
const duePaymentSchema = z.object({ amountMinor: z.number().int().positive(), occurredOn: z.string().date(), note: z.string().trim().max(240), addToLedger: z.boolean() });
const pinSchema = z.string().regex(/^\d{4,6}$/, "PIN must contain 4 to 6 digits.");
const requestSchema = z.object({ action: z.string(), id: z.string().optional(), payload: z.unknown().optional() });

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateOnly = (value: Date | null) => value ? value.toISOString().slice(0, 10) : null;
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
  return {
    profile: { id: data.user.id, displayName: data.user.name, currency: data.user.currency, theme: data.user.theme, hideAmounts: data.user.hideAmounts, autoLockMinutes: data.user.autoLockMinutes, hasPin: Boolean(data.user.pinHash) },
    transactions: data.transactions.map((item) => ({ ...item, occurredOn: dateOnly(item.occurredOn), createdAt: item.createdAt.toISOString(), paymentAccount: item.paymentAccount ? { ...item.paymentAccount, createdAt: item.paymentAccount.createdAt.toISOString() } : null })),
    budgets: data.budgets,
    recurringEntries: data.recurring.map((item) => ({ ...item, nextDueOn: dateOnly(item.nextDueOn) })),
    goals: data.goals.map((item) => ({ ...item, targetDate: dateOnly(item.targetDate) })),
    customCategories: data.categories.map((item) => ({ ...item, label: item.name, custom: true })),
    paymentAccounts: data.paymentAccounts.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    dueItems: data.dueItems.map((item) => ({ ...item, occurredOn: dateOnly(item.occurredOn), dueOn: dateOnly(item.dueOn), remindOn: dateOnly(item.remindOn), completedOn: dateOnly(item.completedOn), createdAt: item.createdAt.toISOString(), payments: item.payments.map((payment) => ({ ...payment, occurredOn: dateOnly(payment.occurredOn), createdAt: payment.createdAt.toISOString() })) })),
  };
}

async function loadLedger(id: string) {
  const db = getPrisma();
  const [user, transactions, budgets, recurring, goals, categories, paymentAccounts, dueItems] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, currency: true, theme: true, hideAmounts: true, autoLockMinutes: true, pinHash: true } }),
    db.transaction.findMany({ where: { userId: id }, orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }], include: { receipt: { select: receiptSelect }, paymentAccount: true } }),
    db.budget.findMany({ where: { userId: id }, orderBy: { monthKey: "desc" } }),
    db.recurringEntry.findMany({ where: { userId: id }, orderBy: { nextDueOn: "asc" } }),
    db.savingsGoal.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" } }),
    db.customCategory.findMany({ where: { userId: id }, orderBy: { name: "asc" } }),
    db.paymentAccount.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" } }),
    db.dueItem.findMany({ where: { userId: id }, orderBy: [{ status: "asc" }, { dueOn: "asc" }], include: { payments: { orderBy: { occurredOn: "desc" } }, receipt: { select: receiptSelect } } }),
  ]);
  return { user, transactions, budgets, recurring, goals, categories, paymentAccounts, dueItems };
}

export async function GET() {
  const id = await userId();
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    switch (input.action) {
      case "saveTransaction": {
        const value = savedTransactionSchema.parse(input.payload);
        const { receipt, removeReceipt, ...entry } = value;
        if (entry.paymentAccountId) await db.paymentAccount.findFirstOrThrow({ where: { id: entry.paymentAccountId, userId: id } });
        const data = { ...entry, occurredOn: asDate(entry.occurredOn) };
        let transactionId = recordId;
        if (recordId) {
          const existing = await db.transaction.findFirstOrThrow({ where: { id: recordId, userId: id } });
          await db.transaction.update({ where: { id: existing.id }, data });
        } else transactionId = (await db.transaction.create({ data: { ...data, userId: id } })).id;
        if (!transactionId) throw new Error("Could not identify the saved transaction.");
        const oldReceipt = removeReceipt || receipt ? await db.receiptAttachment.findFirst({ where: { transactionId, userId: id }, select: { storagePath: true } }) : null;
        if (removeReceipt && !receipt) await db.receiptAttachment.deleteMany({ where: { transactionId, userId: id } });
        if (receipt) {
          const stored = await receiptData(receipt, id);
          await db.receiptAttachment.upsert({ where: { transactionId }, update: stored, create: { ...stored, userId: id, transactionId } });
        }
        if (oldReceipt?.storagePath && oldReceipt.storagePath !== receipt?.storagePath) await removeStoredReceipts([oldReceipt.storagePath]);
        break;
      }
      case "importTransactions": {
        const values = z.array(transactionSchema).max(1000).parse(input.payload);
        const accountIds = [...new Set(values.flatMap((value) => value.paymentAccountId ? [value.paymentAccountId] : []))];
        if (accountIds.length) {
          const ownedAccounts = await db.paymentAccount.count({ where: { userId: id, id: { in: accountIds } } });
          if (ownedAccounts !== accountIds.length) throw new Error("One or more online payment accounts are invalid.");
        }
        await db.transaction.createMany({ data: values.map((value) => ({ ...value, occurredOn: asDate(value.occurredOn), userId: id })) });
        break;
      }
      case "deleteTransaction": {
        if (!recordId) throw new Error("Missing transaction id.");
        const receipt = await db.receiptAttachment.findFirst({ where: { transactionId: recordId, userId: id }, select: { storagePath: true } });
        await db.transaction.deleteMany({ where: { id: recordId, userId: id } });
        await removeStoredReceipts([receipt?.storagePath]);
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
        const data = { ...value, nextDueOn: asDate(value.nextDueOn) };
        if (recordId) await db.recurringEntry.updateMany({ where: { id: recordId, userId: id }, data });
        else await db.recurringEntry.create({ data: { ...data, userId: id } });
        break;
      }
      case "deleteRecurring": await db.recurringEntry.deleteMany({ where: { id: recordId, userId: id } }); break;
      case "confirmRecurring": {
        if (!recordId) throw new Error("Missing recurring entry id.");
        const recurring = await db.recurringEntry.findFirstOrThrow({ where: { id: recordId, userId: id } });
        await db.$transaction([
          db.transaction.create({ data: { userId: id, kind: recurring.kind, category: recurring.category, amountMinor: recurring.amountMinor, occurredOn: recurring.nextDueOn, note: recurring.note, paymentMode: "cash" } }),
          db.recurringEntry.update({ where: { id: recurring.id }, data: { nextDueOn: addMonths(recurring.nextDueOn, 1) } }),
        ]);
        break;
      }
      case "saveGoal": {
        const value = goalSchema.parse(input.payload);
        const data = { ...value, savedMinor: Math.min(value.savedMinor, value.targetMinor), targetDate: value.targetDate ? asDate(value.targetDate) : null };
        if (recordId) await db.savingsGoal.updateMany({ where: { id: recordId, userId: id }, data });
        else await db.savingsGoal.create({ data: { ...data, userId: id } });
        break;
      }
      case "contributeToGoal": {
        if (!recordId) throw new Error("Missing goal id.");
        const amountMinor = z.object({ amountMinor: z.number().int().positive() }).parse(input.payload).amountMinor;
        const goal = await db.savingsGoal.findFirstOrThrow({ where: { id: recordId, userId: id } });
        await db.savingsGoal.update({ where: { id: goal.id }, data: { savedMinor: Math.min(goal.targetMinor, goal.savedMinor + amountMinor) } });
        break;
      }
      case "deleteGoal": await db.savingsGoal.deleteMany({ where: { id: recordId, userId: id } }); break;
      case "saveCustomCategory": await db.customCategory.create({ data: { ...categorySchema.parse(input.payload), userId: id } }); break;
      case "deleteCustomCategory": {
        if (!recordId) throw new Error("Missing category id.");
        const category = await db.customCategory.findFirstOrThrow({ where: { id: recordId, userId: id } });
        const [transactions, budgets] = await Promise.all([db.transaction.count({ where: { userId: id, category: category.id } }), db.budget.count({ where: { userId: id, category: category.id } })]);
        if (transactions || budgets) return NextResponse.json({ error: "This category is in use. Reassign its entries before deleting it." }, { status: 409 });
        await db.customCategory.delete({ where: { id: category.id } });
        break;
      }
      case "savePaymentAccount": {
        const value = paymentAccountSchema.parse(input.payload);
        if (value.type !== "mobile_banking" && value.provider !== value.type) throw new Error("The payment provider does not match the account type.");
        if (value.type === "mobile_banking" && !NEPAL_MOBILE_BANKS.includes(value.provider as typeof NEPAL_MOBILE_BANKS[number])) throw new Error("Choose a bank from the supported Nepal bank list.");
        await db.paymentAccount.create({ data: { ...value, userId: id } });
        break;
      }
      case "deletePaymentAccount": await db.paymentAccount.deleteMany({ where: { id: recordId, userId: id } }); break;
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
        await db.user.update({ where: { id }, data: { name: value.displayName, currency: value.currency, theme: value.theme, hideAmounts: value.hideAmounts, autoLockMinutes: pin.pinHash ? value.autoLockMinutes : 0 } });
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
