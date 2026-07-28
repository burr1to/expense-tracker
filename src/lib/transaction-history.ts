import { getCategory } from "./categories";
import type { CustomCategory, LedgerTransaction, PaymentMode, TransactionKind } from "../types";

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

export function filterTransactionHistory(transactions: readonly LedgerTransaction[], customCategories: readonly CustomCategory[], filters: TransactionHistoryFilters): LedgerTransaction[] {
  const query = filters.query.trim().toLowerCase();
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
      const category = getCategory(item.category, customCategories).label;
      return `${item.note} ${category} ${item.subcategory ?? ""} ${item.area ?? ""} ${item.paymentAccount?.provider ?? ""}`.toLowerCase().includes(query);
    })
    .sort((a, b) => `${b.occurredOn}${b.createdAt}`.localeCompare(`${a.occurredOn}${a.createdAt}`));
}
