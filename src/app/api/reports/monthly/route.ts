import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getBetaSession } from "../../../../lib/auth";
import { getCategory } from "../../../../lib/categories";
import {
  buildMonthlyReport,
  isCompletedReportMonth,
  precedingMonthKey,
  reportMonthBounds,
  type MonthlyReportTransaction,
} from "../../../../lib/monthly-report";
import { generateMonthlyReportPdf } from "../../../../lib/monthly-report-pdf";
import { getPrisma } from "../../../../lib/prisma";
import type { CurrencyCode } from "../../../../types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

function afterBalanceAnchor(occurredOn: string, createdAt: string, balanceAsOf: string, balanceRecordedAt: string) {
  if (occurredOn > balanceAsOf) return true;
  if (occurredOn < balanceAsOf) return false;
  return createdAt > balanceRecordedAt;
}

export async function GET(request: Request) {
  const session = await getBetaSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const monthKey = new URL(request.url).searchParams.get("month") ?? "";
  if (!isCompletedReportMonth(monthKey)) {
    return NextResponse.json({ error: "Choose a completed month in YYYY-MM format." }, { status: 400 });
  }

  const { start, endExclusive } = reportMonthBounds(monthKey);
  const previousBounds = reportMonthBounds(precedingMonthKey(monthKey));
  const db = getPrisma();
  const [user, monthTransactions, previousTransactions, budgets, categories, accounts, allAccountTransactions, transfers, dues, recurring] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { name: true, currency: true } }),
    db.transaction.findMany({ where: { userId: session.user.id, occurredOn: { gte: asDate(start), lt: asDate(endExclusive) } }, orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }] }),
    db.transaction.findMany({ where: { userId: session.user.id, occurredOn: { gte: asDate(previousBounds.start), lt: asDate(previousBounds.endExclusive) } }, orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }] }),
    db.budget.findMany({ where: { userId: session.user.id, monthKey } }),
    db.customCategory.findMany({ where: { userId: session.user.id } }),
    db.paymentAccount.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "asc" } }),
    db.transaction.findMany({ where: { userId: session.user.id, paymentAccountId: { not: null } }, orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }] }),
    db.accountTransfer.findMany({ where: { userId: session.user.id }, orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }] }),
    db.dueItem.findMany({ where: { userId: session.user.id }, include: { payments: true } }),
    db.recurringEntry.findMany({ where: { userId: session.user.id, active: true }, orderBy: { dayOfMonth: "asc" } }),
  ]);

  const customLabels = new Map(categories.map((item) => [item.id, item.name]));
  const categoryLabel = (category: string) => customLabels.get(category) ?? getCategory(category).label;
  const serializeTransaction = (item: (typeof monthTransactions)[number]): MonthlyReportTransaction => ({
    id: item.id,
    kind: item.kind as MonthlyReportTransaction["kind"],
    category: item.category,
    categoryLabel: categoryLabel(item.category),
    amountMinor: item.amountMinor,
    occurredOn: dateOnly(item.occurredOn),
    note: item.note,
    subcategory: item.subcategory,
    paymentMode: item.paymentMode,
    paymentAccountId: item.paymentAccountId,
  });
  const monthTransfers = transfers.filter((item) => {
    const occurredOn = dateOnly(item.occurredOn);
    return occurredOn >= start && occurredOn < endExclusive;
  });
  const accountLabels = new Map(accounts.map((account) => [account.id, account.label || account.provider]));

  const report = buildMonthlyReport({
    monthKey,
    displayName: user.name,
    currency: user.currency as CurrencyCode,
    transactions: monthTransactions.map(serializeTransaction),
    previousTransactions: previousTransactions.map(serializeTransaction),
    budgets: budgets.map((item) => ({ category: item.category, categoryLabel: categoryLabel(item.category), amountMinor: item.amountMinor })),
    accounts: accounts.map((account) => {
      const balanceAsOf = dateOnly(account.balanceAsOf);
      const balanceRecordedAt = account.balanceRecordedAt.toISOString();
      const transactionDelta = allAccountTransactions
        .filter((item) => item.paymentAccountId === account.id && afterBalanceAnchor(dateOnly(item.occurredOn), item.createdAt.toISOString(), balanceAsOf, balanceRecordedAt))
        .reduce((sum, item) => sum + (item.kind === "income" ? item.amountMinor : -item.amountMinor), 0);
      const transferDelta = transfers
        .filter((item) => (item.fromAccountId === account.id || item.toAccountId === account.id) && afterBalanceAnchor(dateOnly(item.occurredOn), item.createdAt.toISOString(), balanceAsOf, balanceRecordedAt))
        .reduce((sum, item) => sum + (item.toAccountId === account.id ? item.amountMinor : -item.amountMinor), 0);
      return { id: account.id, label: accountLabels.get(account.id)!, balanceMinor: account.balanceMinor + transactionDelta + transferDelta, balanceAsOf };
    }),
    transfers: monthTransfers.map((item) => ({
      id: item.id,
      fromAccountId: item.fromAccountId,
      toAccountId: item.toAccountId,
      amountMinor: item.amountMinor,
      occurredOn: dateOnly(item.occurredOn),
      note: item.note,
    })),
    dues: dues
      .filter((item) => {
        const dueOn = dateOnly(item.dueOn);
        const completedOn = item.completedOn ? dateOnly(item.completedOn) : null;
        return (dueOn >= start && dueOn < endExclusive) || Boolean(completedOn && completedOn >= start && completedOn < endExclusive);
      })
      .map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        amountMinor: item.amountMinor,
        dueOn: dateOnly(item.dueOn),
        status: item.status,
        completedOn: item.completedOn ? dateOnly(item.completedOn) : null,
        paidMinor: item.payments.reduce((sum, payment) => sum + payment.amountMinor, 0),
      })),
    recurring: recurring.map((item) => ({
      id: item.id,
      kind: item.kind as "income" | "expense",
      categoryLabel: categoryLabel(item.category),
      amountMinor: item.amountMinor,
      note: item.note,
      dayOfMonth: item.dayOfMonth,
      active: item.active,
    })),
  });

  const pdf = generateMonthlyReportPdf(report);
  const fileName = `SaveYoRupee-${monthKey}-monthly-report.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
