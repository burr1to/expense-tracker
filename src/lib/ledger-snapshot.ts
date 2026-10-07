import { attachCurrentBalances } from "./account-balances";
import { getPrisma } from "./prisma";
import { removeStoredReceipts } from "./receipt-storage";
import type { AccountReconciliation, AccountTransfer, HouseholdSummary, LearningSuggestion, LedgerTransaction, PaymentAccount, RecurrenceUnit } from "../types";

export const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
export const dateOnly = (value: Date | null) => value ? value.toISOString().slice(0, 10) : null;

const DELETED_TRANSACTION_RETENTION_MS = 24 * 60 * 60 * 1000;
const receiptSelect = { id: true, name: true, mimeType: true, size: true } as const;

function toHouseholdSummary(
  active: { role: string; household: { id: string; name: string; members: { email: string; name: string; role: string; status: string }[] } } | null,
  invited: { household: { id: string; name: string; members: { name: string; role: string }[] } } | null,
): HouseholdSummary | null {
  if (active) {
    return {
      id: active.household.id,
      name: active.household.name,
      role: active.role === "owner" ? "owner" : "member",
      status: "active",
      invitedBy: null,
      members: active.household.members.map((member) => ({
        email: member.email,
        name: member.name,
        role: member.role === "owner" ? "owner" : "member",
        status: member.status === "invited" ? "invited" : "active",
      })),
    };
  }
  if (!invited) return null;
  const owner = invited.household.members.find((member) => member.role === "owner");
  return { id: invited.household.id, name: invited.household.name, role: "member", status: "invited", invitedBy: owner?.name || "Someone", members: [] };
}

export async function loadLedger(id: string) {
  const db = getPrisma();
  const user = await db.user.findUniqueOrThrow({
    where: { id },
    select: {
      id: true, name: true, email: true, currency: true, hideAmounts: true, autoLockMinutes: true, calendarSystem: true,
      safeToSpendBufferMinor: true, emailReminders: true, browserReminders: true, pinHash: true, learningProfile: true,
      householdMembership: { include: { household: { include: { members: true } } } },
    },
  });
  const activeMembership = user.householdMembership?.status === "active" ? user.householdMembership : null;
  const invitedMembership = activeMembership ? null : await db.householdMember.findFirst({
    where: { email: user.email.toLowerCase(), status: "invited" },
    include: { household: { include: { members: true } } },
  });
  const peerIds = activeMembership?.household.members.flatMap((member) => member.status === "active" && member.userId && member.userId !== id ? [member.userId] : []) ?? [];
  const transactionWhere = peerIds.length
    ? { deletedAt: null, OR: [{ userId: id }, { shared: true, userId: { in: peerIds } }] }
    : { userId: id, deletedAt: null };
  const sharedRowWhere = peerIds.length
    ? { OR: [{ userId: id }, { shared: true, userId: { in: peerIds } }] }
    : { userId: id };
  const transferWhere = peerIds.length
    ? { OR: [{ userId: id }, { fromAccount: { shared: true, userId: { in: peerIds } } }, { toAccount: { shared: true, userId: { in: peerIds } } }] }
    : { userId: id };
  const [transactions, budgets, recurring, goals, categories, subcategories, paymentAccounts, reconciliations, savedPlaces, transfers, dueItems] = await Promise.all([
    db.transaction.findMany({ where: transactionWhere, orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }], include: { receipt: { select: receiptSelect }, receiptScan: { select: receiptSelect } } }),
    db.budget.findMany({ where: sharedRowWhere, orderBy: { monthKey: "desc" } }),
    db.recurringEntry.findMany({ where: { userId: id }, orderBy: { nextDueOn: "asc" } }),
    db.savingsGoal.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" }, include: { contributions: { orderBy: { createdAt: "desc" } } } }),
    db.customCategory.findMany({ where: { userId: id }, orderBy: { name: "asc" } }),
    db.customSubcategory.findMany({ where: { userId: id }, orderBy: [{ categoryId: "asc" }, { name: "asc" }] }),
    db.paymentAccount.findMany({ where: sharedRowWhere, orderBy: { createdAt: "asc" } }),
    db.accountReconciliation.findMany({ where: { userId: id }, orderBy: [{ checkedOn: "desc" }, { approvedAt: "desc" }] }),
    db.savedPlace.findMany({ where: { userId: id }, orderBy: { lastUsedAt: "desc" } }),
    db.accountTransfer.findMany({ where: transferWhere, orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }] }),
    db.dueItem.findMany({ where: { userId: id }, orderBy: [{ status: "asc" }, { dueOn: "asc" }], include: { payments: { orderBy: { occurredOn: "desc" } }, receipt: { select: receiptSelect } } }),
  ]);
  return { user, household: toHouseholdSummary(activeMembership, invitedMembership), transactions, budgets, recurring, goals, categories, subcategories, paymentAccounts, reconciliations, savedPlaces, transfers, dueItems };
}

