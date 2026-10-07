import { addDays, format, parseISO } from "date-fns";
import type { DueItem } from "../types";

/** A friend's share of a split bill falls due this many days after the bill. */
export const SPLIT_DUE_AFTER_DAYS = 30;
export const SERVICE_CHARGE_PERCENT = 10;
export const VAT_PERCENT = 13;
export const MAX_SPLIT_PEOPLE = 20;

export type SplitMode = "equal" | "custom";
export interface BillCharges { serviceCharge: boolean; vat: boolean }
export interface BillTotal { subtotalMinor: number; serviceMinor: number; vatMinor: number; totalMinor: number }
export interface SplitShare { person: string; amountMinor: number }

/** What the split-a-bill sheet sends to the ledger: my share is spending, the rest is money lent. */
export interface SplitBillDraft {
  clientRequestId: string;
  totalMinor: number;
  myShareMinor: number;
  shares: SplitShare[];
  category: string;
  occurredOn: string;
  note: string;
  /** null means the bill was paid in cash. */
  paymentAccountId: string | null;
}

/** Restaurant bills in Nepal add the 10% service charge first, then 13% VAT on the subtotal plus service. */
export function applyBillCharges(subtotalMinor: number, charges: BillCharges): BillTotal {
  const subtotal = Math.max(0, Math.round(subtotalMinor) || 0);
  const serviceMinor = charges.serviceCharge ? Math.round(subtotal * SERVICE_CHARGE_PERCENT / 100) : 0;
  const vatMinor = charges.vat ? Math.round((subtotal + serviceMinor) * VAT_PERCENT / 100) : 0;
  return { subtotalMinor: subtotal, serviceMinor, vatMinor, totalMinor: subtotal + serviceMinor + vatMinor };
}

/**
 * Shares that always add back to the total. Each share is a whole rupee where
 * possible: leftover rupees go to the first shares and any paisa to the first
 * one, so with the payer listed first, friends owe round figures.
 */
export function splitEvenly(totalMinor: number, count: number, unitMinor = 100): number[] {
  const total = Math.max(0, Math.round(totalMinor) || 0);
  const people = Math.max(1, Math.floor(count) || 1);
  const unit = Math.max(1, Math.floor(unitMinor) || 1);
  const units = Math.floor(total / unit);
  const base = Math.floor(units / people);
  const extra = units % people;
  const shares = Array.from({ length: people }, (_, index) => (base + (index < extra ? 1 : 0)) * unit);
  shares[0] += total - units * unit;
  return shares;
}

export function normalizePersonName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

export function samePerson(a: string, b: string) {
  return normalizePersonName(a).toLocaleLowerCase() === normalizePersonName(b).toLocaleLowerCase();
}

/** Everyone you have had dues with, most recently added first, once each however their name was capitalised. */
export function personSuggestions(dues: readonly Pick<DueItem, "person" | "createdAt">[]): string[] {
  const seen = new Map<string, string>();
  for (const due of [...dues].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const name = normalizePersonName(due.person);
    const key = name.toLocaleLowerCase();
    if (name && !seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()];
}

export interface SplitPersonInput { name: string; amountMinor?: number }
export interface SplitPlanInput {
  totalMinor: number;
  includeMe: boolean;
  mode: SplitMode;
  people: readonly SplitPersonInput[];
  /** Custom mode only: my own share. */
  myAmountMinor?: number;
}
export interface SplitPlan {
  totalMinor: number;
  myShareMinor: number;
  shares: SplitShare[];
  othersTotalMinor: number;
  /** Positive when part of the bill is not assigned yet, negative when the shares add up to more than the bill. */
  unallocatedMinor: number;
  error: string | null;
}

const clampMinor = (value: number | undefined) => Math.max(0, Math.round(value ?? 0) || 0);

export function buildSplitPlan(input: SplitPlanInput): SplitPlan {
  const totalMinor = clampMinor(input.totalMinor);
  const names = input.people.map((person) => normalizePersonName(person.name));
  let myShareMinor: number;
  let amounts: number[];
  if (input.mode === "equal") {
    const shares = splitEvenly(totalMinor, names.length + (input.includeMe ? 1 : 0));
    myShareMinor = input.includeMe ? shares[0] : 0;
    amounts = input.includeMe ? shares.slice(1) : shares;
  } else {
    myShareMinor = input.includeMe ? clampMinor(input.myAmountMinor) : 0;
    amounts = input.people.map((person) => clampMinor(person.amountMinor));
  }
  const shares = names.map((person, index) => ({ person, amountMinor: amounts[index] ?? 0 }));
  const othersTotalMinor = shares.reduce((sum, share) => sum + share.amountMinor, 0);
  const unallocatedMinor = totalMinor - myShareMinor - othersTotalMinor;
  const keys = names.map((name) => name.toLocaleLowerCase());
  const error = totalMinor <= 0 ? "Enter what the bill came to."
    : !names.length ? "Add at least one person to split with."
      : names.length > MAX_SPLIT_PEOPLE ? `Split between at most ${MAX_SPLIT_PEOPLE} people.`
        : names.some((name) => !name) ? "Give every person a name."
          : new Set(keys).size !== keys.length ? "Each person can appear only once."
            : shares.some((share) => share.amountMinor <= 0) ? "Every person needs a share above zero."
              : unallocatedMinor > 0 ? "Part of the bill is not assigned to anyone yet."
                : unallocatedMinor < 0 ? "The shares add up to more than the bill."
                  : null;
  return { totalMinor, myShareMinor, shares, othersTotalMinor, unallocatedMinor, error };
}

/** "Momo night split", or the category name when the bill has no note. Fits the 100-character due title. */
export function splitDueTitle(note: string, fallbackLabel: string) {
  const base = note.trim() || fallbackLabel;
  return `${base.slice(0, 94)} split`;
}

export function splitDueDate(occurredOn: string) {
  return format(addDays(parseISO(occurredOn), SPLIT_DUE_AFTER_DAYS), "yyyy-MM-dd");
}
