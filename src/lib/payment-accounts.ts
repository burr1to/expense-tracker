import type { AccountTransfer, PaymentAccount, PaymentAccountType } from "../types";

export const PAYMENT_ACCOUNT_TYPES: readonly { value: PaymentAccountType; label: string }[] = [
  { value: "mobile_banking", label: "Mobile banking" },
  { value: "esewa", label: "eSewa" },
  { value: "khalti", label: "Khalti" },
  { value: "ime_pay", label: "IME Pay" },
  { value: "connect_ips", label: "connectIPS" },
  { value: "cash", label: "Cash in hand" },
  { value: "other", label: "Other (co-op, finance, card)" },
];

/** Wallet types store the type id as their provider. */
export const WALLET_ACCOUNT_TYPES: readonly PaymentAccountType[] = ["esewa", "khalti", "connect_ips", "ime_pay"];
export const CASH_PROVIDER = "Cash";
export const ACCOUNT_TAIL_PATTERN = /^\d{3,4}$/;

// NRB-licensed commercial and development banks, verified against the June 2026 BFI list.
export const NEPAL_MOBILE_BANKS = [
  "Agriculture Development Bank Limited", "Citizens Bank International Limited", "Everest Bank Limited", "Global IME Bank Limited",
  "Himalayan Bank Limited", "Kumari Bank Limited", "Laxmi Sunrise Bank Limited", "Machhapuchchhre Bank Limited",
  "Nabil Bank Limited", "Nepal Bank Limited", "Nepal Investment Mega Bank Limited", "Nepal SBI Bank Limited",
  "NIC Asia Bank Limited", "NMB Bank Limited", "Prabhu Bank Limited", "Prime Commercial Bank Limited",
  "Rastriya Banijya Bank Limited", "Sanima Bank Limited", "Siddhartha Bank Limited", "Standard Chartered Bank Nepal Limited",
  "Corporate Development Bank Limited", "Excel Development Bank Limited", "Garima Bikas Bank Limited", "Green Development Bank Limited",
  "Jyoti Bikas Bank Limited", "Kamana Sewa Bikas Bank Limited", "Karnali Development Bank Limited", "Lumbini Bikas Bank Limited",
  "Mahalaxmi Bikas Bank Limited", "Miteri Development Bank Limited", "Muktinath Bikas Bank Limited", "Narayani Development Bank Limited",
  "Salapa Bikas Bank Limited", "Saptakoshi Development Bank Limited", "Shangrila Development Bank Limited",
  "Shine Resunga Development Bank Limited", "Sindhu Bikas Bank Limited",
] as const;

export function paymentAccountTypeLabel(type: PaymentAccountType) {
  return PAYMENT_ACCOUNT_TYPES.find((item) => item.value === type)?.label ?? type;
}

export function paymentAccountLabel(account: Pick<PaymentAccount, "type" | "provider" | "label">) {
  const provider = account.type === "mobile_banking" || account.type === "other" ? account.provider : paymentAccountTypeLabel(account.type);
  return account.label ? `${account.label} · ${provider}` : provider;
}

export function isCashAccount(account: Pick<PaymentAccount, "type">) {
  return account.type === "cash";
}

/** Accounts an online payment can name. Cash in hand collects cash entries on its own. */
export function onlinePaymentAccounts<T extends Pick<PaymentAccount, "type">>(accounts: readonly T[]): T[] {
  return accounts.filter((account) => !isCashAccount(account));
}

/** The provider stored for a new account of this type. */
export function providerForAccountType(type: PaymentAccountType, chosen: string) {
  if (type === "cash") return CASH_PROVIDER;
  if (type === "mobile_banking" || type === "other") return chosen.trim();
  return type;
}

/** Why a type/provider pair cannot be saved, or null when it is valid. */
export function paymentAccountProviderError(type: PaymentAccountType, provider: string): string | null {
  if (type === "mobile_banking") return NEPAL_MOBILE_BANKS.includes(provider as typeof NEPAL_MOBILE_BANKS[number]) ? null : "Choose a bank from the supported Nepal bank list.";
  if (type === "other") return provider.trim().length >= 2 ? null : "Name the co-op, finance company or card.";
  if (type === "cash") return provider === CASH_PROVIDER ? null : "The payment provider does not match the account type.";
  return provider === type ? null : "The payment provider does not match the account type.";
}

