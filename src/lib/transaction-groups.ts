import { formatLedgerDate } from "./dates";
import type { CalendarSystem, LedgerTransaction, TransactionGroup, TransactionGroupIconName } from "../types";

/** The most entries one add or remove may move; the server enforces the same cap. */
export const GROUP_ASSIGN_LIMIT = 500;

export const TRANSACTION_GROUP_ICONS: readonly { id: TransactionGroupIconName; label: string }[] = [
  { id: "trip", label: "Trip" },
  { id: "mountain", label: "Trek" },
  { id: "beach", label: "Holiday" },
  { id: "party", label: "Party" },
  { id: "festival", label: "Festival" },
  { id: "wedding", label: "Wedding" },
  { id: "home", label: "Home" },
  { id: "work", label: "Work" },
  { id: "gift", label: "Gifts" },
  { id: "health", label: "Health" },
  { id: "education", label: "Studies" },
  { id: "folder", label: "Other" },
];
export const TRANSACTION_GROUP_ICON_NAMES = TRANSACTION_GROUP_ICONS.map((icon) => icon.id) as [TransactionGroupIconName, ...TransactionGroupIconName[]];
export const groupIconLabel = (icon: string) => TRANSACTION_GROUP_ICONS.find((item) => item.id === icon)?.label ?? "Other";

export const GROUPS_HREF = "/transactions/groups";
export const groupHref = (id: string) => `${GROUPS_HREF}/${encodeURIComponent(id)}`;

export interface GroupSummary {
  count: number;
  spentMinor: number;
  receivedMinor: number;
  /** Received minus spent. */
  netMinor: number;
  /** Earliest and latest entry dates, null for an empty group. */
  firstOn: string | null;
  lastOn: string | null;
  /** Expense categories by amount, largest first. */
  categories: { category: string; amountMinor: number; count: number }[];
}

export function groupEntries(groupId: string, transactions: readonly LedgerTransaction[]) {
  return transactions.filter((entry) => entry.groupId === groupId);
}

export function summarizeGroup(entries: readonly LedgerTransaction[]): GroupSummary {
  const summary: GroupSummary = { count: entries.length, spentMinor: 0, receivedMinor: 0, netMinor: 0, firstOn: null, lastOn: null, categories: [] };
  const byCategory = new Map<string, { amountMinor: number; count: number }>();
  for (const entry of entries) {
    if (entry.kind === "expense") {
      summary.spentMinor += entry.amountMinor;
      const current = byCategory.get(entry.category) ?? { amountMinor: 0, count: 0 };
      byCategory.set(entry.category, { amountMinor: current.amountMinor + entry.amountMinor, count: current.count + 1 });
    } else summary.receivedMinor += entry.amountMinor;
    if (!summary.firstOn || entry.occurredOn < summary.firstOn) summary.firstOn = entry.occurredOn;
    if (!summary.lastOn || entry.occurredOn > summary.lastOn) summary.lastOn = entry.occurredOn;
  }
  summary.netMinor = summary.receivedMinor - summary.spentMinor;
  summary.categories = [...byCategory].map(([category, value]) => ({ category, ...value })).sort((a, b) => b.amountMinor - a.amountMinor || a.category.localeCompare(b.category));
  return summary;
}

/** The group's own dates when it has them, else the span of its entries. */
export function groupSpan(group: Pick<TransactionGroup, "startOn" | "endOn">, summary: Pick<GroupSummary, "firstOn" | "lastOn">) {
  if (group.startOn || group.endOn) return { from: group.startOn, to: group.endOn };
  return { from: summary.firstOn, to: summary.lastOn };
}

/** "Oct 12, 2026 – Oct 16, 2026", one date when both ends match, or null when there is nothing to show. */
export function groupDatesText(span: { from: string | null; to: string | null }, calendarSystem: CalendarSystem = "AD") {
  const from = span.from ? formatLedgerDate(span.from, calendarSystem) : null;
  const to = span.to ? formatLedgerDate(span.to, calendarSystem) : null;
  if (from && to) return from === to ? from : `${from} – ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return null;
}

/** Whether a date falls inside the group's dates; an open end is unbounded and a group with no dates matches everything. */
export function withinGroupDates(occurredOn: string, group: Pick<TransactionGroup, "startOn" | "endOn">) {
  return (!group.startOn || occurredOn >= group.startOn) && (!group.endOn || occurredOn <= group.endOn);
}

/** Groups whose dates cover this day, for suggesting one on a new entry. Undated groups never match. */
export function groupsCovering(occurredOn: string, groups: readonly TransactionGroup[]) {
  return groups.filter((group) => (group.startOn || group.endOn) && withinGroupDates(occurredOn, group));
}

/** Newest activity first: by the group's end (or its latest entry), then when it was made. */
export function sortGroups(groups: readonly TransactionGroup[], transactions: readonly LedgerTransaction[]) {
  const latest = new Map<string, string>();
  for (const entry of transactions) {
    if (!entry.groupId) continue;
    const current = latest.get(entry.groupId);
    if (!current || entry.occurredOn > current) latest.set(entry.groupId, entry.occurredOn);
  }
  const key = (group: TransactionGroup) => group.endOn ?? latest.get(group.id) ?? group.startOn ?? group.createdAt.slice(0, 10);
  return [...groups].sort((a, b) => key(b).localeCompare(key(a)) || b.createdAt.localeCompare(a.createdAt));
}

/** What stops a group form from saving, mirrored by the server. */
export function groupDraftError(draft: { name: string; startOn: string; endOn: string }): { field: "name" | "endOn"; message: string } | null {
  if (!draft.name.trim()) return { field: "name", message: "Give the group a name" };
  if (draft.startOn && draft.endOn && draft.endOn < draft.startOn) return { field: "endOn", message: "The end date is before the start date" };
  return null;
}
