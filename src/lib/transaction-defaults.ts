import { addDays, format, parseISO } from "date-fns";
import { adToBs, bsMonthName } from "./nepali-date";
import type { CalendarSystem, LedgerTransaction, PaymentAccount, PaymentMode, TransactionKind } from "../types";

export interface TransactionDefaults {
  category: string;
  paymentMode: PaymentMode;
  paymentAccountId: string;
}

export interface TransactionDefaultsInput {
  transactions: readonly LedgerTransaction[];
  kind: TransactionKind;
  paymentAccounts: readonly PaymentAccount[];
  /** Kathmandu today, `YYYY-MM-DD`. */
  today: string;
  /** Used when no recent entry of this kind has a category that still exists. */
  fallbackCategory: string;
  /** Category ids that can still be chosen for this kind; entries in removed categories are skipped. */
  categoryIds?: readonly string[];
  /** Only this user's own entries count, so a household partner's habits never become your defaults. */
  ownerId?: string;
  windowDays?: number;
}

/** Shifts a `YYYY-MM-DD` key by whole calendar days. */
export function shiftDateKey(date: string, days: number): string {
  return format(addDays(parseISO(date), days), "yyyy-MM-dd");
}

const newestFirst = (a: LedgerTransaction, b: LedgerTransaction) => `${b.occurredOn}${b.createdAt}`.localeCompare(`${a.occurredOn}${a.createdAt}`);

function mostUsed<T>(entries: readonly LedgerTransaction[], keyOf: (entry: LedgerTransaction) => T | null, idOf: (value: T) => string): T | null {
  const counts = new Map<string, { value: T; count: number; rank: number }>();
  entries.forEach((entry, rank) => {
    const value = keyOf(entry);
    if (value === null) return;
    const id = idOf(value);
    const current = counts.get(id);
    if (current) current.count += 1;
    else counts.set(id, { value, count: 1, rank });
  });
  // Entries arrive newest first, so a lower rank means used more recently: it breaks ties.
  return [...counts.values()].sort((a, b) => b.count - a.count || a.rank - b.rank)[0]?.value ?? null;
}

/**
 * Starting values for a brand-new entry, learned from what the user actually logs:
 * the payment mode + account they used most for this kind over the last 30 days
 * (else their latest entry of this kind, else cash), and their most frequent recent category.
 */
export function pickTransactionDefaults({ transactions, kind, paymentAccounts, today, fallbackCategory, categoryIds, ownerId, windowDays = 30 }: TransactionDefaultsInput): TransactionDefaults {
  // A new entry starts unshared, and the server only lets a shared entry use a partner's account, so only your own accounts qualify.
  const accountIds = new Set(paymentAccounts.filter((account) => !ownerId || account.userId === ownerId).map((account) => account.id));
  const categories = categoryIds ? new Set(categoryIds) : null;
  const own = transactions.filter((entry) => entry.kind === kind && (!ownerId || entry.userId === ownerId) && entry.occurredOn <= today).sort(newestFirst);
  const since = shiftDateKey(today, -(windowDays - 1));
  const recent = own.filter((entry) => entry.occurredOn >= since);
  const payment = (entry: LedgerTransaction): Omit<TransactionDefaults, "category"> | null => {
    if (entry.paymentMode !== "online") return { paymentMode: entry.paymentMode, paymentAccountId: "" };
    return entry.paymentAccountId && accountIds.has(entry.paymentAccountId) ? { paymentMode: "online", paymentAccountId: entry.paymentAccountId } : null;
  };
  const paymentKey = (value: Omit<TransactionDefaults, "category">) => `${value.paymentMode}:${value.paymentAccountId}`;
  const usual = mostUsed(recent, payment, paymentKey) ?? (own[0] ? payment(own[0]) : null) ?? { paymentMode: "cash" as const, paymentAccountId: "" };
  const category = mostUsed(recent, (entry) => !categories || categories.has(entry.category) ? entry.category : null, (value) => value) ?? fallbackCategory;
  return { category, ...usual };
}

/** The sheet-header date chip: Today / Yesterday / a short date in the user's calendar. */
export function entryDateLabel(date: string, today: string, calendarSystem: CalendarSystem = "AD"): { label: string; isToday: boolean } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { label: "Pick a date", isToday: false };
  if (date === today) return { label: "Today", isToday: true };
  if (date === shiftDateKey(today, -1)) return { label: "Yesterday", isToday: false };
  if (date === shiftDateKey(today, 1)) return { label: "Tomorrow", isToday: false };
  const local = parseISO(date);
  const weekday = format(local, "EEE");
  if (calendarSystem === "BS") {
    try {
      const bs = adToBs(date);
      const year = bs.year === adToBs(today).year ? "" : ` ${bs.year}`;
      return { label: `${weekday} ${bsMonthName(bs.month).slice(0, 3)} ${bs.day}${year}`, isToday: false };
    } catch {
      // Outside the supported BS range: fall through to the Gregorian label.
    }
  }
  const year = date.slice(0, 4) === today.slice(0, 4) ? "" : ` ${date.slice(0, 4)}`;
  return { label: `${weekday} ${format(local, "d MMM")}${year}`, isToday: false };
}

/**
 * A fresh id for one new-entry draft, so a retried save can be recognised by the server.
 * `crypto.randomUUID` only exists in secure contexts (not on a phone testing over plain-http LAN),
 * so this falls back to a v4 UUID built from `getRandomValues`.
 */
export function newClientRequestId(cryptoImpl: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string } = globalThis.crypto): string {
  if (cryptoImpl.randomUUID) return cryptoImpl.randomUUID();
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
