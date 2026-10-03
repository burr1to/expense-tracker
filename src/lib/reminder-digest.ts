import type { DueItem, RecurringEntry } from "../types";

export interface ReminderNotice {
  id: string;
  title: string;
  body: string;
}

function shiftDate(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function money(amountMinor: number) {
  return (amountMinor / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dueRemainingMinor(item: Pick<DueItem, "amountMinor" | "payments">) {
  const paid = item.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  return Math.max(0, item.amountMinor - paid);
}

/**
 * Items that should leave the app today: overdue, due today, or due tomorrow.
 * Snoozed dues stay quiet until the snooze ends.
 */
export function buildReminderDigest(input: {
  dues: readonly DueItem[];
  recurring: readonly Pick<RecurringEntry, "id" | "active" | "kind" | "note" | "category" | "amountMinor" | "nextDueOn">[];
  today: string;
  categoryLabel?: (category: string) => string;
}): ReminderNotice[] {
  const tomorrow = shiftDate(input.today, 1);
  const label = input.categoryLabel ?? ((category: string) => category);
  const notices: ReminderNotice[] = [];

  for (const due of input.dues) {
    if (due.status !== "open") continue;
    if (due.snoozedUntil && due.snoozedUntil > input.today) continue;
    const remaining = dueRemainingMinor(due);
    if (!remaining) continue;
    const reminded = due.dueOn <= tomorrow || Boolean(due.remindOn && due.remindOn <= tomorrow);
    if (!reminded) continue;
    const when = due.dueOn < input.today ? "overdue" : due.dueOn === input.today ? "due today" : "due tomorrow";
    notices.push({
      id: `due:${due.id}`,
      title: due.title,
      body: `${due.person ? `${due.person} · ` : ""}${money(remaining)} ${when}`,
    });
  }

  for (const entry of input.recurring) {
    if (!entry.active || entry.nextDueOn > tomorrow) continue;
    const when = entry.nextDueOn < input.today ? "was due" : entry.nextDueOn === input.today ? "is due today" : "is due tomorrow";
    notices.push({
      id: `recurring:${entry.id}`,
      title: entry.note || label(entry.category),
      body: `${money(entry.amountMinor)} ${entry.kind} ${when}`,
    });
  }

  return notices;
}
