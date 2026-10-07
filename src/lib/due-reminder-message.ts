import { format, parseISO } from "date-fns";
import { formatMoney } from "./currency";
import { duePaid, dueRemaining } from "./dues";
import { adToBs, formatBs } from "./nepali-date";
import type { CalendarSystem, CurrencyCode, DueItem } from "../types";

export type ReminderLanguage = "en" | "ne";

export interface DueReminderInput {
  due: Pick<DueItem, "title" | "person" | "amountMinor" | "dueOn" | "payments">;
  currency: CurrencyCode;
  calendarSystem: CalendarSystem;
  language: ReminderLanguage;
  /** Kathmandu `YYYY-MM-DD`. */
  today: string;
}

/** "Rs 3,000" the way people write it in a chat; other currencies keep the app's format. */
export function reminderAmountText(amountMinor: number, currency: CurrencyCode) {
  if (currency !== "NPR") return formatMoney(amountMinor, currency);
  return `Rs ${new Intl.NumberFormat("en-NP", { maximumFractionDigits: 2 }).format(amountMinor / 100)}`;
}

/** The due date in the calendar the user reads: "Kartik 1, 2083" in Bikram Sambat, otherwise "Oct 18, 2026". */
export function reminderDateText(date: string, calendarSystem: CalendarSystem) {
  if (calendarSystem === "BS") {
    try { return formatBs(adToBs(date), "long"); } catch { /* outside the BS table */ }
  }
  return format(parseISO(date), "MMM d, yyyy");
}

/** A polite nudge to send someone who owes you, in English or romanized Nepali. */
export function buildDueReminderMessage({ due, currency, calendarSystem, language, today }: DueReminderInput) {
  const person = due.person.trim();
  const title = due.title.trim();
  const remaining = reminderAmountText(dueRemaining(due), currency);
  const total = reminderAmountText(due.amountMinor, currency);
  const partly = duePaid(due) > 0;
  const date = reminderDateText(due.dueOn, calendarSystem);
  const timing = due.dueOn < today ? "overdue" : due.dueOn === today ? "today" : "later";
  if (language === "ne") {
    const greeting = person ? `Namaste ${person} ji,` : "Namaste,";
    const amount = partly ? `${total} madhye ${remaining}` : remaining;
    const when = timing === "overdue" ? ` ${date} ma tirne kura thiyo.` : timing === "today" ? " Aaja tirne din ho." : ` ${date} samma milaidinu hola.`;
    return `${greeting} sano reminder: "${title}" ko ${amount} baki chha.${when} Dhanyabad!`;
  }
  const greeting = person ? `Hi ${person},` : "Hi,";
  const amount = partly ? `${remaining} of ${total}` : remaining;
  const when = timing === "overdue" ? ` It was due on ${date}.` : timing === "today" ? " It is due today." : ` It is due on ${date}.`;
  return `${greeting} a friendly reminder that ${amount} is still pending for "${title}".${when} Thank you!`;
}

/** Deep links that open a chat app with the message ready to send. */
export function reminderShareLinks(text: string) {
  const encoded = encodeURIComponent(text);
  return {
    whatsapp: `https://wa.me/?text=${encoded}`,
    viber: `viber://forward?text=${encoded}`,
    sms: `sms:?&body=${encoded}`,
  };
}
