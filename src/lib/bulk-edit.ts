import type { AccountReconciliation, LedgerTransaction, PaymentMode, TransactionKind } from "../types";

/** The most entries one bulk edit may change; the server enforces the same cap. */
export const BULK_EDIT_LIMIT = 500;

/** What a bulk edit sets on every selected entry. A field left out keeps each entry's own value. */
export interface BulkChanges {
  category?: { kind: TransactionKind; category: string; subcategory: string };
  occurredOn?: string;
  payment?: { paymentMode: PaymentMode; paymentAccountId: string };
}

export function hasBulkChanges(changes: BulkChanges) {
  return Boolean(changes.category || changes.occurredOn || changes.payment);
}

type EditableFields = Pick<LedgerTransaction, "kind" | "category" | "subcategory" | "occurredOn" | "paymentMode" | "paymentAccountId">;

/** The entry as it would read after the edit; everything not being changed is carried over. */
export function applyBulkChanges<T extends EditableFields>(transaction: T, changes: BulkChanges): T {
  return {
    ...transaction,
    ...(changes.category ? { kind: changes.category.kind, category: changes.category.category, subcategory: changes.category.subcategory.trim() || null } : {}),
    ...(changes.occurredOn ? { occurredOn: changes.occurredOn } : {}),
    ...(changes.payment ? { paymentMode: changes.payment.paymentMode, paymentAccountId: changes.payment.paymentMode === "online" ? changes.payment.paymentAccountId || null : null } : {}),
  };
}

const sameFields = (a: EditableFields, b: EditableFields) => a.kind === b.kind && a.category === b.category && (a.subcategory ?? null) === (b.subcategory ?? null)
  && a.occurredOn === b.occurredOn && a.paymentMode === b.paymentMode && (a.paymentAccountId ?? null) === (b.paymentAccountId ?? null);

/**
 * Mirrors the server: an entry on an account whose approved reconciliation covers its date is audited history,
 * so it is shown but cannot be picked, and an edit may not move an entry into such a period either.
 */
export function lockedByReconciliation(entry: Pick<LedgerTransaction, "paymentAccountId" | "occurredOn"> & { createdAt?: string }, reconciliations: readonly AccountReconciliation[], now = new Date()) {
  if (!entry.paymentAccountId) return null;
  const createdAt = entry.createdAt ? new Date(entry.createdAt) : now;
  return reconciliations.find((reconciliation) => reconciliation.paymentAccountId === entry.paymentAccountId
    && (reconciliation.checkedOn > entry.occurredOn || (reconciliation.checkedOn === entry.occurredOn && new Date(reconciliation.approvedAt) >= createdAt))) ?? null;
}

export interface BulkEditPreview {
  /** Entries the edit actually changes. */
  changed: number;
  /** Selected entries that already have these values. */
  unchanged: number;
  /** Entries whose type flips between expense and income, which moves them between spending and earnings. */
  kindSwitches: number;
  /** Entries the edit would move into an approved reconciliation, which the server refuses. */
  intoLocked: number;
}

export function previewBulkEdit(selected: readonly LedgerTransaction[], changes: BulkChanges, reconciliations: readonly AccountReconciliation[], now = new Date()): BulkEditPreview {
  const preview: BulkEditPreview = { changed: 0, unchanged: 0, kindSwitches: 0, intoLocked: 0 };
  for (const entry of selected) {
    const next = applyBulkChanges(entry, changes);
    if (sameFields(entry, next)) { preview.unchanged += 1; continue; }
    preview.changed += 1;
    if (next.kind !== entry.kind) preview.kindSwitches += 1;
    if (lockedByReconciliation({ paymentAccountId: next.paymentAccountId, occurredOn: next.occurredOn }, reconciliations, now)) preview.intoLocked += 1;
  }
  return preview;
}

/** The selected entries the edit would change; sending only these keeps the log and the request honest. */
export function bulkEditTargets(selected: readonly LedgerTransaction[], changes: BulkChanges) {
  return selected.filter((entry) => !sameFields(entry, applyBulkChanges(entry, changes)));
}
