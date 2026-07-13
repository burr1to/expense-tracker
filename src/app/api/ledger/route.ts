import { addMonths } from "date-fns";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "../../../lib/auth";
import { getPrisma } from "../../../lib/prisma";

export const dynamic = "force-dynamic";

const transactionSchema = z.object({ kind: z.enum(["income", "expense"]), category: z.string().min(1).max(80), amountMinor: z.number().int().positive(), occurredOn: z.string().date(), note: z.string().max(240), tags: z.array(z.string().max(40)).max(8) });
const budgetSchema = z.object({ monthKey: z.string().regex(/^\d{4}-\d{2}$/), category: z.string().min(1).max(80), amountMinor: z.number().int().positive() });
const recurringSchema = z.object({ kind: z.enum(["income", "expense"]), category: z.string().min(1).max(80), amountMinor: z.number().int().positive(), note: z.string().max(240), tags: z.array(z.string().max(40)).max(8), dayOfMonth: z.number().int().min(1).max(28), nextDueOn: z.string().date() });
const goalSchema = z.object({ name: z.string().trim().min(1).max(80), targetMinor: z.number().int().positive(), savedMinor: z.number().int().min(0), targetDate: z.string().date().nullable() });
const categorySchema = z.object({ name: z.string().trim().min(1).max(30), kind: z.enum(["income", "expense", "both"]), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) });
const profileSchema = z.object({ displayName: z.string().trim().min(1).max(50), currency: z.enum(["NPR", "USD", "AUD"]), theme: z.enum(["light", "dark", "system"]), hideAmounts: z.boolean(), autoLockMinutes: z.number().int().min(0).max(120) });
const requestSchema = z.object({ action: z.string(), id: z.string().optional(), payload: z.unknown().optional() });

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateOnly = (value: Date | null) => value ? value.toISOString().slice(0, 10) : null;

async function userId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

function serialize(data: Awaited<ReturnType<typeof loadLedger>>) {
  return {
    profile: { id: data.user.id, displayName: data.user.name, currency: data.user.currency, theme: data.user.theme, hideAmounts: data.user.hideAmounts, autoLockMinutes: data.user.autoLockMinutes },
    transactions: data.transactions.map((item) => ({ ...item, occurredOn: dateOnly(item.occurredOn), createdAt: item.createdAt.toISOString() })),
    budgets: data.budgets,
    recurringEntries: data.recurring.map((item) => ({ ...item, nextDueOn: dateOnly(item.nextDueOn) })),
    goals: data.goals.map((item) => ({ ...item, targetDate: dateOnly(item.targetDate) })),
    customCategories: data.categories.map((item) => ({ ...item, label: item.name, custom: true })),
  };
}

async function loadLedger(id: string) {
  const db = getPrisma();
  const [user, transactions, budgets, recurring, goals, categories] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, currency: true, theme: true, hideAmounts: true, autoLockMinutes: true } }),
    db.transaction.findMany({ where: { userId: id }, orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }] }),
    db.budget.findMany({ where: { userId: id }, orderBy: { monthKey: "desc" } }),
    db.recurringEntry.findMany({ where: { userId: id }, orderBy: { nextDueOn: "asc" } }),
    db.savingsGoal.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" } }),
    db.customCategory.findMany({ where: { userId: id }, orderBy: { name: "asc" } }),
  ]);
  return { user, transactions, budgets, recurring, goals, categories };
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
        const value = transactionSchema.parse(input.payload);
        const data = { ...value, occurredOn: asDate(value.occurredOn) };
        if (recordId) await db.transaction.updateMany({ where: { id: recordId, userId: id }, data });
        else await db.transaction.create({ data: { ...data, userId: id } });
        break;
      }
      case "importTransactions": {
        const values = z.array(transactionSchema).max(1000).parse(input.payload);
        await db.transaction.createMany({ data: values.map((value) => ({ ...value, occurredOn: asDate(value.occurredOn), userId: id })) });
        break;
      }
      case "deleteTransaction": await db.transaction.deleteMany({ where: { id: recordId, userId: id } }); break;
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
          db.transaction.create({ data: { userId: id, kind: recurring.kind, category: recurring.category, amountMinor: recurring.amountMinor, occurredOn: recurring.nextDueOn, note: recurring.note, tags: recurring.tags } }),
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
      case "updateProfile": {
        const value = profileSchema.parse(input.payload);
        await db.user.update({ where: { id }, data: { name: value.displayName, currency: value.currency, theme: value.theme, hideAmounts: value.hideAmounts, autoLockMinutes: value.autoLockMinutes } });
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
