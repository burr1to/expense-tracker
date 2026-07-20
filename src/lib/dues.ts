import { differenceInCalendarDays, format, parseISO } from "date-fns";
import type { DueItem } from "../types";

export type DueUrgency = "overdue" | "today" | "later";

export function duePaid(item: DueItem) {
  return item.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
}

export function dueRemaining(item: DueItem) {
  return Math.max(0, item.amountMinor - duePaid(item));
}

export function actionableDues(items: readonly DueItem[], today = format(new Date(), "yyyy-MM-dd")) {
  return items
    .filter((item) =>
      item.status === "open"
      && (!item.snoozedUntil || item.snoozedUntil <= today)
      && (item.dueOn <= today || Boolean(item.remindOn && item.remindOn <= today))
    )
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

export function dueUrgency(item: DueItem, today = format(new Date(), "yyyy-MM-dd")): DueUrgency {
  if (item.dueOn < today) return "overdue";
  if (item.dueOn === today) return "today";
  return "later";
}

export function groupActionableDues(items: readonly DueItem[], today = format(new Date(), "yyyy-MM-dd")) {
  const groups: Record<DueUrgency, DueItem[]> = { overdue: [], today: [], later: [] };
  for (const item of actionableDues(items, today)) groups[dueUrgency(item, today)].push(item);
  return groups;
}

export function urgentDueCount(items: readonly DueItem[], today = format(new Date(), "yyyy-MM-dd")) {
  return actionableDues(items, today).filter((item) => dueUrgency(item, today) !== "later").length;
}

export function dueDateLabel(dueOn: string, today = new Date()) {
  const days = differenceInCalendarDays(parseISO(dueOn), today);
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 7) return `Due in ${days} days`;
  return `Due ${format(parseISO(dueOn), "MMM d")}`;
}
