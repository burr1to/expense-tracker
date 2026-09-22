/**
 * The Nepali fiscal year: Shrawan 1 to the last day of Ashadh, which is
 * roughly mid-July to mid-July in Gregorian terms. Salaries, taxes and
 * government reporting all run on it, so a Jan-Dec "year" summary does not
 * match anything a user in Nepal actually files against.
 *
 * Keys look like `FY:2083-84`, where 2083 is the Bikram Sambat year that
 * Shrawan 1 falls in. Importing this module registers the resolver with
 * `period.ts` so `periodBounds` understands fiscal keys.
 */

import { bsToAd, BS_FISCAL_START_MONTH, BS_MAX_YEAR, BS_MIN_YEAR } from "./nepali-date";
import { adToBs } from "./nepali-date";
import { registerPeriodResolver, type PeriodBounds, type PeriodKey } from "./period";

const FISCAL_KEY = /^FY:(\d{4})-(\d{2})$/;

export function isFiscalYearKey(key: string): boolean {
  const match = FISCAL_KEY.exec(key);
  if (!match) return false;
  const start = Number(match[1]);
  return Number(match[2]) === (start + 1) % 100;
}

export function formatFiscalYearKey(startBsYear: number): PeriodKey {
  return `FY:${startBsYear}-${String((startBsYear + 1) % 100).padStart(2, "0")}`;
}

export function parseFiscalYearKey(key: PeriodKey): number {
  if (!isFiscalYearKey(key)) throw new Error(`Invalid fiscal year key: ${key}`);
  return Number(FISCAL_KEY.exec(key)![1]);
}

/** The fiscal year a Gregorian date falls in. */
export function fiscalYearOf(iso: string): PeriodKey {
  const bs = adToBs(iso);
  const startYear = bs.month >= BS_FISCAL_START_MONTH ? bs.year : bs.year - 1;
  return formatFiscalYearKey(startYear);
}

export function fiscalYearBounds(key: PeriodKey): PeriodBounds {
  const startYear = parseFiscalYearKey(key);
  if (startYear < BS_MIN_YEAR || startYear + 1 > BS_MAX_YEAR) {
    throw new Error(`Fiscal year ${key} is outside the supported range.`);
  }
  return {
    start: bsToAd({ year: startYear, month: BS_FISCAL_START_MONTH, day: 1 }),
    endExclusive: bsToAd({ year: startYear + 1, month: BS_FISCAL_START_MONTH, day: 1 }),
  };
}

export function fiscalYearLabel(key: PeriodKey): string {
  const startYear = parseFiscalYearKey(key);
  return `FY ${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function addFiscalYears(key: PeriodKey, delta: number): PeriodKey {
  const next = parseFiscalYearKey(key) + Math.trunc(delta);
  if (next < BS_MIN_YEAR || next + 1 > BS_MAX_YEAR) {
    throw new Error(`Fiscal year ${next} is outside the supported range.`);
  }
  return formatFiscalYearKey(next);
}

registerPeriodResolver((key) => {
  if (!isFiscalYearKey(key)) throw new Error("Not a fiscal year key.");
  return fiscalYearBounds(key);
});
