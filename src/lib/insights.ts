import { addMonths, differenceInCalendarDays, endOfMonth, format, getDay, isSameMonth, parseISO, startOfMonth } from "date-fns";
import { getCategory } from "./categories";
import { formatMoney } from "./currency";
import { summarizeLedger } from "./ledger";
import type { CurrencyCode, CustomCategory, Insight, LedgerTransaction } from "../types";

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function generateInsights(transactions: readonly LedgerTransaction[], month: Date, currency: CurrencyCode, customCategories: readonly CustomCategory[] = []): Insight[] {
  const current = transactions.filter((item) => isSameMonth(parseISO(item.occurredOn), month));
  const previousMonth = addMonths(month, -1);
  const previous = transactions.filter((item) => isSameMonth(parseISO(item.occurredOn), previousMonth));
  const summary = summarizeLedger(current);
  const previousSummary = summarizeLedger(previous);
  const insights: Insight[] = [];

  if (summary.categories[0]) {
    const top = summary.categories[0];
    insights.push({ id: "top-category", tone: "neutral", title: `${getCategory(top.category, customCategories).label} leads spending`, detail: `${top.percentage}% of this month’s expenses went there.` });
  }

  if (previousSummary.expenses > 0) {
    const change = Math.round(((summary.expenses - previousSummary.expenses) / previousSummary.expenses) * 100);
    insights.push({ id: "month-change", tone: change <= 0 ? "positive" : "attention", title: change <= 0 ? `Spending is down ${Math.abs(change)}%` : `Spending is up ${change}%`, detail: `Compared with ${format(previousMonth, "MMMM")}.` });
  }

  const byDay = new Map<number, number>();
  current.filter((item) => item.kind === "expense").forEach((item) => byDay.set(getDay(parseISO(item.occurredOn)), (byDay.get(getDay(parseISO(item.occurredOn))) ?? 0) + item.amountMinor));
  const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  if (busiest) insights.push({ id: "spend-day", tone: "neutral", title: `${dayNames[busiest[0]]} is your costliest day`, detail: `${formatMoney(busiest[1], currency)} has been logged on ${dayNames[busiest[0]]}s this month.` });

  if (summary.saved > 0) {
    const today = new Date();
    const elapsed = isSameMonth(today, month) ? Math.max(1, differenceInCalendarDays(today, startOfMonth(month)) + 1) : differenceInCalendarDays(endOfMonth(month), startOfMonth(month)) + 1;
    const days = differenceInCalendarDays(endOfMonth(month), startOfMonth(month)) + 1;
    const projected = Math.round(((summary.saved / elapsed) * days) / 100) * 100;
    insights.push({ id: "projection", tone: "positive", title: `On track to save ${formatMoney(projected, currency)}`, detail: "Projection based on your current daily pace." });
  }

  return insights.slice(0, 4);
}
