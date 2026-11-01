import { getCategory } from "./categories";
import { entryMatches, transactionSearchParts } from "./ledger-search";
import { paymentAccountLabel } from "./payment-accounts";
import type { AccountTransfer, CustomCategory, LedgerTransaction, PaymentAccount, PaymentMode, TransactionKind } from "../types";

export type TransactionHistoryScope = "history" | "day";

export interface TransactionHistoryFilters {
  scope: TransactionHistoryScope;
  selectedDayKey: string;
  kind: TransactionKind | "all";
  category: string;
  from: string;
  to: string;
  minMinor: number | null;
  maxMinor: number | null;
  paymentMode: PaymentMode | "all";
  query: string;
}

export function filterTransactionHistory(transactions: readonly LedgerTransaction[], customCategories: readonly CustomCategory[], filters: TransactionHistoryFilters, accounts: readonly PaymentAccount[] = []): LedgerTransaction[] {
  const query = filters.query.trim();
  return [...transactions]
    .filter((item) => filters.scope === "history" || item.occurredOn === filters.selectedDayKey)
    .filter((item) => filters.kind === "all" || item.kind === filters.kind)
    .filter((item) => filters.category === "all" || item.category === filters.category)
    .filter((item) => !filters.from || item.occurredOn >= filters.from)
    .filter((item) => !filters.to || item.occurredOn <= filters.to)
    .filter((item) => filters.minMinor === null || item.amountMinor >= filters.minMinor)
    .filter((item) => filters.maxMinor === null || item.amountMinor <= filters.maxMinor)
    .filter((item) => filters.paymentMode === "all" || item.paymentMode === filters.paymentMode)
    .filter((item) => {
      if (!query) return true;
      return entryMatches(query, transactionSearchParts(item, getCategory(item.category, customCategories).label, accounts), item.amountMinor);
    })
    .sort((a, b) => `${b.occurredOn}${b.createdAt}`.localeCompare(`${a.occurredOn}${a.createdAt}`));
}

export type LedgerActivityItem =
  | { type: "transaction"; transaction: LedgerTransaction }
  | { type: "transfer"; transfer: AccountTransfer };

export interface LedgerActivityFilters extends Omit<TransactionHistoryFilters, "kind"> {
  kind: TransactionKind | "transfer" | "all";
  accountId?: string;
}

export function transferAccountLabel(accounts: readonly PaymentAccount[], accountId: string) {
  const account = accounts.find((item) => item.id === accountId);
  return account ? paymentAccountLabel(account) : "Removed account";
}

function activitySortKey(occurredOn: string, createdAt: string) {
  return `${occurredOn}${createdAt}`;
}

export function listLedgerActivity(
  transactions: readonly LedgerTransaction[],
  transfers: readonly AccountTransfer[],
  accounts: readonly PaymentAccount[],
  customCategories: readonly CustomCategory[],
  filters: LedgerActivityFilters,
): LedgerActivityItem[] {
  const { accountId, ...historyFilters } = filters;
  const visibleTransactions = filters.kind === "transfer"
    ? []
    : filterTransactionHistory(transactions, customCategories, { ...historyFilters, kind: filters.kind }, accounts).filter((item) => !accountId || item.paymentAccountId === accountId);
  const query = filters.query.trim();
  const transfersVisible = filters.kind === "transfer" || (filters.kind === "all" && filters.category === "all" && (filters.paymentMode === "all" || filters.paymentMode === "online"));
  const visibleTransfers = transfersVisible ? transfers.filter((item) => {
    if (accountId && item.fromAccountId !== accountId && item.toAccountId !== accountId) return false;
    if (filters.scope === "day" && item.occurredOn !== filters.selectedDayKey) return false;
    if (filters.from && item.occurredOn < filters.from) return false;
    if (filters.to && item.occurredOn > filters.to) return false;
    if (filters.minMinor !== null && item.amountMinor < filters.minMinor) return false;
    if (filters.maxMinor !== null && item.amountMinor > filters.maxMinor) return false;
    if (!query) return true;
    return entryMatches(query, [transferAccountLabel(accounts, item.fromAccountId), transferAccountLabel(accounts, item.toAccountId), item.note, "transfer"], item.amountMinor);
  }) : [];
  return [
    ...visibleTransactions.map((transaction): LedgerActivityItem => ({ type: "transaction", transaction })),
    ...visibleTransfers.map((transfer): LedgerActivityItem => ({ type: "transfer", transfer })),
  ].sort((a, b) => {
    const left = a.type === "transaction" ? a.transaction : a.transfer;
    const right = b.type === "transaction" ? b.transaction : b.transfer;
    return activitySortKey(right.occurredOn, right.createdAt).localeCompare(activitySortKey(left.occurredOn, left.createdAt));
  });
}
