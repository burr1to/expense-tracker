import { CaretDown, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { addMonths, format } from "date-fns";

export function MonthPicker({ month, onChange }: { month: Date; onChange: (date: Date) => void }) {
  return (
    <div className="month-picker" aria-label="Selected month">
      <button className="icon-button" onClick={() => onChange(addMonths(month, -1))} aria-label="Previous month"><CaretLeft size={18} /></button>
      <button className="month-label" onClick={() => onChange(new Date())} title="Return to current month">
        {format(month, "MMMM yyyy")} <CaretDown size={18} weight="bold" />
      </button>
      <button className="icon-button" onClick={() => onChange(addMonths(month, 1))} aria-label="Next month"><CaretRight size={18} /></button>
    </div>
  );
}
