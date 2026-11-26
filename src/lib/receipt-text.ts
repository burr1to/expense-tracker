import { bsToAd } from "./nepali-date";
import type { ReceiptAnalysis, ReceiptAnalysisCategory } from "./receipt-analysis";
import type { CurrencyCode } from "../types";

/**
 * Reads receipt text that Tesseract produced on the phone, with plain rules
 * and no AI. It only claims what the printed words support: the paid total,
 * the date and the shop name. Its confidence decides whether the review form
 * opens straight away, whether Gemini sees the text, or whether the user is
 * asked before the photo itself leaves the phone.
 */

export const RECEIPT_TEXT_MAX_LENGTH = 6_000;
/** Below this the text read is too thin to send to Gemini as text. */
export const RECEIPT_TEXT_MIN_SIGNAL = 30;
const LOCAL_MIN_CONFIDENCE = 0.75;
const LOCAL_MIN_OCR_CONFIDENCE = 60;
const TEXT_MIN_OCR_CONFIDENCE = 35;

export type ReceiptReadRoute = "device" | "text" | "photo";

export interface ParsedReceiptText {
  merchant: string | null;
  occurredOn: string | null;
  currency: CurrencyCode | "UNKNOWN";
  totalMinor: number | null;
  category: string | null;
  subcategory: string;
  /** 0–1: how far the rules trust the total they found. */
  confidence: number;
}

interface TotalCandidate { amountMinor: number; priority: number; line: number }

const AMOUNT = /(?<![\d.,])(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d,]*\d)(?:\s*\/-)?/g;
const NOT_A_TOTAL = /sub\s*-?\s*total|total\s*(?:qty|quantity|items?|no\.?\s*of|discount|disc|tax|vat|sav(?:ed|ings?)|weight|pcs|count)|no\.?\s*of\s*items|tender|change\s*(?:due|return)?\b|cash\s*(?:received|tendered)|round(?:ing)?\s*off|\brounding\b/i;
const TOTAL_RULES: ReadonlyArray<{ priority: number; pattern: RegExp }> = [
  { priority: 4, pattern: /grand\s*total|net\s*(?:total|amount|payable|amt)|total\s*(?:amount|amt|payable|due|bill)|amount\s*(?:payable|due)|bill\s*amount|total\s*(?:rs|npr|nrs)\b/i },
  { priority: 3, pattern: /amount\s*paid|paid\s*amount|total\s*paid/i },
  { priority: 2, pattern: /\btotal\b|\bttl\b/i },
];
const SUBTOTAL = /sub\s*-?\s*total/i;
const ADDITIONS = /\bvat\b|\btax\b|service\s*charge|\bs\.?\s*c\.?\b/i;
const DISCOUNT = /discount|\bdisc\b|less\b/i;
const PAID_ECHO = /tender|cash|paid|card|fonepay|esewa|khalti|qr|received|eftpos|visa|mastercard|debit|credit/i;
const CHANGE_BACK = /change|return|refund/i;
/** Lines that carry a number but are not a priced item. */
const NOT_AN_ITEM = /date|miti|time|bill\s*no|\bno\b|\bpan\b|\bvat\b|\babn\b|\btel\b|phone|rate|qty|@|total|discount|service|\btax\b|gst|%|paid|cash|card|change|return/i;
const MERCHANT_NOISE = /invoice|\bbill\b|receipt|\bpan\b|\bvat\b|\btel\b|phone|mobile|\bdate\b|cashier|counter|abbreviated|estimate|order|table|token|www\.|@|\bmiti\b|customer|\bno\b\s*[:.]/i;
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const DAY_MS = 86_400_000;

