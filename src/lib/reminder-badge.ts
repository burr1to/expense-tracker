import { urgentDueCount } from "./dues";
import type { DueItem } from "../types";

/**
 * Money reminders that need attention today: dues that are overdue or due
 * today, plus active recurring entries whose next occurrence has arrived. The
 * bell's filled icon, its badge, its panel header and the folded phone toggle
 * all show this one number, so they never disagree.
 */
export function urgentReminderCount(dues: readonly DueItem[], recurring: readonly { dueOn: string; active?: boolean }[], today: string): number {
  return urgentDueCount(dues, today) + recurring.filter((item) => item.active !== false && item.dueOn <= today).length;
}

/** "3", or "9+" once the badge would outgrow its circle; empty for zero. */
export function reminderBadgeText(count: number): string {
  if (count <= 0) return "";
  return count > 9 ? "9+" : String(count);
}
