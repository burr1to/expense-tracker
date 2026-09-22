import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { CategoryDefinition, LedgerTransaction, PaymentAccount, PaymentMode, RecurrenceUnit, RecurringEntry, TransactionDraft, TransactionKind } from "../types";

const normalize = (value: string | null | undefined) => value?.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() ?? "";
const median = (values: readonly number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

export interface RecurringPatternSuggestion {
  id: string;
  kind: TransactionKind;
  category: string;
  amountMinor: number;
  paymentAccountId: string | null;
  note: string;
  recurrenceUnit: RecurrenceUnit;
  recurrenceInterval: number;
  startOn: string;
  evidenceCount: number;
  confidence: number;
}

function cadenceFor(gaps: readonly number[]) {
  const options: { unit: RecurrenceUnit; interval: number; minimum: number; maximum: number; target: number }[] = [
    { unit: "day", interval: 1, minimum: 1, maximum: 2, target: 1 },
    { unit: "week", interval: 1, minimum: 6, maximum: 8, target: 7 },
    { unit: "week", interval: 2, minimum: 12, maximum: 16, target: 14 },
    { unit: "month", interval: 1, minimum: 26, maximum: 35, target: 30 },
    { unit: "month", interval: 3, minimum: 78, maximum: 100, target: 91 },
    { unit: "year", interval: 1, minimum: 330, maximum: 400, target: 365 },
  ];
  return options
    .map((option) => ({ option, matches: gaps.filter((gap) => gap >= option.minimum && gap <= option.maximum).length }))
    .filter(({ matches }) => matches >= 2)
    .sort((left, right) => right.matches - left.matches || Math.abs(median(gaps) - left.option.target) - Math.abs(median(gaps) - right.option.target))[0] ?? null;
}

export function detectRecurringPatterns(transactions: readonly LedgerTransaction[], recurringEntries: readonly RecurringEntry[] = []): RecurringPatternSuggestion[] {
  const groups = new Map<string, LedgerTransaction[]>();
  for (const transaction of transactions) {
    const place = normalize(transaction.locationLabel || transaction.area);
    const description = place || normalize(transaction.note);
    if (!description) continue;
    const key = [transaction.kind, transaction.category, normalize(transaction.subcategory), description, transaction.paymentMode, transaction.paymentAccountId ?? ""].join("\u001f");
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }
  const suggestions: RecurringPatternSuggestion[] = [];
  for (const [id, entries] of groups) {
    if (entries.length < 3) continue;
    const sorted = [...entries].sort((left, right) => left.occurredOn.localeCompare(right.occurredOn));
    const gaps = sorted.slice(1).map((entry, index) => differenceInCalendarDays(parseISO(entry.occurredOn), parseISO(sorted[index].occurredOn)));
    const cadence = cadenceFor(gaps);
    if (!cadence) continue;
    const amountMinor = median(sorted.map((entry) => entry.amountMinor));
    const amountTolerance = Math.max(100, Math.round(amountMinor * 0.1));
    const stableAmounts = sorted.filter((entry) => Math.abs(entry.amountMinor - amountMinor) <= amountTolerance).length;
    if (stableAmounts < Math.ceil(sorted.length * 0.67)) continue;
    const latest = sorted.at(-1)!;
    const alreadyScheduled = recurringEntries.some((entry) => entry.active && entry.kind === latest.kind && entry.category === latest.category && entry.paymentAccountId === latest.paymentAccountId && entry.recurrenceUnit === cadence.option.unit && entry.recurrenceInterval === cadence.option.interval && Math.abs(entry.amountMinor - amountMinor) <= amountTolerance);
    if (alreadyScheduled) continue;
    suggestions.push({
      id,
      kind: latest.kind,
      category: latest.category,
      amountMinor,
      paymentAccountId: latest.paymentAccountId,
      note: latest.note || latest.locationLabel || latest.area || "Recurring transaction",
      recurrenceUnit: cadence.option.unit,
      recurrenceInterval: cadence.option.interval,
      startOn: format(addDays(parseISO(latest.occurredOn), cadence.option.target), "yyyy-MM-dd"),
      evidenceCount: entries.length,
      confidence: Math.min(0.98, Math.round(((cadence.matches / gaps.length) * 0.7 + (stableAmounts / entries.length) * 0.3) * 100) / 100),
    });
  }
  return suggestions.sort((left, right) => right.confidence - left.confidence || right.evidenceCount - left.evidenceCount).slice(0, 12);
}

export interface TransactionWarning {
  type: "duplicate" | "unusual";
  tone: "attention" | "warning";
  title: string;
  detail: string;
  transactionId?: string;
}

interface WarningDraft {
  kind: TransactionKind;
  category: string;
  amountMinor: number;
  occurredOn: string;
  note: string;
  area: string;
  paymentMode: TransactionDraft["paymentMode"];
  paymentAccountId: string;
}

export function transactionWarnings(draft: WarningDraft, transactions: readonly LedgerTransaction[], editingId?: string | null): TransactionWarning[] {
  if (!(draft.amountMinor > 0) || !draft.occurredOn) return [];
  const history = transactions.filter((transaction) => transaction.id !== editingId);
  const sameCore = history.filter((transaction) => transaction.kind === draft.kind && transaction.occurredOn === draft.occurredOn && transaction.amountMinor === draft.amountMinor && transaction.category === draft.category && transaction.paymentMode === draft.paymentMode && (transaction.paymentAccountId ?? "") === draft.paymentAccountId);
  const exact = sameCore.find((transaction) => normalize(transaction.note) === normalize(draft.note) && normalize(transaction.locationLabel || transaction.area) === normalize(draft.area));
  const duplicate = exact ?? sameCore[0];
  const warnings: TransactionWarning[] = [];
  if (duplicate) warnings.push({ type: "duplicate", tone: exact ? "warning" : "attention", title: exact ? "This may be a duplicate" : "A similar entry already exists", detail: exact ? "The date, amount, category, payment details, note, and place match an existing transaction." : "The date, amount, category, and payment details match an existing transaction.", transactionId: duplicate.id });

  if (draft.kind === "expense") {
    let comparison = history.filter((transaction) => transaction.kind === "expense" && transaction.category === draft.category);
    const sameAccount = comparison.filter((transaction) => (transaction.paymentAccountId ?? "") === draft.paymentAccountId);
    if (sameAccount.length >= 5) comparison = sameAccount;
    if (comparison.length >= 5) {
      const baseline = median(comparison.map((transaction) => transaction.amountMinor));
      const deviation = median(comparison.map((transaction) => Math.abs(transaction.amountMinor - baseline)));
      const threshold = baseline + Math.max(deviation * 3, Math.round(baseline * 0.5), 5000);
      if (draft.amountMinor > threshold) warnings.push({ type: "unusual", tone: "attention", title: "Higher than your usual category spend", detail: "This amount is well above your typical range for this category. Review it before saving." });
    }
  }
  return warnings;
}

export function countImportDuplicates(drafts: readonly TransactionDraft[], transactions: readonly LedgerTransaction[]) {
  const seen = new Set(transactions.map((transaction) => [transaction.kind, transaction.occurredOn, transaction.amountMinor, transaction.category, normalize(transaction.note), transaction.paymentMode, transaction.paymentAccountId ?? ""].join("\u001f")));
  let count = 0;
  for (const draft of drafts) {
    const amountMinor = Math.round(Number(draft.amount.replace(/,/g, "")) * 100);
    const key = [draft.kind, draft.occurredOn, amountMinor, draft.category, normalize(draft.note), draft.paymentMode, draft.paymentAccountId].join("\u001f");
    if (seen.has(key)) count += 1;
    seen.add(key);
  }
  return count;
}

const smallNumbers: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

function spokenNumber(words: string[]) {
  let total = 0;
  let current = 0;
  let used = false;
  for (const word of words) {
    if (word in smallNumbers) { current += smallNumbers[word]; used = true; }
    else if (word === "hundred") { current = Math.max(1, current) * 100; used = true; }
    else if (word === "thousand") { total += Math.max(1, current) * 1000; current = 0; used = true; }
    else if (word === "lakh") { total += Math.max(1, current) * 100_000; current = 0; used = true; }
    else break;
  }
  return used ? total + current : null;
}

export function parseVoiceTransaction(transcript: string, categories: readonly CategoryDefinition[], paymentAccounts: readonly PaymentAccount[], today = new Date()) {
  const normalized = normalize(transcript);
  const words = normalized.split(" ");
  const numeric = transcript.match(/(?:rs\.?|npr|rupees?)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i)?.[1]?.replaceAll(",", "");
  const wordAmount = spokenNumber(words.slice(0, Math.min(words.length, 8))) ?? spokenNumber(words.slice(1, Math.min(words.length, 9)));
  const amount = numeric && Number(numeric) > 0 ? numeric : wordAmount && wordAmount > 0 ? String(wordAmount) : undefined;
  const kind: TransactionKind = /\b(income|received|earned|salary|deposit)\b/.test(normalized) ? "income" : "expense";
  const availableCategories = categories.filter((category) => category.kind === kind || category.kind === "both");
  const category = availableCategories.find((candidate) => {
    const label = normalize(candidate.label);
    return normalized.includes(` ${normalize(candidate.id)} `) || normalized === normalize(candidate.id) || normalized.includes(label) || label.split(" ").some((token) => token.length > 3 && normalized.split(" ").includes(token));
  });
  const account = paymentAccounts.find((candidate) => [candidate.provider, candidate.label].filter(Boolean).some((value) => normalized.includes(normalize(value))));
  const paymentMode: PaymentMode | undefined = account || /\b(online|card|esewa|khalti|bank|wallet|mobile banking)\b/.test(normalized) ? "online" : /\bcheque|check\b/.test(normalized) ? "cheque" : /\bcash\b/.test(normalized) ? "cash" : undefined;
  const occurredOn = /\byesterday\b/.test(normalized) ? format(addDays(today, -1), "yyyy-MM-dd") : /\btoday\b/.test(normalized) ? format(today, "yyyy-MM-dd") : undefined;
  const placeMatch = transcript.match(/\b(?:at|in)\s+([\p{L}\p{N}][\p{L}\p{N} .'-]{1,60}?)(?=\s+(?:using|via|paid|with|cash|online|card|on|today|yesterday|for)\b|$)/iu);
  return {
    transcript: transcript.trim().slice(0, 80),
    amount,
    kind,
    category: category?.id,
    paymentMode,
    paymentAccountId: account?.id,
    occurredOn,
    area: placeMatch?.[1]?.trim(),
  };
}
