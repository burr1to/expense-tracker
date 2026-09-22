/**
 * Offline parser for bank and wallet transaction alerts.
 *
 * Nepali banks and wallets have no public API, but they all send a confirmation
 * SMS. Those messages are far more structured than free text, so the common
 * cases are handled here with plain regex — instantly, offline, and without
 * sending anyone's financial messages to a third party. Only messages this
 * parser cannot read are offered to the Gemini fallback in `sms-analysis.ts`.
 *
 * Two layers:
 *
 *   1. `BANK_SMS_TEMPLATES` — provider-specific patterns. Add one per real
 *      sender format you have samples for. These win when they match and carry
 *      high confidence because the field positions are known exactly.
 *
 *   2. The generic parser — falls back to the grammar essentially every
 *      provider shares (a currency-tagged amount, a debit/credit word, an
 *      optional masked account, an optional balance). It is deliberately
 *      conservative: anything it is unsure about becomes `null` and lowers
 *      confidence rather than being guessed.
 *
 * Adding a bank should be a one-object change plus a test fixture, never a
 * change to the parsing code.
 */

import type { TransactionKind } from "../types";
import { isDateOnly, toDateOnly } from "./period";

export const SMS_MAX_LENGTH = 2_000;

export interface SmsParseResult {
  amountMinor: number;
  kind: TransactionKind;
  /** `YYYY-MM-DD`, or null when the message carried no readable date. */
  occurredOn: string | null;
  merchant: string | null;
  /** Masked account tail such as "1234", used to match a payment account. */
  accountTail: string | null;
  balanceMinor: number | null;
  provider: string | null;
  templateId: string;
  /** 0..1. Below `SMS_REVIEW_THRESHOLD` the UI should push harder for review. */
  confidence: number;
}

export interface BankSmsTemplate {
  id: string;
  provider: string;
  /** Named groups: amount, kind, merchant, date, tail, balance (all optional). */
  match: RegExp;
  /** Fixed direction when the pattern itself implies one. */
  kind?: TransactionKind;
  confidence: number;
}

export const SMS_REVIEW_THRESHOLD = 0.6;

/**
 * Provider-specific templates.
 *
 * This list intentionally ships empty. Populating it requires real message
 * samples per sender, and a plausible-but-wrong pattern would silently
 * mis-parse amounts — worse than falling through to the generic parser, which
 * reports low confidence when it is unsure. To add one, capture 10-20 real
 * messages from a provider (amounts redacted), write the pattern with named
 * groups, and add a fixture to `sms-templates.test.ts`.
 */
export const BANK_SMS_TEMPLATES: readonly BankSmsTemplate[] = [];

/* ------------------------------------------------------------------ */
/* Provider detection                                                   */
/* ------------------------------------------------------------------ */

const PROVIDER_KEYWORDS: ReadonlyArray<{ provider: string; pattern: RegExp }> = [
  { provider: "eSewa", pattern: /\besewa\b/i },
  { provider: "Khalti", pattern: /\bkhalti\b/i },
  { provider: "IME Pay", pattern: /\bime\s?pay\b/i },
  { provider: "ConnectIPS", pattern: /\bconnect\s?ips\b/i },
  { provider: "Fonepay", pattern: /\bfone\s?pay\b/i },
  { provider: "Nabil Bank", pattern: /\bnabil\b/i },
  { provider: "NIC Asia", pattern: /\bnic\s?asia\b/i },
  { provider: "Global IME", pattern: /\bglobal\s?ime\b/i },
  { provider: "Siddhartha Bank", pattern: /\bsiddhartha\b/i },
  { provider: "Machhapuchchhre Bank", pattern: /\bmachhapuchchhre\b/i },
  { provider: "Prabhu Bank", pattern: /\bprabhu\b/i },
  { provider: "Sanima Bank", pattern: /\bsanima\b/i },
  { provider: "Kumari Bank", pattern: /\bkumari\b/i },
  { provider: "Laxmi Sunrise", pattern: /\blaxmi\b|\bsunrise\b/i },
  { provider: "Standard Chartered", pattern: /\bstandard\s?chartered\b/i },
  { provider: "Himalayan Bank", pattern: /\bhimalayan\b/i },
  { provider: "Nepal Investment", pattern: /\bnepal\s?investment\b/i },
];

export function detectProvider(text: string): string | null {
  return PROVIDER_KEYWORDS.find((entry) => entry.pattern.test(text))?.provider ?? null;
}

/* ------------------------------------------------------------------ */
/* Field extraction                                                     */
/* ------------------------------------------------------------------ */

// "NPR 1,234.56" / "Rs. 1234" / "रू 1,234" — the currency tag is required so a
// bare reference number is never mistaken for an amount.
const AMOUNT = /(?:NPR|NRS|RS|₨|रू|रु)\.?\s*([\d,]+(?:\.\d{1,2})?)/i;
const BALANCE = /(?:bal(?:ance)?|avl\.?\s*bal|available\s*balance)[^\d]{0,20}(?:NPR|NRS|RS|₨|रू|रु)?\.?\s*([\d,]+(?:\.\d{1,2})?)/i;

const DEBIT_WORDS = /\b(debited|debit|withdraw(?:n|al)?|paid|payment|purchase|spent|transferred\s+to|sent\s+to|dr\b|charge[ds]?|deducted)\b/i;
const CREDIT_WORDS = /\b(credited|credit|deposit(?:ed)?|received|refund(?:ed)?|salary|cr\b|added|top(?:ped)?[\s-]?up)\b/i;

