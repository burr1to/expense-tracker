import { countsAsIncomeOrSpending } from "./categories";
import { isCashAccount } from "./payment-accounts";
import { addDaysToIso, addMonthsToKey, daysBetweenIso, monthBounds, type PeriodKey } from "./period";
import type { LedgerTransaction, PaymentAccount, TransactionCategory } from "../types";

/** Entries with no account: cash entries go to the cash bucket, the rest to "not set". */
export const CASH_BUCKET = "cash";
export const UNASSIGNED_BUCKET = "unassigned";

export interface AccountSpend {
  /** A payment account id, or one of the buckets above. */
  key: string;
  account: PaymentAccount | null;
  currentMinor: number;
  previousMinor: number;
}

export interface CategorySpend {
  category: TransactionCategory;
  currentMinor: number;
  previousMinor: number;
}

export interface MonthComparison {
  /** First and last day counted this month (the last is today while the month is running). */
  start: string;
  through: string;
  /** The same number of days at the start of last month. */
  previousStart: string;
  previousThrough: string;
  /** Days counted this month; 0 for a month that has not started. */
  elapsedDays: number;
  daysInMonth: number;
  previousDaysInMonth: number;
  currentMinor: number;
  previousMinor: number;
  /** Running spend by day: this month up to `through`, last month for every day. */
  currentCumulative: number[];
  previousCumulative: number[];
  accounts: AccountSpend[];
  categories: CategorySpend[];
}

const isSpend = (transaction: LedgerTransaction) => transaction.kind === "expense" && countsAsIncomeOrSpending(transaction);

/** The account a spend belongs to. Cash entries with no account join the person's cash account when there is one. */
export function spendBucket(transaction: Pick<LedgerTransaction, "paymentAccountId" | "paymentMode">, accounts: readonly PaymentAccount[]): string {
  if (transaction.paymentAccountId && accounts.some((account) => account.id === transaction.paymentAccountId)) return transaction.paymentAccountId;
  if (transaction.paymentMode === "cash") return accounts.find(isCashAccount)?.id ?? CASH_BUCKET;
  return UNASSIGNED_BUCKET;
}

/**
 * Spending this month against the same days of last month: Nov 1–18 is compared with Oct 1–18,
 * so a half-finished month is never measured against a whole one. A finished month compares in full.
 */
export function compareMonthSpend(transactions: readonly LedgerTransaction[], accounts: readonly PaymentAccount[], period: PeriodKey, today: string): MonthComparison {
  const { start, endExclusive } = monthBounds(period);
  const previous = monthBounds(addMonthsToKey(period, -1));
  const daysInMonth = daysBetweenIso(start, endExclusive);
  const previousDaysInMonth = daysBetweenIso(previous.start, previous.endExclusive);
  const elapsedDays = today < start ? 0 : Math.min(daysInMonth, daysBetweenIso(start, today) + 1);
  const comparedDays = elapsedDays >= daysInMonth ? previousDaysInMonth : Math.min(elapsedDays, previousDaysInMonth);
  const through = addDaysToIso(start, Math.max(elapsedDays, 1) - 1);
  const previousThrough = addDaysToIso(previous.start, Math.max(comparedDays, 1) - 1);

  const currentDaily = new Array<number>(daysInMonth).fill(0);
  const previousDaily = new Array<number>(previousDaysInMonth).fill(0);
  const byAccount = new Map<string, AccountSpend>();
  const byCategory = new Map<string, CategorySpend>();
  let currentMinor = 0;
  let previousMinor = 0;

  const accountRow = (key: string) => {
    let row = byAccount.get(key);
    if (!row) {
      row = { key, account: accounts.find((account) => account.id === key) ?? null, currentMinor: 0, previousMinor: 0 };
      byAccount.set(key, row);
    }
    return row;
  };
  const categoryRow = (category: string) => {
    let row = byCategory.get(category);
    if (!row) {
      row = { category, currentMinor: 0, previousMinor: 0 };
      byCategory.set(category, row);
    }
    return row;
  };

  for (const transaction of transactions) {
    if (!isSpend(transaction)) continue;
    const day = transaction.occurredOn;
    if (day >= start && day < endExclusive) {
      currentDaily[daysBetweenIso(start, day)] += transaction.amountMinor;
      if (elapsedDays === 0 || day > through) continue;
      currentMinor += transaction.amountMinor;
      accountRow(spendBucket(transaction, accounts)).currentMinor += transaction.amountMinor;
      categoryRow(transaction.category).currentMinor += transaction.amountMinor;
    } else if (day >= previous.start && day < previous.endExclusive) {
      previousDaily[daysBetweenIso(previous.start, day)] += transaction.amountMinor;
      if (comparedDays === 0 || day > previousThrough) continue;
      previousMinor += transaction.amountMinor;
      accountRow(spendBucket(transaction, accounts)).previousMinor += transaction.amountMinor;
      categoryRow(transaction.category).previousMinor += transaction.amountMinor;
    }
  }

  const running = (daily: number[], length: number) => {
    let total = 0;
    return daily.slice(0, length).map((amount) => (total += amount));
  };

  // Every account shows, even with nothing spent yet, so a quiet account reads as zero rather than missing.
  for (const account of accounts) accountRow(account.id);

  return {
    start,
    through,
    previousStart: previous.start,
    previousThrough,
    elapsedDays,
    daysInMonth,
    previousDaysInMonth,
    currentMinor,
    previousMinor,
    currentCumulative: running(currentDaily, elapsedDays),
    previousCumulative: running(previousDaily, previousDaysInMonth),
    accounts: [...byAccount.values()].sort((a, b) => b.currentMinor - a.currentMinor || b.previousMinor - a.previousMinor),
    categories: [...byCategory.values()]
      .filter((row) => row.currentMinor !== row.previousMinor)
      .sort((a, b) => Math.abs(b.currentMinor - b.previousMinor) - Math.abs(a.currentMinor - a.previousMinor)),
  };
}

