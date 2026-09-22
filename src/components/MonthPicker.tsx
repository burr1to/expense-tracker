import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { adToBs, bsMonthName } from "../lib/nepali-date";
import { currentMonthMarker, toDateInput } from "../lib/dates";
import type { CalendarSystem } from "../types";

/**
 * A Gregorian month rarely lines up with a Bikram Sambat one — it usually spans
 * two — so BS mode annotates the selected month with the BS months it covers
 * rather than pretending the two calendars share boundaries.
 */
function bikramSpan(month: Date): string | null {
  try {
    const first = adToBs(toDateInput(startOfMonth(month)));
    const last = adToBs(toDateInput(endOfMonth(month)));
    if (first.month === last.month && first.year === last.year) return `${bsMonthName(first.month)} ${first.year}`;
    const yearLabel = first.year === last.year ? `${first.year}` : `${first.year}/${String(last.year).slice(-2)}`;
    return `${bsMonthName(first.month)}–${bsMonthName(last.month)} ${yearLabel}`;
  } catch {
    return null;
  }
}

export function MonthPicker({ month, onChange, calendarSystem = "AD" }: { month: Date; onChange: (date: Date) => void; calendarSystem?: CalendarSystem }) {
  const span = calendarSystem === "BS" ? bikramSpan(month) : null;
  return (
    <div className="month-picker" aria-label="Selected month">
      <button className="icon-button" onClick={() => onChange(addMonths(month, -1))} aria-label="Previous month"><CaretLeft size={18} /></button>
      <button className="month-label" onClick={() => onChange(currentMonthMarker())} title="Return to current month">
        {format(month, "MMMM yyyy")}
        {span && <small>{span}</small>}
      </button>
      <button className="icon-button" onClick={() => onChange(addMonths(month, 1))} aria-label="Next month"><CaretRight size={18} /></button>
    </div>
  );
}
