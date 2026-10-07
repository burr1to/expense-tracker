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

/** Why a message looks like money moving between the user's own accounts. */
export type SmsTransferHint = "atm" | "wallet_load" | "own_account";

/** Everything read from a message apart from its amount and direction. */
export interface SmsHints {
  merchant: string | null;
  /** True only when the merchant followed "at" and reads like a place, so it may fill the area. */
  merchantIsPlace: boolean;
  /** Masked account tail such as "1234", used to match a payment account. */
  accountTail: string | null;
  /** The bank or wallet the message is about, read outside the merchant text. */
  provider: string | null;
  /** A different bank or wallet named anywhere in the message (e.g. the wallet being loaded). */
  otherProvider: string | null;
  transferHint: SmsTransferHint | null;
  mentionsSalary: boolean;
}

export interface SmsParseResult extends SmsHints {
  amountMinor: number;
  kind: TransactionKind;
  /** `YYYY-MM-DD`, or null when the message carried no readable date. */
  occurredOn: string | null;
  balanceMinor: number | null;
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
  { provider: "Prabhu Bank", pattern: /\bprabhu\s?bank\b/i },
  { provider: "Sanima Bank", pattern: /\bsanima\b/i },
  { provider: "Kumari Bank", pattern: /\bkumari\s?bank\b/i },
  { provider: "Laxmi Sunrise", pattern: /\blaxmi\b|\bsunrise\s?bank\b/i },
  { provider: "Standard Chartered", pattern: /\bstandard\s?chartered\b/i },
  // Bare "Himalayan" is a common shop name (Himalayan Java), so the bank needs its suffix.
  { provider: "Himalayan Bank", pattern: /\bhimalayan\s?bank\b|\bhbl\b/i },
  { provider: "Nepal Investment", pattern: /\bnepal\s?investment\b|\bnimb\b/i },
  { provider: "Everest Bank", pattern: /\beverest\s?bank\b/i },
  { provider: "NMB Bank", pattern: /\bnmb\b/i },
  { provider: "Citizens Bank", pattern: /\bcitizens\s?bank\b/i },
  { provider: "Prime Commercial Bank", pattern: /\bprime\s?(?:commercial\s?)?bank\b/i },
  { provider: "Nepal SBI", pattern: /\bnepal\s?sbi\b/i },
  { provider: "Rastriya Banijya Bank", pattern: /\brastriya\s?banijya\b|\brbb\b/i },
  { provider: "Agriculture Development Bank", pattern: /\bagricultur(?:e|al)\s?development\b|\badbl\b/i },
  { provider: "Nepal Bank", pattern: /\bnepal\s?bank\b/i },
  { provider: "Muktinath Bikas Bank", pattern: /\bmuktinath\b/i },
  { provider: "Garima Bikas Bank", pattern: /\bgarima\b/i },
  { provider: "Mahalaxmi Bikas Bank", pattern: /\bmahalaxmi\b/i },
  { provider: "Kamana Sewa Bikas Bank", pattern: /\bkamana\s?sewa\b/i },
];

export function detectProvider(text: string): string | null {
  return detectProviders(text)[0] ?? null;
}

