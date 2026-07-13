import type { CurrencyCode } from "../types";

const locales: Record<CurrencyCode, string> = {
  NPR: "en-NP",
  USD: "en-US",
  AUD: "en-AU",
};

export function formatMoney(amountMinor: number, currency: CurrencyCode, compact = false): string {
  return new Intl.NumberFormat(locales[currency], {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    notation: compact ? "compact" : "standard",
  }).format(amountMinor / 100);
}

export function majorToMinor(value: string): number {
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}
