import { majorToMinor } from "./currency";
import { newClientRequestId } from "./transaction-defaults";
import type { LedgerTransaction, PaymentMode, TransactionCategory, TransactionDraft, TransactionKind } from "../types";

/** One line of the Add multiple page. Category stays empty until it is chosen or remembered from an earlier entry. */
export interface BatchRow {
  id: string;
  kind: TransactionKind;
  note: string;
  amount: string;
  category: TransactionCategory | "";
  occurredOn: string;
  paymentMode: PaymentMode;
  paymentAccountId: string;
  /** Set once the person picks the category, so a later note edit never overwrites their choice. */
  categoryChosen: boolean;
}

export interface BatchDefaults {
  kind: TransactionKind;
  occurredOn: string;
  paymentMode: PaymentMode;
  paymentAccountId: string;
}

export function newBatchRow(defaults: BatchDefaults, overrides: Partial<BatchRow> = {}): BatchRow {
  return {
    id: newClientRequestId(),
    kind: defaults.kind,
    note: "",
    amount: "",
    category: "",
    occurredOn: defaults.occurredOn,
    paymentMode: defaults.paymentMode,
    paymentAccountId: defaults.paymentAccountId,
    categoryChosen: false,
    ...overrides,
  };
}

const parsedAmount = (amount: string) => Number(amount.replace(/,/g, ""));

export function rowAmountValid(row: Pick<BatchRow, "amount">) {
  const value = parsedAmount(row.amount);
  return Number.isFinite(value) && value > 0;
}

export type RowIssue = "amount" | "category" | "account";

/** What still blocks this row from saving; empty when it is ready. */
export function rowIssues(row: BatchRow): RowIssue[] {
  const issues: RowIssue[] = [];
  if (!rowAmountValid(row)) issues.push("amount");
  if (!row.category) issues.push("category");
  if (row.paymentMode === "online" && !row.paymentAccountId) issues.push("account");
  return issues;
}

export function batchSummary(rows: readonly BatchRow[]) {
  let outMinor = 0;
  let inMinor = 0;
  let blocked = 0;
  for (const row of rows) {
    if (rowIssues(row).length) blocked += 1;
    if (!rowAmountValid(row)) continue;
    const minor = majorToMinor(row.amount.replace(/,/g, ""));
    if (row.kind === "income") inMinor += minor; else outMinor += minor;
  }
  return { count: rows.length, blocked, outMinor, inMinor, ready: rows.length > 0 && blocked === 0 };
}

const normalizeNote = (note: string) => note.trim().toLowerCase().replace(/\s+/g, " ");

/** The category and account an earlier entry with the same note used, so "tea" is filled in the second time. */
export function suggestFromHistory(note: string, kind: TransactionKind, transactions: readonly LedgerTransaction[], ownerId?: string) {
  const key = normalizeNote(note);
  if (key.length < 2) return null;
  let best: LedgerTransaction | null = null;
  for (const entry of transactions) {
    if (entry.kind !== kind || normalizeNote(entry.note) !== key) continue;
    if (ownerId && entry.userId !== ownerId) continue;
    if (!best || `${entry.occurredOn}${entry.createdAt}` > `${best.occurredOn}${best.createdAt}`) best = entry;
  }
  return best ? { category: best.category, paymentMode: best.paymentMode, paymentAccountId: best.paymentAccountId ?? "" } : null;
}

/** A row with nothing typed is the empty line at the end of the list, not an entry. */
export function isBlankRow(row: BatchRow) {
  return !row.note.trim() && !row.amount.trim();
}

export function batchRowToDraft(row: BatchRow): TransactionDraft {
  return {
    kind: row.kind,
    category: row.category as TransactionCategory,
    amount: row.amount.replace(/,/g, "").trim(),
    occurredOn: row.occurredOn,
    note: row.note.trim(),
    subcategory: "",
    area: "",
    paymentMode: row.paymentMode,
    paymentAccountId: row.paymentMode === "online" ? row.paymentAccountId : "",
    shared: false,
    clientRequestId: row.id,
  };
}
