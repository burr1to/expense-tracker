import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { addMonths, format } from "date-fns";
import { currentMonthMarker, formatLedgerMonth } from "../lib/dates";
import type { CalendarSystem } from "../types";

/**
 * A Gregorian month rarely lines up with a Bikram Sambat one — it usually spans
 * two — so BS mode leads with the BS months that month covers and keeps the
 * Gregorian name underneath. Stepping still moves one Gregorian month, because
 * budgets and bank statements are stored that way.
 */
export function MonthPicker({ month, onChange, calendarSystem = "AD" }: { month: Date; onChange: (date: Date) => void; calendarSystem?: CalendarSystem }) {
  const gregorian = format(month, "MMMM yyyy");
  const bsLabel = calendarSystem === "BS" ? formatLedgerMonth(month, "BS") : null;
  const leading = bsLabel && bsLabel !== gregorian ? bsLabel : gregorian;
  return (
    <div className="month-picker" aria-label="Selected month">
      <button className="icon-button" onClick={() => onChange(addMonths(month, -1))} aria-label="Previous month"><CaretLeft size={18} /></button>
      <button className={leading === gregorian ? "month-label" : "month-label is-bs"} onClick={() => onChange(currentMonthMarker())} title="Return to current month">
        {leading}
        {leading !== gregorian && <small>{gregorian}</small>}
      </button>
      <button className="icon-button" onClick={() => onChange(addMonths(month, 1))} aria-label="Next month"><CaretRight size={18} /></button>
    </div>
  );
}
