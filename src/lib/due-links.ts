import { differenceInCalendarDays, parseISO } from "date-fns";
import { isLoanCategory } from "./categories";
import { dueOpeningRequestId, isDebtKind } from "./dues";
import type { DueItem, DueKind, LedgerTransaction, TransactionKind } from "../types";

/**
 * A due can point at an entry already in the ledger instead of writing its own: the money lent or borrowed
 * (the loan's opening), or a repayment / paid bill. A linked entry stays the user's own — unlinking or deleting
 * the due never removes it, and gives back any category the link changed.
 */

type LinkDue = Pick<DueItem, "id" | "kind" | "amountMinor"> & { linkedTransactionId?: string | null; payments: { transactionId: string | null }[] };
type LinkTransaction = Pick<LedgerTransaction, "id" | "kind" | "category" | "amountMinor" | "occurredOn" | "createdAt"> & { userId?: string; clientRequestId?: string | null };

/** The way an entry must move to be a loan's opening: money you lent left you, money you borrowed arrived. */
export function openingLinkKind(kind: DueKind): TransactionKind {
  return kind === "borrowed" ? "income" : "expense";
}

/** The way an entry must move to settle a due: a lent loan or expected income comes in, a bill or borrowed loan goes out. */
export function settlementLinkKind(kind: DueKind): TransactionKind {
  return kind === "lent" || kind === "receivable" ? "income" : "expense";
}

/** Entries a due wrote itself (a loan's opening, a split bill's rows) belong to it already and cannot be linked again. */
const ownedByDues = (transaction: LinkTransaction) => Boolean(transaction.clientRequestId && (transaction.clientRequestId.startsWith(dueOpeningRequestId("")) || transaction.clientRequestId.startsWith("split:")));

/** How much of each entry other dues already claim as their opening, so one dinner can be lent to three friends but never past its total. */
export function claimedOpeningAmounts(dues: readonly LinkDue[], excludeDueId?: string | null) {
  const claimed = new Map<string, number>();
  for (const due of dues) {
    if (due.id === excludeDueId || !due.linkedTransactionId) continue;
    claimed.set(due.linkedTransactionId, (claimed.get(due.linkedTransactionId) ?? 0) + due.amountMinor);
  }
  return claimed;
}

/** Entries already recorded as some due's repayment or payment. */
export function settlementTransactionIds(dues: readonly LinkDue[]) {
  return new Set(dues.flatMap((due) => due.payments.flatMap((payment) => payment.transactionId ? [payment.transactionId] : [])));
}

export interface LinkCandidate<T> { transaction: T; availableMinor: number }

/** Entries that could be this loan's opening, nearest the loan's date first: the right direction, yours, and not already used up by a due. */
export function openingLinkCandidates<T extends LinkTransaction>({ kind, transactions, dues, dueId, userId, nearDate }: { kind: DueKind; transactions: readonly T[]; dues: readonly LinkDue[]; dueId?: string | null; userId?: string; nearDate?: string | null }): LinkCandidate<T>[] {
  if (!isDebtKind(kind)) return [];
  const wanted = openingLinkKind(kind);
  const claimed = claimedOpeningAmounts(dues, dueId);
  const settlements = settlementTransactionIds(dues);
  return byNearness(transactions.filter((transaction) => transaction.kind === wanted && (!userId || !transaction.userId || transaction.userId === userId) && !ownedByDues(transaction) && !settlements.has(transaction.id)), nearDate)
    .map((transaction) => ({ transaction, availableMinor: transaction.amountMinor - (claimed.get(transaction.id) ?? 0) }))
    .filter((candidate) => candidate.availableMinor > 0);
}

/** Entries that could settle this due, nearest the chosen date first. A loan's own opening, or an entry another due uses, is never offered. */
export function settlementLinkCandidates<T extends LinkTransaction>({ kind, transactions, dues, userId, nearDate }: { kind: DueKind; transactions: readonly T[]; dues: readonly LinkDue[]; userId?: string; nearDate?: string | null }): LinkCandidate<T>[] {
  const wanted = settlementLinkKind(kind);
  const openings = new Set(dues.flatMap((due) => due.linkedTransactionId ? [due.linkedTransactionId] : []));
  const settlements = settlementTransactionIds(dues);
  return byNearness(transactions.filter((transaction) => transaction.kind === wanted && (!userId || !transaction.userId || transaction.userId === userId) && !ownedByDues(transaction) && !openings.has(transaction.id) && !settlements.has(transaction.id)), nearDate)
    .map((transaction) => ({ transaction, availableMinor: transaction.amountMinor }));
}

