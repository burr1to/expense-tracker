import type { PrismaClient } from "../generated/prisma/client";
import { getCategory } from "./categories";
import { isFiscalYearKey } from "./fiscal-year";
import { buildMonthlyReport, precedingMonthKey, reportMonthBounds, type MonthlyReport, type MonthlyReportTransaction } from "./monthly-report";
import { paymentAccountLabel } from "./payment-accounts";
import { recurrenceLabel } from "./recurrence";
import type { CurrencyCode, PaymentAccountType, RecurrenceUnit } from "../types";

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

function afterBalanceAnchor(occurredOn: string, createdAt: string, balanceAsOf: string, balanceRecordedAt: string) {
  if (occurredOn > balanceAsOf) return true;
  if (occurredOn < balanceAsOf) return false;
  return createdAt > balanceRecordedAt;
}

/**
 * Everything a monthly report needs, read for one user and one period (`2026-08`, `BS:2083-06`
 * or `FY:2082-83`). The PDF download and the MCP tool both use this, so they always agree.
 */
export async function loadMonthlyReport(db: PrismaClient, userId: string, monthKey: string, now = new Date()): Promise<MonthlyReport> {
  const { start, endExclusive } = reportMonthBounds(monthKey);
  const previousBounds = reportMonthBounds(precedingMonthKey(monthKey));
  const [user, monthTransactions, previousTransactions, budgets, categories, accounts, allAccountTransactions, transfers, dues, recurring] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, currency: true } }),
    db.transaction.findMany({ where: { userId: userId, deletedAt: null, occurredOn: { gte: asDate(start), lt: asDate(endExclusive) } }, orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }] }),
    db.transaction.findMany({ where: { userId: userId, deletedAt: null, occurredOn: { gte: asDate(previousBounds.start), lt: asDate(previousBounds.endExclusive) } }, orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }] }),
    // A fiscal year has no budgets of its own; a month's are stored under the same key (bare AD, or BS:).
    isFiscalYearKey(monthKey) ? Promise.resolve([]) : db.budget.findMany({ where: { userId: userId, monthKey } }),
    db.customCategory.findMany({ where: { userId: userId } }),
    db.paymentAccount.findMany({ where: { userId: userId }, orderBy: { createdAt: "asc" } }),
    db.transaction.findMany({ where: { userId: userId, deletedAt: null, paymentAccountId: { not: null } }, orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }] }),
    db.accountTransfer.findMany({ where: { userId: userId }, orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }] }),
    db.dueItem.findMany({ where: { userId: userId }, include: { payments: true } }),
    db.recurringEntry.findMany({ where: { userId: userId, active: true }, orderBy: { nextDueOn: "asc" } }),
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
  const accountLabels = new Map(accounts.map((account) => [account.id, paymentAccountLabel({ type: account.type as PaymentAccountType, provider: account.provider, label: account.label })]));

  return buildMonthlyReport({
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
      scheduleLabel: recurrenceLabel({ recurrenceUnit: item.recurrenceUnit as RecurrenceUnit, recurrenceInterval: item.recurrenceInterval }),
      nextDueOn: dateOnly(item.nextDueOn),
      active: item.active,
    })),
  }, now);

}
