import type { LedgerTransaction, TransactionKind } from "../types";

export interface TransactionSuggestion {
  transaction: LedgerTransaction;
  useCount: number;
}

const normalize = (value: string | null | undefined) => value?.trim().toLocaleLowerCase().replace(/\s+/g, " ") ?? "";

const signatureFor = (transaction: LedgerTransaction) => [
  transaction.kind,
  transaction.category,
  normalize(transaction.subcategory),
  normalize(transaction.area),
  normalize(transaction.locationLabel),
  normalize(transaction.note),
  transaction.paymentMode,
  transaction.paymentAccountId ?? "",
].join("\u001f");

const searchableText = (transaction: LedgerTransaction) => normalize([
  transaction.note,
  transaction.category,
  transaction.subcategory,
  transaction.area,
  transaction.locationLabel,
  transaction.locationAddress,
  transaction.paymentAccount?.provider,
  transaction.paymentAccount?.label,
].filter(Boolean).join(" "));

const chronology = (transaction: LedgerTransaction) => `${transaction.occurredOn}\u001f${transaction.createdAt}`;

export function transactionSuggestionTitle(transaction: LedgerTransaction) {
  const place = transaction.locationLabel?.trim() || transaction.area?.trim();
  const subcategory = transaction.subcategory?.trim();
  if (place) return subcategory ? `${place} (${subcategory})` : place;
  if (subcategory) return `(${subcategory})`;
  return transaction.note.trim();
}

export function getTransactionSuggestions(
  transactions: readonly LedgerTransaction[],
  kind: TransactionKind,
  query = "",
  limit = 5,
): TransactionSuggestion[] {
  if (limit <= 0) return [];
  const normalizedQuery = normalize(query);
  const grouped = new Map<string, TransactionSuggestion>();

  transactions.forEach((transaction) => {
    if (transaction.kind !== kind || (normalizedQuery && !searchableText(transaction).includes(normalizedQuery))) return;
    const signature = signatureFor(transaction);
    const existing = grouped.get(signature);
    if (!existing) {
      grouped.set(signature, { transaction, useCount: 1 });
      return;
    }
    existing.useCount += 1;
    if (chronology(transaction) > chronology(existing.transaction)) existing.transaction = transaction;
  });

  return [...grouped.values()]
    .sort((left, right) => {
      const frequencyDifference = Math.min(right.useCount, 4) - Math.min(left.useCount, 4);
      if (frequencyDifference) return frequencyDifference;
      return chronology(right.transaction).localeCompare(chronology(left.transaction));
    })
    .slice(0, limit);
}