/** Whole days since the most recent entry was logged (by when it was saved, since entries are often logged later). */
export function daysSinceLastLogged(transactions: readonly Pick<LedgerTransaction, "createdAt">[], today: string, toDay: (instant: string) => string): number | null {
  let latest: string | null = null;
  for (const transaction of transactions) if (!latest || transaction.createdAt > latest) latest = transaction.createdAt;
  return latest ? Math.max(0, daysBetweenIso(toDay(latest), today)) : null;
}

export interface WeekSpend { firstDay: number; lastDay: number; currentMinor: number; previousMinor: number; /** False for weeks this month has not reached yet. */ started: boolean }

export interface AccountMonthDetail {
  comparison: MonthComparison;
  row: AccountSpend;
  /** Days 1–7, 8–14, 15–21, 22–end: this month so far against the same days last month. */
  weeks: WeekSpend[];
  categories: CategorySpend[];
  biggest: LedgerTransaction | null;
}

/** One account's month: the Home comparison narrowed to its bucket, by week and by category. */
export function accountMonthDetail(transactions: readonly LedgerTransaction[], accounts: readonly PaymentAccount[], bucket: string, period: PeriodKey, today: string): AccountMonthDetail {
  const mine = transactions.filter((transaction) => spendBucket(transaction, accounts) === bucket);
  const comparison = compareMonthSpend(mine, accounts, period, today);
  const row = comparison.accounts.find((item) => item.key === bucket) ?? { key: bucket, account: accounts.find((account) => account.id === bucket) ?? null, currentMinor: 0, previousMinor: 0 };
  const daily = (running: number[]) => running.map((value, index) => value - (index ? running[index - 1] : 0));
  const current = daily(comparison.currentCumulative);
  const previous = daily(comparison.previousCumulative);
  const sum = (values: number[], from: number, through: number) => values.slice(from - 1, through).reduce((total, value) => total + value, 0);
  // The last week runs to the month's end, and last month's to its own end, so no day is left out.
  const weeks: WeekSpend[] = [1, 8, 15, 22].map((firstDay, index, starts) => {
    const isLast = index === starts.length - 1;
    const lastDay = isLast ? comparison.daysInMonth : firstDay + 6;
    // A week still running compares only its days so far, like the month does.
    const running = comparison.elapsedDays >= firstDay && comparison.elapsedDays < lastDay;
    const previousThrough = running ? comparison.elapsedDays : isLast ? comparison.previousDaysInMonth : lastDay;
    return {
      firstDay,
      lastDay: running ? comparison.elapsedDays : lastDay,
      currentMinor: sum(current, firstDay, lastDay),
      previousMinor: sum(previous, firstDay, previousThrough),
      started: comparison.elapsedDays >= firstDay,
    };
  });
  const counted = (transaction: LedgerTransaction, from: string, through: string) => transaction.kind === "expense" && countsAsIncomeOrSpending(transaction) && transaction.occurredOn >= from && transaction.occurredOn <= through;
  let biggest: LedgerTransaction | null = null;
  const byCategory = new Map<string, CategorySpend>();
  const categoryRow = (category: string) => {
    const existing = byCategory.get(category);
    if (existing) return existing;
    const created = { category, currentMinor: 0, previousMinor: 0 };
    byCategory.set(category, created);
    return created;
  };
  for (const transaction of mine) {
    if (comparison.elapsedDays > 0 && counted(transaction, comparison.start, comparison.through)) {
      categoryRow(transaction.category).currentMinor += transaction.amountMinor;
      if (!biggest || transaction.amountMinor > biggest.amountMinor) biggest = transaction;
    } else if (comparison.elapsedDays > 0 && counted(transaction, comparison.previousStart, comparison.previousThrough)) {
      categoryRow(transaction.category).previousMinor += transaction.amountMinor;
    }
  }
  return {
    comparison,
    row,
    weeks,
    categories: [...byCategory.values()].filter((item) => item.currentMinor > 0).sort((a, b) => b.currentMinor - a.currentMinor),
    biggest,
  };
}