const CATEGORY_HINTS: ReadonlyArray<{ category: string; subcategory: string; pattern: RegExp }> = [
  { category: "transport", subcategory: "Fuel", pattern: /petrol|diesel|\bfuel\b|nepal oil|filling station|petroleum/i },
  { category: "health", subcategory: "Medicine", pattern: /pharmacy|pharma|medical hall|medicos?\b|chemist|drug store/i },
  { category: "health", subcategory: "Lab test", pattern: /diagnostic|patholog|laboratory/i },
  { category: "health", subcategory: "Doctor", pattern: /hospital|clinic|polyclinic/i },
  { category: "food", subcategory: "Groceries", pattern: /super\s*market|supermarket|grocery|groceries|\bmart\b|bhat-?bhateni|salesways|kirana|departmental store|fresh\s*mart/i },
  { category: "food", subcategory: "Cafe", pattern: /\bcaf[eé]\b|coffee|bakery|bakers|\btea\b|chiya/i },
  { category: "food", subcategory: "Restaurant", pattern: /restaurant|restro|resto\b|kitchen|\bmomo\b|khaja|dining|pizza|burger|biryani|thakali|\bbar\b|bistro|food\s*court/i },
  { category: "utilities", subcategory: "Internet", pattern: /worldlink|vianet|subisu|classic tech|internet/i },
  { category: "utilities", subcategory: "Electricity", pattern: /electricity authority|\bnea\b/i },
  { category: "entertainment", subcategory: "Movies", pattern: /cinema|\bqfx\b|movie|multiplex/i },
  { category: "education", subcategory: "Books", pattern: /book\s*(?:shop|store|house)|stationery|stationers/i },
  { category: "shopping", subcategory: "Electronics", pattern: /electronics|mobile (?:shop|store)|digital store/i },
  { category: "shopping", subcategory: "Clothing", pattern: /fashion|clothing|garments?|boutique|footwear|apparel/i },
];

function amountsIn(line: string): number[] {
  // OCR reads 0 as O inside numbers; fix only when digits surround it.
  const cleaned = line.replace(/(?<=\d)[Oo](?=[\d.,])|(?<=[\d.,])[Oo](?=\d)/g, "0");
  return [...cleaned.matchAll(AMOUNT)].map((match) => Math.round(Number(match[1].replace(/,/g, "")) * 100)).filter((value) => Number.isSafeInteger(value) && value > 0);
}

/** A line that is only a money value, as when OCR splits a "Total" row in two. */
function onlyAmount(line: string | undefined) {
  if (!line || !/^\s*(?:rs\.?|npr|nrs|रु\.?)?\s*[\d,]+(?:\.\d{1,2})?\s*(?:\/-)?\s*$/i.test(line)) return null;
  return amountsIn(line).at(-1) ?? null;
}

function findTotal(lines: readonly string[]): TotalCandidate | null {
  let best: TotalCandidate | null = null;
  for (const [index, line] of lines.entries()) {
    if (NOT_A_TOTAL.test(line)) continue;
    const rule = TOTAL_RULES.find(({ pattern }) => pattern.test(line));
    const amountMinor = rule ? amountsIn(line).at(-1) ?? onlyAmount(lines[index + 1]) : null;
    // Later lines win a tie: the total after VAT comes after the one before it.
    if (rule && amountMinor && (!best || rule.priority >= best.priority)) best = { amountMinor, priority: rule.priority, line: index };
  }
  return best;
}

/** Does the receipt's own arithmetic, or a payment line, agree with the total? */
function corroborated(lines: readonly string[], total: TotalCandidate) {
  const lineAmount = (pattern: RegExp, keep: (line: string) => boolean = () => true) => lines.reduce((sum, line) => (pattern.test(line) && keep(line) && !TOTAL_RULES[0].pattern.test(line) ? sum + (amountsIn(line).at(-1) ?? 0) : sum), 0);
  const subtotal = lines.map((line) => (SUBTOTAL.test(line) ? amountsIn(line).at(-1) ?? 0 : 0)).find(Boolean) ?? 0;
  if (subtotal) {
    // "VAT No. 600123456" is a registration number, not money.
    const additions = lineAmount(ADDITIONS, (line) => !SUBTOTAL.test(line) && !/\bno\b|number|reg/i.test(line) && !/%\s*$/.test(line));
    const discount = lineAmount(DISCOUNT);
    // Within Rs 1, for printed round-off.
    if ([subtotal, subtotal + additions, subtotal - discount, subtotal + additions - discount].some((candidate) => Math.abs(candidate - total.amountMinor) <= 100)) return true;
  }
  const near = (value: number) => Math.abs(value - total.amountMinor) <= 100;
  // Item prices above the total add up to it ("Americano 220, Muffin 110, Total 330").
  const items = lines.slice(0, total.line).filter((line) => /[A-Za-z]{2}/.test(line) && !NOT_AN_ITEM.test(line)).map((line) => amountsIn(line).at(-1) ?? 0);
  if (items.length >= 2 && near(items.reduce((sum, value) => sum + value, 0))) return true;
  const others = lines.filter((_, index) => index !== total.line);
  // A payment line repeats it, or paid minus change equals it ("Paid 500, Return 65").
  const paid = others.filter((line) => PAID_ECHO.test(line) && !CHANGE_BACK.test(line)).flatMap((line) => amountsIn(line));
  if (paid.includes(total.amountMinor)) return true;
  const change = others.filter((line) => CHANGE_BACK.test(line)).flatMap((line) => amountsIn(line).slice(-1));
  return paid.some((value) => change.some((back) => near(value - back)));
}