export function serialize(data: Awaited<ReturnType<typeof loadLedger>>) {
  const transactions: LedgerTransaction[] = data.transactions.map((item) => {
    const { deletedAt, receiptScan, importJobId, ...transaction } = item;
    void deletedAt;
    void importJobId;
    return { ...transaction, receipt: transaction.receipt ?? receiptScan, kind: item.kind as LedgerTransaction["kind"], paymentMode: item.paymentMode as LedgerTransaction["paymentMode"], locationSource: item.locationSource as LedgerTransaction["locationSource"], occurredOn: dateOnly(item.occurredOn)!, createdAt: item.createdAt.toISOString(), paymentAccount: null };
  });
  const transfers: AccountTransfer[] = data.transfers.map((item) => ({ ...item, occurredOn: dateOnly(item.occurredOn)!, createdAt: item.createdAt.toISOString() }));
  const paymentAccounts: PaymentAccount[] = attachCurrentBalances(data.paymentAccounts.map((item) => ({
    id: item.id, importId: item.importId, userId: item.userId, type: item.type as PaymentAccount["type"], provider: item.provider, label: item.label, accountTail: item.accountTail ?? null, shared: item.shared, balanceMinor: item.balanceMinor, balanceAsOf: dateOnly(item.balanceAsOf)!, balanceRecordedAt: item.balanceRecordedAt.toISOString(), currentBalanceMinor: 0, createdAt: item.createdAt.toISOString(),
  })), transactions, transfers);
  const accountById = new Map(paymentAccounts.map((item) => [item.id, item]));
  for (const transaction of transactions) if (transaction.paymentAccountId) transaction.paymentAccount = accountById.get(transaction.paymentAccountId) ?? null;
  return {
    profile: {
      id: data.user.id,
      displayName: data.user.name,
      currency: data.user.currency,
      hideAmounts: data.user.hideAmounts,
      autoLockMinutes: data.user.autoLockMinutes,
      calendarSystem: data.user.calendarSystem as "AD" | "BS",
      safeToSpendBufferMinor: data.user.safeToSpendBufferMinor,
      emailReminders: data.user.emailReminders,
      browserReminders: data.user.browserReminders,
      household: data.household,
      hasPin: Boolean(data.user.pinHash),
      learning: {
        enabled: data.user.learningProfile?.enabled ?? false,
        suggestions: (data.user.learningProfile?.suggestions ?? []) as unknown as LearningSuggestion[],
        summary: data.user.learningProfile?.summary ?? [],
        lastTransactionId: data.user.learningProfile?.lastTransactionId ?? null,
        lastRunAt: data.user.learningProfile?.lastRunAt?.toISOString() ?? null,
      },
    },
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

export async function purgeExpiredDeletedTransactions(id: string) {
  const db = getPrisma();
  const expired = await db.transaction.findMany({
    where: { userId: id, deletedAt: { lt: new Date(Date.now() - DELETED_TRANSACTION_RETENTION_MS) } },
    select: { id: true, receiptScanId: true, receipt: { select: { storagePath: true } } },
  });
  if (!expired.length) return;

  await db.transaction.deleteMany({ where: { userId: id, id: { in: expired.map((item) => item.id) } } });
  const paths = expired.flatMap((item) => item.receipt?.storagePath ? [item.receipt.storagePath] : []);
  const scanIds = [...new Set(expired.flatMap((item) => item.receiptScanId ? [item.receiptScanId] : []))];
  if (scanIds.length) {
    const stillUsed = await db.transaction.findMany({ where: { receiptScanId: { in: scanIds } }, select: { receiptScanId: true }, distinct: ["receiptScanId"] });
    const used = new Set(stillUsed.map((item) => item.receiptScanId));
    const unused = scanIds.filter((scanId) => !used.has(scanId));
    if (unused.length) {
      const scans = await db.receiptScan.findMany({ where: { id: { in: unused }, userId: id }, select: { storagePath: true } });
      await db.receiptScan.deleteMany({ where: { id: { in: unused }, userId: id } });
      for (const scan of scans) if (scan.storagePath) paths.push(scan.storagePath);
    }
  }
  await removeStoredReceipts(paths);
}
