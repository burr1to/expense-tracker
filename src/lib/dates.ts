import { endOfMonth, format, isWithinInterval, parseISO, startOfMonth } from "date-fns";

export function monthKey(date: Date): string {
  return format(date, "yyyy-MM");
}

export function isInMonth(dateString: string, month: Date): boolean {
  const date = parseISO(dateString);
  return isWithinInterval(date, { start: startOfMonth(month), end: endOfMonth(month) });
}

export function formatTransactionDate(dateString: string): string {
  return format(parseISO(dateString), "MMM d, yyyy");
}

export function toDateInput(date = new Date()): string {
  return format(date, "yyyy-MM-dd");
}