function validDate(year: number, month: number, day: number) {
  // Bikram Sambat months run to 32 days; Gregorian ones are checked below.
  if (month < 1 || month > 12 || day < 1 || day > 32) return null;
  if (year > 2060) {
    try {
      return bsToAd({ year, month, day });
    } catch {
      return null;
    }
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function datesIn(line: string): string[] {
  const found: string[] = [];
  for (const match of line.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    const date = validDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (date) found.push(date);
  }
  for (const match of line.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g)) {
    let [first, second] = [Number(match[1]), Number(match[2])];
    const short = match[3].length === 2 ? Number(match[3]) : null;
    // "83" is BS 2083 and "26" is AD 2026; validDate tells them apart by size.
    const year = short === null ? Number(match[3]) : 2000 + short;
    // Day first, as printed in Nepal and Australia, unless that cannot be a date.
    if (second > 12 && first <= 12) [first, second] = [second, first];
    const date = validDate(year, second, first);
    if (date) found.push(date);
  }
  for (const match of line.matchAll(/\b(\d{1,2})\s*[- ]?\s*([A-Za-z]{3,9})\.?,?\s*[- ]?\s*(\d{4})\b/g)) {
    const month = MONTHS[match[2].slice(0, 4).toLowerCase()] ?? MONTHS[match[2].slice(0, 3).toLowerCase()];
    const date = month ? validDate(Number(match[3]), month, Number(match[1])) : null;
    if (date) found.push(date);
  }
  for (const match of line.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const month = MONTHS[match[1].slice(0, 4).toLowerCase()] ?? MONTHS[match[1].slice(0, 3).toLowerCase()];
    const date = month ? validDate(Number(match[3]), month, Number(match[2])) : null;
    if (date) found.push(date);
  }
  return found;
}

/** The printed purchase date, if one is plausible: not in the future and within about a year. */
function findDate(lines: readonly string[], today: string) {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const plausible = (date: string) => {
    const at = Date.parse(`${date}T00:00:00Z`);
    return at <= todayMs + DAY_MS && at >= todayMs - 400 * DAY_MS;
  };
  const dated = lines.filter((line) => /date|miti|dt\b/i.test(line));
  for (const group of [dated, lines]) {
    const date = group.flatMap(datesIn).find(plausible);
    if (date) return date;
  }
  return null;
}

function titleCase(value: string) {
  if (/[a-z]/.test(value)) return value;
  return value.toLowerCase().replace(/(^|[\s\-&/(])([a-z])/g, (_, gap: string, letter: string) => gap + letter.toUpperCase());
}

/** The shop name is normally one of the first printed lines. */
function findMerchant(lines: readonly string[]) {
  for (const raw of lines.slice(0, 6)) {
    const line = raw.replace(/[|_~*=<>{}[\]"]+/g, " ").replace(/\s+/g, " ").trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.)&]+$/g, "");
    const letters = (line.match(/[A-Za-z]/g) ?? []).length;
    if (letters < 3 || letters / line.length < 0.6 || MERCHANT_NOISE.test(line)) continue;
    // OCR often spaces out hyphens: "Bhat -Bhateni".
    return titleCase(line.replace(/([A-Za-z])\s*-\s*([A-Za-z])/g, "$1-$2")).slice(0, 60);
  }
  return null;
}

function findCurrency(text: string): CurrencyCode | "UNKNOWN" {
  if (/\baud\b|\ba\$/i.test(text)) return "AUD";
  if (/\busd\b|\bus\$|\$\s*\d/i.test(text)) return "USD";
  if (/\brs\.?(?=\s|\d)|\bnpr\b|\bnrs\b|रु/i.test(text)) return "NPR";
  return "UNKNOWN";
}

function findCategory(text: string, categories: readonly ReceiptAnalysisCategory[]) {
  const available = new Map(categories.map((category) => [category.id, category]));
  for (const hint of CATEGORY_HINTS) {
    const category = available.get(hint.category);
    if (category && hint.pattern.test(text)) return { category: category.id, subcategory: category.subcategories.includes(hint.subcategory) ? hint.subcategory : "" };
  }
  return { category: null, subcategory: "" };
}

/** Control characters out, length capped: the text Gemini may see. */
export function cleanReceiptText(text: string) {
  const printable = [...text].filter((char) => {
    const code = char.charCodeAt(0);
    return char === "\n" || char === "\t" || (code > 0x1f && code !== 0x7f);
  }).join("");
  return printable.replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, RECEIPT_TEXT_MAX_LENGTH);
}

export function parseReceiptText(text: string, input: { today: string; categories: readonly ReceiptAnalysisCategory[] }): ParsedReceiptText {
  const cleaned = cleanReceiptText(text);
  const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
  const total = findTotal(lines);
  const merchant = findMerchant(lines);
  const occurredOn = findDate(lines, input.today);
  // The shop type is printed in the header; item lines ("tea", "soap bar") would mislead.
  const { category, subcategory } = findCategory(lines.slice(0, 8).join("\n"), input.categories);
  let confidence = 0;
  if (total) {
    confidence = total.priority === 4 ? 0.7 : total.priority === 3 ? 0.65 : 0.55;
    if (corroborated(lines, total)) confidence += 0.2;
    if (merchant) confidence += 0.05;
    if (occurredOn) confidence += 0.05;
  }
  return {
    merchant,
    occurredOn,
    currency: findCurrency(cleaned),
    totalMinor: total?.amountMinor ?? null,
    category,
    subcategory,
    confidence: Math.min(0.95, Math.round(confidence * 100) / 100),
  };
}

/** How much of the text is real characters rather than OCR speckle. */
function signal(text: string) {
  return (text.match(/[A-Za-z0-9]/g) ?? []).length;
}

/**
 * device: the rules found a well-supported total in a clean read.
 * text: the read is usable but the rules are unsure, so Gemini sees the words only.
 * photo: the read is too poor; the photo goes to Gemini only if the user agrees.
 */
export function chooseReceiptRoute(parsed: ParsedReceiptText, read: { text: string; ocrConfidence: number }): ReceiptReadRoute {
  if (parsed.totalMinor && parsed.confidence >= LOCAL_MIN_CONFIDENCE && read.ocrConfidence >= LOCAL_MIN_OCR_CONFIDENCE) return "device";
  // Text with no money in it is not a receipt read; don't send it anywhere without asking.
  if (signal(read.text) >= RECEIPT_TEXT_MIN_SIGNAL && read.ocrConfidence >= TEXT_MIN_OCR_CONFIDENCE && amountsIn(read.text).length > 0) return "text";
  return "photo";
}

/** The rules' reading as the same review shape Gemini returns: one split for the whole total. */
export function localReceiptAnalysis(parsed: ParsedReceiptText, input: { fallbackOccurredOn: string; categories: readonly ReceiptAnalysisCategory[] }): ReceiptAnalysis {
  if (!parsed.totalMinor) throw new Error("No receipt total was found.");
  const fallbackCategory = input.categories.some((category) => category.id === "other") ? "other" : input.categories[0].id;
  const category = parsed.category ?? fallbackCategory;
  const warnings = ["Read on this phone without AI, as one split. Check the total, and add splits if you need them."];
  if (!parsed.category) warnings.push("Choose a category for this receipt.");
  if (!parsed.occurredOn) warnings.push("No date was found on the receipt, so today’s date is used.");
  return {
    merchant: parsed.merchant ?? "",
    occurredOn: parsed.occurredOn ?? input.fallbackOccurredOn,
    currency: parsed.currency,
    totalMinor: parsed.totalMinor,
    splits: [{ label: parsed.subcategory || (parsed.category ? input.categories.find((item) => item.id === category)?.label ?? "Receipt" : "Receipt"), amountMinor: parsed.totalMinor, category, subcategory: parsed.subcategory, confidence: parsed.category ? parsed.confidence : 0 }],
    warnings,
    confidence: parsed.confidence,
  };
}