const ACCOUNT_TAIL = /(?:a\/c|acct?|account|card)[^\d]{0,12}(?:x+|\*+|\.+)?\s*(\d{3,4})\b/i;
const MERCHANT = /\b(?:at|to|from|for|info|remarks?|narration|towards)[:\s]+([A-Za-z0-9][A-Za-z0-9 .,'&/-]{1,60})/i;

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function toMinor(raw: string): number | null {
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/**
 * Nepali providers write day-first (`12/08/2026` is 12 August). That convention
 * is assumed rather than rejected as ambiguous: unlike a bulk statement import,
 * a single SMS draft is shown to the user with its date visible before anything
 * is saved, so review is the check. Month-first is tried only when day-first
 * produces an impossible date.
 */
export function extractSmsDate(text: string): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) {
    const candidate = toDateOnly({ year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) });
    return isValidCalendarDate(candidate) ? candidate : null;
  }

  const named = /\b(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{2,4})\b/.exec(text);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (month) {
      const candidate = toDateOnly({ year: expandYear(Number(named[3])), month, day: Number(named[1]) });
      return isValidCalendarDate(candidate) ? candidate : null;
    }
  }

  const numeric = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(text);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = expandYear(Number(numeric[3]));
    const dayFirst = toDateOnly({ year, month: second, day: first });
    if (isValidCalendarDate(dayFirst)) return dayFirst;
    const monthFirst = toDateOnly({ year, month: first, day: second });
    return isValidCalendarDate(monthFirst) ? monthFirst : null;
  }

  return null;
}

function expandYear(value: number): number {
  return value >= 100 ? value : 2000 + value;
}

function isValidCalendarDate(iso: string): boolean {
  if (!isDateOnly(iso)) return false;
  const [year, month, day] = iso.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Trailing clauses that follow a merchant name in the same run of text and
// must not be absorbed into it.
const MERCHANT_TAIL = /\s+(?:avl\.?|available|bal(?:ance)?|ref(?:erence)?|txn|transaction|info|remarks?|narration|card|a\/c|acct?|account|on|dated?)\b.*$/i;

function cleanMerchant(raw: string): string | null {
  const value = raw
    .replace(/\s+/g, " ")
    // A sentence boundary ends the merchant name.
    .split(/[.;]\s+/)[0]
    .replace(MERCHANT_TAIL, "")
    .replace(/[.,;:\-\s]+$/, "")
    .trim();
  if (value.length < 2) return null;
  // A pure number is a reference id, not a merchant.
  if (/^[\d\s.,-]+$/.test(value)) return null;
  return value.slice(0, 60);
}

/* ------------------------------------------------------------------ */
/* Parsing                                                              */
/* ------------------------------------------------------------------ */

export function matchSmsTemplate(text: string): BankSmsTemplate | null {
  return BANK_SMS_TEMPLATES.find((template) => template.match.test(text)) ?? null;
}

/**
 * Parses a bank or wallet alert. Returns null when the message has no
 * currency-tagged amount or no readable direction — those go to the AI
 * fallback rather than being guessed at.
 */
export function parseBankSms(text: string, today: string): SmsParseResult | null {
  const message = text.trim().slice(0, SMS_MAX_LENGTH);
  if (!message) return null;

  const template = matchSmsTemplate(message);
  if (template) {
    const groups = template.match.exec(message)?.groups ?? {};
    const amountMinor = groups.amount ? toMinor(groups.amount) : null;
    if (amountMinor) {
      return {
        amountMinor,
        kind: template.kind ?? directionOf(groups.kind ?? message) ?? "expense",
        occurredOn: groups.date && isValidCalendarDate(groups.date) ? groups.date : extractSmsDate(message) ?? today,
        merchant: groups.merchant ? cleanMerchant(groups.merchant) : null,
        accountTail: groups.tail ?? null,
        balanceMinor: groups.balance ? toMinor(groups.balance) : null,
        provider: template.provider,
        templateId: template.id,
        confidence: template.confidence,
      };
    }
  }

  const amountMatch = AMOUNT.exec(message);
  if (!amountMatch) return null;
  const amountMinor = toMinor(amountMatch[1]);
  if (!amountMinor) return null;

  const kind = directionOf(message);
  if (!kind) return null;

  const occurredOn = extractSmsDate(message);
  const merchantMatch = MERCHANT.exec(message);
  const merchant = merchantMatch ? cleanMerchant(merchantMatch[1]) : null;
  const tailMatch = ACCOUNT_TAIL.exec(message);
  const balanceMatch = BALANCE.exec(message);
  const provider = detectProvider(message);

  // Start from a modest base and pay for each field actually recovered, so a
  // sparse message never presents itself as a confident parse.
  let confidence = 0.5;
  if (occurredOn) confidence += 0.15;
  if (merchant) confidence += 0.15;
  if (provider) confidence += 0.1;
  if (tailMatch) confidence += 0.05;
  if (balanceMatch) confidence += 0.05;

  return {
    amountMinor,
    kind,
    occurredOn,
    merchant,
    accountTail: tailMatch?.[1] ?? null,
    balanceMinor: balanceMatch ? toMinor(balanceMatch[1]) : null,
    provider,
    templateId: "generic",
    confidence: Math.min(1, Number(confidence.toFixed(2))),
  };
}

function directionOf(text: string): TransactionKind | null {
  const debit = DEBIT_WORDS.exec(text);
  const credit = CREDIT_WORDS.exec(text);
  if (debit && credit) {
    // Both appear (e.g. "credited to merchant, debited from A/C"). The earlier
    // verb is the one describing this message's subject.
    return debit.index <= credit.index ? "expense" : "income";
  }
  if (debit) return "expense";
  if (credit) return "income";
  return null;
}