const GENERIC_PROVIDER_WORDS = new Set(["bank", "limited", "ltd", "bikas", "development", "pvt", "private"]);

/**
 * Lower-cases a bank or wallet name and drops the words and punctuation that
 * differ between an SMS ("Nabil Bank") and a stored name ("Nabil Bank Limited").
 * "Nepal" is dropped only beside other words, so Nepal Bank never prefixes
 * Nepal Investment or Nepal SBI.
 */
export function normalizeProviderName(value: string) {
  const words = value.toLowerCase().replace(/[_\W]+/g, " ").split(" ").filter((word) => word && !GENERIC_PROVIDER_WORDS.has(word));
  return (words.length > 1 ? words.filter((word) => word !== "nepal") : words).join("");
}

/** Prefix match either way; containment only when the shorter name is distinctive. */
export function providersMatch(left: string, right: string) {
  const a = normalizeProviderName(left);
  const b = normalizeProviderName(right);
  if (a.length < 3 || b.length < 3) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 5 && longer.includes(shorter);
}

/** The name an SMS would use for this account's provider. Cash has none. */
export function accountProviderName(account: Pick<PaymentAccount, "type" | "provider">) {
  if (account.type === "cash") return "";
  if (account.type === "mobile_banking" || account.type === "other") return account.provider;
  return paymentAccountTypeLabel(account.type);
}

/** Digits only, 3-4 of them, or null. */
export function normalizeAccountTail(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return ACCOUNT_TAIL_PATTERN.test(digits) ? digits : null;
}

/** Two masked tails name the same account when one ends with the other. */
export function accountTailsMatch(left: string, right: string) {
  if (left.length < 3 || right.length < 3) return false;
  return left.endsWith(right) || right.endsWith(left);
}

export interface TransferAccounts { fromAccountId: string; toAccountId: string }

/**
 * The From and To a new transfer starts with: what the caller asked for, then the
 * last route the user saved, and with only two accounts, the other one. Ids that
 * are no longer among `accounts` are ignored, and both sides never name one account.
 */
export function transferAccountDefaults(accounts: readonly Pick<PaymentAccount, "id">[], requested: Partial<TransferAccounts> = {}, lastUsed: Partial<TransferAccounts> | null = null): TransferAccounts {
  const known = (id: string | undefined) => id && accounts.some((account) => account.id === id) ? id : "";
  const firstOther = (ids: (string | undefined)[], except: string) => ids.map(known).find((id) => id && id !== except) ?? "";
  const askedFrom = known(requested.fromAccountId);
  const askedTo = known(requested.toAccountId);
  let fromAccountId = askedFrom || firstOther([lastUsed?.fromAccountId], askedTo);
  // Opening from the account that last received money suggests the way back.
  let toAccountId = askedTo && askedTo !== fromAccountId ? askedTo : firstOther([lastUsed?.toAccountId, lastUsed?.fromAccountId], fromAccountId);
  const other = (id: string) => accounts.length === 2 && id ? accounts.find((account) => account.id !== id)?.id ?? "" : "";
  if (!toAccountId) toAccountId = other(fromAccountId);
  if (!fromAccountId) fromAccountId = other(toAccountId);
  return { fromAccountId, toAccountId };
}

type TransferRoute = Pick<AccountTransfer, "fromAccountId" | "toAccountId" | "amountMinor" | "occurredOn">;

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/**
 * A transfer already recorded on the same route for the same amount within a day, such as the
 * bank's alert for a wallet load whose wallet alert is being read now. Saving both would move the money twice.
 */
export function findSimilarTransfer<T extends TransferRoute & { id: string }>(transfers: readonly T[], draft: TransferRoute, ignoreId?: string): T | null {
  if (!draft.fromAccountId || !draft.toAccountId || !(draft.amountMinor > 0) || !Number.isFinite(dayNumber(draft.occurredOn))) return null;
  return transfers.find((item) => item.id !== ignoreId && item.fromAccountId === draft.fromAccountId && item.toAccountId === draft.toAccountId
    && item.amountMinor === draft.amountMinor && Math.abs(dayNumber(item.occurredOn) - dayNumber(draft.occurredOn)) <= 1) ?? null;
}
