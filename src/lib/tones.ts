import { Bank, DeviceMobile, Money, Question, Wallet, type Icon } from "@phosphor-icons/react";
import { getCategory } from "./categories";
import { CASH_BUCKET } from "./month-compare";
import type { CustomCategory, PaymentAccount, PaymentAccountType, TransactionCategory } from "../types";

/** A colour pair for an icon tile: a soft background and a strong ink, plus a pale bar for "last month". */
export interface Tone { bg: string; ink: string; pale: string }

const CATEGORY_TONES: Record<string, Tone> = {
  salary: { bg: "#d6f0df", ink: "#1f7a45", pale: "#bfe2c6" },
  freelance: { bg: "#d9efe9", ink: "#1d6b5a", pale: "#bde0d6" },
  gift: { bg: "#fbe0ec", ink: "#b0386a", pale: "#f3c6da" },
  housing: { bg: "#ece4dc", ink: "#6e4f3a", pale: "#dccfc2" },
  food: { bg: "#fde5d4", ink: "#b4531f", pale: "#f6cdb0" },
  transport: { bg: "#dcecf8", ink: "#1f6f9a", pale: "#c0dbef" },
  utilities: { bg: "#fdf0c4", ink: "#8a5a00", pale: "#f3dd94" },
  shopping: { bg: "#fbe0ec", ink: "#b0386a", pale: "#f3c6da" },
  health: { bg: "#fde0e0", ink: "#b23a3a", pale: "#f4c4c4" },
  entertainment: { bg: "#ece2f8", ink: "#5c2d91", pale: "#dccbf0" },
  education: { bg: "#dfe6fb", ink: "#3446a8", pale: "#c6d1f3" },
  travel: { bg: "#d8f1f3", ink: "#11707a", pale: "#b9e2e6" },
  loan: { bg: "#e6e9ea", ink: "#4d5b60", pale: "#d3d8da" },
  other: { bg: "#ebeae4", ink: "#5a5e55", pale: "#d9d8cf" },
};

const ACCOUNT_TONES: Record<PaymentAccountType, Tone> = {
  mobile_banking: { bg: "#dde9f7", ink: "#1d5a96", pale: "#c7d8ec" },
  esewa: { bg: "#d9f1dd", ink: "#1f7a35", pale: "#bfe2c6" },
  khalti: { bg: "#ece2f8", ink: "#5c2d91", pale: "#dccbf0" },
  connect_ips: { bg: "#dcecf8", ink: "#1f6f9a", pale: "#c0dbef" },
  ime_pay: { bg: "#fde0e0", ink: "#b23a3a", pale: "#f4c4c4" },
  cash: { bg: "#e7f1d8", ink: "#4d7a1f", pale: "#d3e4bd" },
  other: { bg: "#ebeae4", ink: "#5a5e55", pale: "#d9d8cf" },
};

const ACCOUNT_ICONS: Record<PaymentAccountType, Icon> = {
  mobile_banking: Bank, esewa: Wallet, khalti: DeviceMobile, connect_ips: Bank, ime_pay: DeviceMobile, cash: Money, other: Wallet,
};

export function categoryTone(category: TransactionCategory, custom: readonly CustomCategory[] = []): Tone {
  const known = CATEGORY_TONES[category];
  if (known) return known;
  const color = getCategory(category, custom).color;
  return { bg: `color-mix(in srgb, ${color} 16%, white)`, ink: color, pale: `color-mix(in srgb, ${color} 28%, white)` };
}

/** Accounts saved as "other" often name a known wallet or bank; read the provider so they still get its colour. */
function effectiveType(account: Pick<PaymentAccount, "type"> & { provider?: string }): PaymentAccountType {
  if (account.type !== "other" || !account.provider) return account.type;
  const provider = account.provider.toLowerCase().replace(/[^a-z]/g, "");
  if (provider.includes("esewa")) return "esewa";
  if (provider.includes("khalti")) return "khalti";
  if (provider.includes("imepay")) return "ime_pay";
  if (provider.includes("connectips")) return "connect_ips";
  if (provider.includes("cash")) return "cash";
  if (provider.includes("bank") || provider.includes("finance")) return "mobile_banking";
  return "other";
}

/** The tone and icon for an account, or for the cash / not-set buckets that have no account row. */
export function accountLook(account: (Pick<PaymentAccount, "type"> & { provider?: string }) | null, bucket?: string): { tone: Tone; icon: Icon } {
  const type: PaymentAccountType | null = account ? effectiveType(account) : bucket === CASH_BUCKET ? "cash" : null;
  if (!type) return { tone: CATEGORY_TONES.other, icon: Question };
  return { tone: ACCOUNT_TONES[type], icon: ACCOUNT_ICONS[type] };
}