function byNearness<T extends LinkTransaction>(transactions: T[], nearDate?: string | null) {
  const distance = (transaction: T) => nearDate ? Math.abs(differenceInCalendarDays(parseISO(transaction.occurredOn), parseISO(nearDate))) : 0;
  return [...transactions].sort((a, b) => distance(a) - distance(b) || b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt));
}

/**
 * Whether linking turns the entry into a loan movement. Only when the whole entry is the loan: part of a dinner
 * you lent is still your own spending for the rest, so the entry keeps its category. Bills never change category.
 */
export function linkMakesLoan(dueKind: DueKind | string, dueAmountMinor: number, transaction: Pick<LedgerTransaction, "category" | "amountMinor">) {
  return isDebtKind(dueKind) && !isLoanCategory(transaction.category) && dueAmountMinor === transaction.amountMinor;
}

/** The loan subcategory a whole linked entry takes: the lend or borrow itself, or a repayment. */
export function linkedLoanSubcategory(dueKind: DueKind | string, role: "opening" | "settlement") {
  return role === "settlement" ? "Repayment" : dueKind === "lent" ? "Lent" : "Borrowed";
}

/** What a reclassified entry goes back to when its link ends, or null when the link never changed it. */
export interface LinkRestore { category: string; subcategory: string | null }

export function linkRestoreFor(dueKind: DueKind | string, dueAmountMinor: number, transaction: Pick<LedgerTransaction, "category" | "subcategory" | "amountMinor">): LinkRestore | null {
  return linkMakesLoan(dueKind, dueAmountMinor, transaction) ? { category: transaction.category, subcategory: transaction.subcategory } : null;
}

/** An entry's dues, so the ledger can say "Lent to Mina" and open the due. A loan's own recorded opening counts too. */
export interface TransactionDueLink { due: DueItem; role: "opening" | "settlement" }

export function dueLinksFor(transaction: LinkTransaction, dues: readonly DueItem[]): TransactionDueLink[] {
  const prefix = dueOpeningRequestId("");
  const ownDue = transaction.clientRequestId?.startsWith(prefix) ? transaction.clientRequestId.slice(prefix.length) : null;
  return dues.flatMap((due): TransactionDueLink[] => [
    ...(due.linkedTransactionId === transaction.id || due.id === ownDue ? [{ due, role: "opening" as const }] : []),
    ...(due.payments.some((payment) => payment.transactionId === transaction.id) ? [{ due, role: "settlement" as const }] : []),
  ]);
}

/** "Lent to Mina", "Repaid by Mina", "Paid Rent": how an entry's due link reads on the ledger. */
export function dueLinkLabel({ due, role }: TransactionDueLink) {
  const who = due.person.trim() || due.title.trim();
  if (role === "opening") return due.kind === "borrowed" ? `Borrowed from ${who}` : `Lent to ${who}`;
  if (due.kind === "lent") return `Repaid by ${who}`;
  if (due.kind === "borrowed") return `Repaid to ${who}`;
  return due.kind === "payment" ? `Paid · ${due.title}` : `Received · ${due.title}`;
}

/** Whether an entry can start a new Lent or Borrowed due: yours, not a loan movement already, and not tied to a due. */
export function canStartLoanFrom(transaction: LinkTransaction, links: readonly TransactionDueLink[]) {
  return !isLoanCategory(transaction.category) && !ownedByDues(transaction) && !links.length;
}

/** The loan an entry starts: money out is money lent, money in is money borrowed. */
export function loanKindFor(transaction: Pick<LedgerTransaction, "kind">): "lent" | "borrowed" {
  return transaction.kind === "income" ? "borrowed" : "lent";
}
