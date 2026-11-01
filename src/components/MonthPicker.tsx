import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { formatGregorianSpan, formatLedgerMonth } from "../lib/dates";
import { addMonthsToKey, currentMonthKey, isSameMonthKey, parseMonthKey, type PeriodKey } from "../lib/period";
import type { CalendarSystem } from "../types";

/**
 * Steps through months in the period's own calendar: in BS mode the arrows move
 * Bhadra -> Ashwin -> Kartik, and the Gregorian days that month covers sit
 * underneath. "Today" appears whenever another month is showing.
 */
export function MonthPicker({ period, onChange, calendarSystem }: { period: PeriodKey; onChange: (period: PeriodKey) => void; calendarSystem?: CalendarSystem }) {
  const system = calendarSystem ?? parseMonthKey(period).system;
  const current = currentMonthKey(parseMonthKey(period).system);
  const isCurrent = isSameMonthKey(period, current);
  const label = formatLedgerMonth(period, system);
  const isBs = parseMonthKey(period).system === "BS";
  // At the edge of the supported BS range there is no further month to step to.
  const step = (delta: number) => { try { onChange(addMonthsToKey(period, delta)); } catch { /* outside the supported range */ } };
  return (
    <div className="month-picker" role="group" aria-label={`Selected month: ${label}`}>
      <button className="icon-button" onClick={() => step(-1)} aria-label="Previous month"><CaretLeft size={18} /></button>
      <button className={isBs ? "month-label is-bs" : "month-label"} onClick={() => onChange(current)} title="Return to current month" aria-live="polite">
        {label}
        {isBs && <small>{formatGregorianSpan(period)}</small>}
      </button>
      <button className="icon-button" onClick={() => step(1)} aria-label="Next month"><CaretRight size={18} /></button>
      {!isCurrent && <button type="button" className="month-today-chip" onClick={() => onChange(current)} aria-label="Go to the current month">Today</button>}
    </div>
  );
}
