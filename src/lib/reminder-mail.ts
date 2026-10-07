import { CATEGORIES } from "./categories";
import { todayInput } from "./dates";
import { asDate, dateOnly } from "./ledger-snapshot";
import { escapeHtml, sendLedgerEmail } from "./outbound-mail";
import { getPrisma } from "./prisma";
import { buildReminderDigest, type ReminderNotice } from "./reminder-digest";
import type { CurrencyCode, DueItem } from "../types";

/** What happened to one person's daily reminder email. */
export type ReminderEmailResult = "sent" | "nothing-due" | "already-sent" | "off" | "unconfigured" | "failed";

const CURRENCIES: readonly CurrencyCode[] = ["NPR", "USD", "AUD"];

/** Whether reminder mail can leave the server at all (development only logs it). */
export function reminderEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.AUTH_EMAIL_FROM) || process.env.NODE_ENV === "development";
}

export function reminderEmailHtml(notices: readonly ReminderNotice[], appUrl?: string | null) {
  const open = appUrl ? `<p><a href="${escapeHtml(appUrl.replace(/\/$/, ""))}/">Open SaveYoRupee</a></p>` : "";
  return `<p>Here is what is due today or tomorrow in SaveYoRupee.</p><ul>${notices.map((notice) => `<li><strong>${escapeHtml(notice.title)}</strong> — ${escapeHtml(notice.body)}</li>`).join("")}</ul>${open}<p style="color:#5c6e63;font-size:13px">You get this because email reminders are on in Profile → Reminders.</p>`;
}

/**
 * Builds and sends one person's reminder digest for `today` (Kathmandu), at most once a day.
 * The day is recorded only after the email went out (or there was nothing to send), so a failed
 * or unconfigured send is retried by the next trigger: the morning cron or the first app open.
 */
export async function sendReminderEmail(userId: string, options: { today?: string; appUrl?: string | null } = {}): Promise<ReminderEmailResult> {
  const db = getPrisma();
  const today = options.today ?? todayInput();
  const me = await db.user.findUnique({ where: { id: userId }, select: { email: true, emailReminders: true, lastReminderEmailOn: true, currency: true } });
  if (!me?.emailReminders) return "off";
  if (dateOnly(me.lastReminderEmailOn) === today) return "already-sent";
  const [dues, recurring, customCategories] = await Promise.all([
    db.dueItem.findMany({ where: { userId, status: "open" }, include: { payments: { select: { amountMinor: true } } } }),
    db.recurringEntry.findMany({ where: { userId, active: true } }),
    db.customCategory.findMany({ where: { userId }, select: { id: true, name: true } }),
  ]);
  const currency = CURRENCIES.find((code) => code === me.currency) ?? "NPR";
  const notices = buildReminderDigest({
    today,
    currency,
    categoryLabel: (category) => CATEGORIES.find((item) => item.id === category)?.label ?? customCategories.find((item) => item.id === category)?.name ?? "Recurring entry",
    dues: dues.map((item): DueItem => ({
      id: item.id,
      userId,
      kind: item.kind as DueItem["kind"],
      title: item.title,
      person: item.person,
      amountMinor: item.amountMinor,
      category: item.category,
      occurredOn: dateOnly(item.occurredOn),
      dueOn: dateOnly(item.dueOn)!,
      remindOn: dateOnly(item.remindOn),
      snoozedUntil: dateOnly(item.snoozedUntil),
      note: item.note,
      status: item.status as DueItem["status"],
      annualRatePercent: item.annualRatePercent,
      completedOn: dateOnly(item.completedOn),
      createdAt: item.createdAt.toISOString(),
      payments: item.payments.map((payment, index) => ({ id: `${item.id}-${index}`, userId, dueItemId: item.id, amountMinor: payment.amountMinor, occurredOn: today, note: "", transactionId: null, createdAt: item.createdAt.toISOString() })),
    })),
    recurring: recurring.flatMap((item) => {
      const nextDueOn = dateOnly(item.nextDueOn);
      if (!nextDueOn) return [];
      return [{ id: item.id, active: item.active, kind: item.kind as "income" | "expense", note: item.note, category: item.category, amountMinor: item.amountMinor, nextDueOn }];
    }),
  });
  if (notices.length) {
    try {
      const outcome = await sendLedgerEmail(me.email, notices.length === 1 ? "SaveYoRupee reminder" : "SaveYoRupee reminders", reminderEmailHtml(notices, options.appUrl));
      if (outcome === "unconfigured") return "unconfigured";
    } catch (error) {
      console.warn("Could not send reminder email.", error);
      return "failed";
    }
  }
  await db.user.update({ where: { id: userId }, data: { lastReminderEmailOn: asDate(today) } });
  return notices.length ? "sent" : "nothing-due";
}