/** Every known bank or wallet named in the text, in the order they appear. */
export function detectProviders(text: string): string[] {
  return PROVIDER_KEYWORDS
    .map((entry) => ({ provider: entry.provider, index: entry.pattern.exec(text)?.index ?? -1 }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.provider)
    .filter((provider, index, all) => all.indexOf(provider) === index);
}

const WALLET_PROVIDERS = new Set(["eSewa", "Khalti", "IME Pay"]);

export function isWalletProvider(provider: string) {
  return WALLET_PROVIDERS.has(provider);
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

// "A/C XXXXXX4821", "A/C 0010XXXXXX1234", "A/C ###1234", "card ending 1234".
const ACCOUNT_TAIL = /(?:a\/c|acct?|account|card)[^\d]{0,12}(?:\d{0,8}(?:x{2,}|[*#•]{2,}|\.{2,})\s?)?(\d{3,4})(?!\d)/i;
// A masked number with no account word before it: "12XXXXXX4821".
const MASKED_ACCOUNT = /(?<![A-Za-z\d])\d{0,8}(?:[xX]{2,}|[*#•]{2,})(\d{4})(?!\d)/;
const MERCHANT = /\b(at|to|from|for|info|remarks?|narration|towards)[:\s]+([A-Za-z0-9][A-Za-z0-9 .,'&/-]{1,60})/gi;

const ATM_WORDS = /\b(?:atm|cash\s+withdrawal)\b/i;
const WALLET_NAME = String.raw`(?:e-?sewa|khalti|ime\s?pay)`;
const WALLET_LOAD = new RegExp([
  String.raw`\b${WALLET_NAME}\s+(?:wallet\s+)?(?:fund\s+)?(?:load|top[\s-]?up)`,
  String.raw`\b(?:load(?:ed)?|top(?:ped)?[\s-]?up)\s+(?:(?:to|of|in|into)\s+)?(?:your\s+)?${WALLET_NAME}\b`,
  String.raw`\b(?:added|credited|loaded)\s+(?:to|in|into)\s+your\s+${WALLET_NAME}\s+wallet\b`,
].join("|"), "i");
const OWN_TRANSFER = /\bself[\s-]?transfer\b|\b(?:to|into)\s+(?:your\s+)?own\s+(?:a\/c|acct?|account)\b|\bown\s+account\s+transfer\b/i;
const SALARY_WORDS = /\b(?:salary|payroll)\b/i;

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
    .replace(/^(?:qr\s+)?payment\s+to\s+/i, "")
    .replace(MERCHANT_TAIL, "")
    // "Nepal Telecom via Khalti" names the payee, then the rail.
    .replace(/\s+via\s+.*$/i, "")
    // "98XXXXXX12 from your eSewa wallet" names the payee, then the source.
    .replace(/\s+(?:from|to)\s+(?:your|a\/c|acct?|account)\b.*$/i, "")
    .replace(/[.,;:\-\s]+$/, "")
    .trim();
  if (value.length < 2) return null;
  // A pure number is a reference id, not a merchant.
  if (/^[\d\s.,-]+$/.test(value)) return null;
  // A masked phone or account number is not a merchant either.
  if (/^\+?[\dxX*#•\s-]*[xX*#•]{2,}[\dxX*#•\s-]*$/.test(value)) return null;
  // "your A/C", "your eSewa wallet", "A/C XXXX1234" describe the user's own money.
  if (/^(?:your|you|yours|my)\b/i.test(value) || /^(?:a\/c|acct?|account|card)\b/i.test(value) || /\bwallet\b/i.test(value)) return null;
  // "Thank you for using Khalti" is a sign-off naming the sender, not a payee.
  if (/^using\b/i.test(value)) return null;
  return value.slice(0, 60);
}

/** The first keyword-led phrase that survives cleaning. A rejected phrase is skipped, not fatal. */
function extractMerchant(message: string): { merchant: string; keyword: string } | null {
  const pattern = new RegExp(MERCHANT.source, MERCHANT.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(message))) {
    const merchant = cleanMerchant(match[2]);
    if (merchant) return { merchant, keyword: match[1].toLowerCase() };
    // Resume right after the keyword so a later "at ATM KTM" inside a rejected phrase is still seen.
    pattern.lastIndex = match.index + match[1].length;
  }
  return null;
}

function looksLikePlace(merchant: string) {
  return /[A-Za-z]{3}/.test(merchant) && !/\b(?:atm|pos|qr)\b/i.test(merchant) && detectProviders(merchant).length === 0;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractAccountTail(message: string) {
  return ACCOUNT_TAIL.exec(message)?.[1] ?? MASKED_ACCOUNT.exec(message)?.[1] ?? null;
}

/**
 * Reads everything but the amount and direction. The provider is read only
 * outside the merchant text, so "at HIMALAYAN JAVA" or "for eSewa load" never
 * decides which of the user's accounts the message is about.
 */
export function readSmsHints(text: string, kind: TransactionKind | null = null): SmsHints {
  const message = text.trim().slice(0, SMS_MAX_LENGTH);
  const found = extractMerchant(message);
  const merchant = found?.merchant ?? null;
  const outside = merchant ? message.replace(new RegExp(escapeRegExp(merchant).replace(/ /g, "\\s+"), "i"), (span) => " ".repeat(span.length)) : message;
  const provider = detectProviders(outside)[0] ?? null;
  const otherProvider = detectProviders(message).find((name) => name !== provider) ?? null;
  const direction = kind ?? directionOf(message);
  let transferHint: SmsTransferHint | null = null;
  if (WALLET_LOAD.test(message) && [provider, otherProvider].some((name) => name && WALLET_PROVIDERS.has(name))) transferHint = "wallet_load";
  else if (direction === "expense" && ATM_WORDS.test(message)) transferHint = "atm";
  else if (OWN_TRANSFER.test(message)) transferHint = "own_account";
  return {
    merchant,
    merchantIsPlace: Boolean(merchant && found?.keyword === "at" && looksLikePlace(merchant)),
    accountTail: extractAccountTail(message),
    provider,
    otherProvider,
    transferHint,
    mentionsSalary: SALARY_WORDS.test(message),
  };
}

/* ------------------------------------------------------------------ */
/* Parsing                                                              */
/* ------------------------------------------------------------------ */

/**
 * True when the text carries a currency-tagged amount, the least a transaction
 * alert has. Text pasted straight from the clipboard is only read (and possibly
 * sent to Gemini) when it passes this, so an OTP or password is never sent.
 */
export function mentionsCurrencyAmount(text: string) {
  return AMOUNT.test(text.slice(0, SMS_MAX_LENGTH));
}

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
      const kind = template.kind ?? directionOf(groups.kind ?? message) ?? "expense";
      const hints = readSmsHints(message, kind);
      const merchant = groups.merchant ? cleanMerchant(groups.merchant) : null;
      return {
        ...hints,
        amountMinor,
        kind,
        occurredOn: groups.date && isValidCalendarDate(groups.date) ? groups.date : extractSmsDate(message) ?? today,
        merchant,
        merchantIsPlace: Boolean(merchant && hints.merchant === merchant && hints.merchantIsPlace),
        accountTail: groups.tail ?? hints.accountTail,
        balanceMinor: groups.balance ? toMinor(groups.balance) : null,
        provider: template.provider,
        otherProvider: hints.otherProvider === template.provider ? hints.provider : hints.otherProvider,
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
  const hints = readSmsHints(message, kind);
  const balanceMatch = BALANCE.exec(message);

  // Start from a modest base and pay for each field actually recovered, so a
  // sparse message never presents itself as a confident parse.
  let confidence = 0.5;
  if (occurredOn) confidence += 0.15;
  if (hints.merchant) confidence += 0.15;
  if (hints.provider || hints.otherProvider) confidence += 0.1;
  if (hints.accountTail) confidence += 0.05;
  if (balanceMatch) confidence += 0.05;

  return {
    ...hints,
    amountMinor,
    kind,
    occurredOn,
    balanceMinor: balanceMatch ? toMinor(balanceMatch[1]) : null,
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
