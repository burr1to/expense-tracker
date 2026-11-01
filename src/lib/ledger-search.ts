import { paymentAccountLabel } from "./payment-accounts";
import type { AccountTransfer, DueItem, LedgerTransaction, PaymentAccount, SavedPlace } from "../types";

export type LedgerSearchKind = "transaction" | "transfer" | "due" | "place";

export interface LedgerSearchHit {
  id: string;
  kind: LedgerSearchKind;
  title: string;
  detail: string;
  href: string;
  amountMinor: number | null;
  direction: "in" | "out" | "move" | "none";
}

function compact(value: string) {
  return value.trim().toLowerCase();
}

/**
 * True when a numeric query ("1250", "1,250.50", "Rs 250", "NPR 1500") appears in the amount.
 * A query with words in it ("bus 2") is a text search, so it never matches by amount.
 */
export function amountMatches(query: string, amountMinor: number) {
  const numeric = compact(query).replace(/^(npr|rs\.?|रु\.?)\s*/, "");
  if (!/^[\d,.\s]+$/.test(numeric)) return false;
  // "1250.00" means 1250; comparing against the major amount only keeps "100" from matching NPR 10 (1000 paisa).
  const digits = numeric.replace(/[^\d.]/g, "").replace(/\.0*$/, "");
  if (!/\d/.test(digits)) return false;
  const major = (amountMinor / 100).toFixed(2).replace(/\.00$/, "");
  return major.includes(digits);
}

/** Matches the whole query in one field, or every word of it across fields ("momo thamel" = note + area). */
export function textMatches(query: string, parts: readonly (string | null | undefined)[]) {
  const needle = compact(query);
  if (!needle) return false;
  const fields = parts.flatMap((part) => part ? [part.toLowerCase()] : []);
  if (fields.some((field) => field.includes(needle))) return true;
  const words = needle.split(/\s+/);
  return words.length > 1 && words.every((word) => fields.some((field) => field.includes(word)));
}

/** The one matcher both ledger searches (Ctrl+K and the Transactions page) use. */
export function entryMatches(query: string, parts: readonly (string | null | undefined)[], amountMinor: number) {
  return textMatches(query, parts) || amountMatches(query, amountMinor);
}

/** Every searchable field of a transaction, including its exact-location label and payment account. */
export function transactionSearchParts(item: LedgerTransaction, categoryLabel: string, accounts: readonly PaymentAccount[] = []) {
  const account = item.paymentAccount ?? (item.paymentAccountId ? accounts.find((entry) => entry.id === item.paymentAccountId) : undefined);
  return [item.note, item.category, categoryLabel, item.subcategory, item.area, item.locationLabel, item.paymentMode, account?.label, account?.provider, account ? paymentAccountLabel(account) : null];
}

function accountLabel(accounts: readonly PaymentAccount[], id: string) {
  const account = accounts.find((item) => item.id === id);
  if (!account) return "Account";
  // The nickname keeps a transfer title short; without one, the type's name (IME Pay, never "ime_pay").
  return account.label || paymentAccountLabel(account);
}

export function searchLedger(query: string, input: {
  transactions: readonly LedgerTransaction[];
  transfers: readonly AccountTransfer[];
  dues: readonly DueItem[];
  places: readonly SavedPlace[];
  accounts: readonly PaymentAccount[];
  categoryLabel?: (category: string) => string;
}): LedgerSearchHit[] {
  const needle = query.trim();
  if (needle.length < 1) return [];
  const label = input.categoryLabel ?? ((category: string) => category);
  const encoded = encodeURIComponent(needle);
  const hits: LedgerSearchHit[] = [];

  for (const item of input.transactions) {
    const title = item.note || label(item.category);
    if (!entryMatches(needle, transactionSearchParts(item, label(item.category), input.accounts), item.amountMinor)) continue;
    hits.push({
      id: item.id,
      kind: "transaction",
      title,
      detail: `${label(item.category)}${item.area ? ` · ${item.area}` : ""} · ${item.occurredOn}`,
      href: `/transactions?q=${encoded}`,
      amountMinor: item.amountMinor,
      direction: item.kind === "income" ? "in" : "out",
    });
  }

  for (const item of input.transfers) {
    const from = accountLabel(input.accounts, item.fromAccountId);
    const to = accountLabel(input.accounts, item.toAccountId);
    const title = `${from} → ${to}`;
    const matched = textMatches(needle, [title, from, to, item.note, "transfer"]) || amountMatches(needle, item.amountMinor);
    if (!matched) continue;
    hits.push({
      id: item.id,
      kind: "transfer",
      title,
      detail: `Transfer${item.note ? ` · ${item.note}` : ""} · ${item.occurredOn}`,
      href: "/accounts",
      amountMinor: item.amountMinor,
      direction: "move",
    });
  }

  for (const item of input.dues) {
    const matched = textMatches(needle, [item.title, item.person, item.note, item.kind, label(item.category)]) || amountMatches(needle, item.amountMinor);
    if (!matched) continue;
    hits.push({
      id: item.id,
      kind: "due",
      title: item.title,
      detail: `${item.person || item.kind} · due ${item.dueOn}`,
      href: `/dues?due=${encodeURIComponent(item.id)}`,
      amountMinor: item.amountMinor,
      direction: item.kind === "receivable" || item.kind === "lent" ? "in" : "out",
    });
  }

  for (const item of input.places) {
    if (!textMatches(needle, [item.name, item.address, "place"])) continue;
    hits.push({
      id: item.id,
      kind: "place",
      title: item.name,
      detail: item.address || "Saved place",
      href: `/maps?place=${encodeURIComponent(item.id)}`,
      amountMinor: null,
      direction: "none",
    });
  }

  return hits.slice(0, 20);
}
