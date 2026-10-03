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

function amountMatches(query: string, amountMinor: number) {
  const digits = query.replace(/[^\d.]/g, "");
  if (!digits) return false;
  const major = (amountMinor / 100).toFixed(2).replace(/\.00$/, "");
  return major.includes(digits) || String(amountMinor).includes(digits.replace(".", ""));
}

function textMatches(query: string, parts: readonly (string | null | undefined)[]) {
  const needle = compact(query);
  if (!needle) return false;
  return parts.some((part) => part && part.toLowerCase().includes(needle));
}

function accountLabel(accounts: readonly PaymentAccount[], id: string) {
  const account = accounts.find((item) => item.id === id);
  if (!account) return "Account";
  return account.label || account.provider;
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
    const matched = textMatches(needle, [title, item.note, item.category, label(item.category), item.subcategory, item.area, item.paymentMode]) || amountMatches(needle, item.amountMinor);
    if (!matched) continue;
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
