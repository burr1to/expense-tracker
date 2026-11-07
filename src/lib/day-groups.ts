import { addDays, differenceInCalendarDays, format } from "date-fns";
import { localDate, toDateInput } from "./dates";
import type { LedgerActivityItem } from "./transaction-history";

export interface LedgerDayGroup {
  dayKey: string;
  items: LedgerActivityItem[];
  /** Expenses only. Transfers move money between your own accounts, so they are not spending. */
  spentMinor: number;
  earnedMinor: number;
  movedMinor: number;
}

const occurredOn = (item: LedgerActivityItem) => item.type === "transaction" ? item.transaction.occurredOn : item.transfer.occurredOn;

/** Consecutive same-day entries of an already newest-first list, in the same order. */
export function groupLedgerActivityByDay(items: readonly LedgerActivityItem[]): LedgerDayGroup[] {
  const groups: LedgerDayGroup[] = [];
  for (const item of items) {
    const dayKey = occurredOn(item);
    let group = groups.at(-1);
    if (group?.dayKey !== dayKey) {
      group = { dayKey, items: [], spentMinor: 0, earnedMinor: 0, movedMinor: 0 };
      groups.push(group);
    }
    group.items.push(item);
    if (item.type === "transfer") group.movedMinor += item.transfer.amountMinor;
    else if (item.transaction.kind === "income") group.earnedMinor += item.transaction.amountMinor;
    else group.spentMinor += item.transaction.amountMinor;
  }
  return groups;
}

/** Whole days until at least `minEntries` entries are showing, so "Load more" never splits a day. */
export function takeWholeDays(groups: readonly LedgerDayGroup[], minEntries: number): LedgerDayGroup[] {
  const taken: LedgerDayGroup[] = [];
  let count = 0;
  for (const group of groups) {
    if (count >= minEntries) break;
    taken.push(group);
    count += group.items.length;
  }
  return taken;
}

/** "Today", "Yesterday", then the weekday name; the full date goes beside it. */
export function dayGroupLabel(dayKey: string, today: string): string {
  if (dayKey === today) return "Today";
  if (dayKey === toDateInput(addDays(localDate(today), -1))) return "Yesterday";
  const day = localDate(dayKey);
  const age = differenceInCalendarDays(localDate(today), day);
  return age > 0 && age < 7 ? format(day, "EEEE") : format(day, "EEE");
}
