import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { LOAN_CATEGORY_ID, spendingCategoriesFor } from "./categories";
import { todayInput } from "./dates";
import { adToBs, formatBs } from "./nepali-date";
import type { CalendarSystem, CustomCategory, DueItem, DueKind, DuePayment, LedgerTransaction, TransactionKind } from "../types";

export type DueUrgency = "overdue" | "today" | "later";

/** Lent and Borrowed are loans between people; Pay and Receive are ordinary bills and income. */
export function isDebtKind(kind: DueKind | string): kind is "lent" | "borrowed" {
  return kind === "lent" || kind === "borrowed";
}

/** The request id of the movement recorded when a Lent/Borrowed due is added, so edits and deletes can find it again. */
export function dueOpeningRequestId(dueId: string) {
  return `due-open:${dueId}`;
}

export function findDueOpeningMovement<T extends Pick<LedgerTransaction, "id">>(transactions: readonly T[], dueId: string): T | undefined {
  const requestId = dueOpeningRequestId(dueId);
  return transactions.find((transaction) => (transaction as T & { clientRequestId?: string | null }).clientRequestId === requestId);
}

/** Every loan's opening movement keyed by due id, found in one pass over the ledger. */
export function dueOpeningMovementsByDue<T extends Pick<LedgerTransaction, "id">>(transactions: readonly T[]): Map<string, T> {
  const prefix = dueOpeningRequestId("");
  const byDue = new Map<string, T>();
  for (const transaction of transactions) {
    const requestId = (transaction as T & { clientRequestId?: string | null }).clientRequestId;
    if (requestId?.startsWith(prefix) && requestId.length > prefix.length) byDue.set(requestId.slice(prefix.length), transaction);
  }
  return byDue;
}

/** Whether a due's money moves out (a bill to pay, a loan to repay) or in. */
export function dueDirection(kind: DueKind): "income" | "expense" {
  return kind === "payment" || kind === "borrowed" ? "expense" : "income";
}

/** Loans always use the loan category; bills keep a category that fits their direction, else fall back to the neutral "other". */
export function dueCategoryForKind(kind: DueKind, current: string, customCategories: readonly CustomCategory[] = []) {
  if (isDebtKind(kind)) return LOAN_CATEGORY_ID;
  return spendingCategoriesFor(dueDirection(kind), customCategories).some((category) => category.id === current) ? current : "other";
}

/** The due kind a new due starts as on each Dues tab, so "Add" on Lent adds money lent. */
export function dueKindForTab(tab: string): DueKind {
  return tab === "lent" || tab === "borrowed" ? tab : "payment";
}

export interface DueMovement { kind: TransactionKind; category: string; subcategory: string | null; note: string }
type MovementDue = Pick<DueItem, "title" | "person" | "category"> & { kind: DueKind | string };
const who = (due: MovementDue) => due.person.trim() || due.title.trim();
const capNote = (note: string) => note.slice(0, 240);

/** The money leaving (lent) or arriving (borrowed) on the day a loan is made: a loan movement, never income or spending. */
export function dueOpeningMovement(due: MovementDue): DueMovement {
  const lent = due.kind === "lent";
  const detail = due.person.trim() && due.title.trim() ? ` · ${due.title.trim()}` : "";
  return { kind: lent ? "expense" : "income", category: LOAN_CATEGORY_ID, subcategory: lent ? "Lent" : "Borrowed", note: capNote(`${lent ? "Lent to" : "Borrowed from"} ${who(due)}${detail}`) };
}

/** A repayment or settled bill. Loans repay as loan movements; bills and expected income keep the due's own category. */
export function dueRepaymentMovement(due: MovementDue, note = ""): DueMovement {
  const incoming = due.kind === "lent" || due.kind === "receivable";
  const fallback = due.kind === "lent" ? `Repayment from ${who(due)}` : due.kind === "borrowed" ? `Repayment to ${who(due)}` : due.kind === "payment" ? `Paid ${due.title}` : `Received ${due.title}`;
  return {
    kind: incoming ? "income" : "expense",
    category: isDebtKind(due.kind) ? LOAN_CATEGORY_ID : due.category,
    subcategory: isDebtKind(due.kind) ? "Repayment" : null,
    note: capNote(note.trim() || fallback),
  };
}

/** The repayment Undo removes: the one recorded last. */
export function latestDuePayment(item: Pick<DueItem, "payments">): DuePayment | undefined {
  return [...item.payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.occurredOn.localeCompare(a.occurredOn))[0];
}

/** Repayments oldest first, the order a history reads in. */
export function duePaymentHistory(item: Pick<DueItem, "payments">): DuePayment[] {
  return [...item.payments].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.createdAt.localeCompare(b.createdAt));
}

export function duePaid(item: Pick<DueItem, "payments">) {
  return item.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
}

export function dueRemaining(item: Pick<DueItem, "amountMinor" | "payments">) {
  return Math.max(0, item.amountMinor - duePaid(item));
}

export function actionableDues(items: readonly DueItem[], today = todayInput()) {
  return items
    .filter((item) =>
      item.status === "open"
      && (!item.snoozedUntil || item.snoozedUntil <= today)
      && (item.dueOn <= today || Boolean(item.remindOn && item.remindOn <= today))
    )
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

export function dueUrgency(item: DueItem, today = todayInput()): DueUrgency {
  if (item.dueOn < today) return "overdue";
  if (item.dueOn === today) return "today";
  return "later";
}

export function groupActionableDues(items: readonly DueItem[], today = todayInput()) {
  const groups: Record<DueUrgency, DueItem[]> = { overdue: [], today: [], later: [] };
  for (const item of actionableDues(items, today)) groups[dueUrgency(item, today)].push(item);
  return groups;
}

export function urgentDueCount(items: readonly DueItem[], today = todayInput()) {
  return actionableDues(items, today).filter((item) => dueUrgency(item, today) !== "later").length;
}

export function dueDateLabel(dueOn: string, today = new Date(), system: CalendarSystem = "AD") {
  const days = differenceInCalendarDays(parseISO(dueOn), today);
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 7) return `Due in ${days} days`;
  return `Due ${shortDueDate(dueOn, system)}`;
}

/** "Oct 18", or "Kar 1" in Bikram Sambat, falling back to Gregorian outside the supported range. */
export function shortDueDate(date: string, system: CalendarSystem = "AD") {
  if (system === "BS") {
    try { return formatBs(adToBs(date), "short").replace(/, \d+$/, ""); } catch { /* outside the BS table */ }
  }
  return format(parseISO(date), "MMM d");
}
