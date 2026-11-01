// Registers the Bikram Sambat calendar, so a BS month key resolves here.
import "./nepali-date";
import { isSameMonthKey, monthKeyOf, parseMonthKey, type PeriodKey } from "./period";
import type { ReminderNotice } from "./reminder-digest";
import type { TransactionKind } from "../types";

/** What a home-screen shortcut or a share into the app asked for. */
export type AddDeepLink = { type: "add"; kind: TransactionKind } | { type: "sms"; text?: string };

/** Longest shared text handed to the SMS sheet; a bank alert is far shorter. */
export const SHARED_TEXT_LIMIT = 2000;
const DEEP_LINK_KEYS = ["add", "sms", "title"];

/**
 * Reads `?add=expense|income|sms` (manifest shortcuts) and `?sms=<text>&title=<text>` (the share
 * target) and returns what is left of the query once they are handled.
 */
export function readAddDeepLink(params: URLSearchParams): { link: AddDeepLink | null; rest: string } {
  const rest = new URLSearchParams(params);
  for (const key of DEEP_LINK_KEYS) rest.delete(key);
  const add = params.get("add");
  const shared = params.has("sms") || params.has("title");
  let link: AddDeepLink | null = null;
  if (add === "expense" || add === "income") link = { type: "add", kind: add };
  else if (add === "sms" || shared) {
    const text = (params.get("sms")?.trim() || params.get("title")?.trim() || "").slice(0, SHARED_TEXT_LIMIT);
    link = text ? { type: "sms", text } : { type: "sms" };
  }
  return { link, rest: rest.toString() };
}

/**
 * When the Kathmandu date moves into a new month and the app was showing the month that just
 * ended, the month to show now — in the shown key's own calendar, so a BS view rolls over at the
 * end of a BS month. Returns null when nothing should change (another month was picked).
 */
export function rolledOverMonth(shown: PeriodKey, previousToday: string, today: string): PeriodKey | null {
  const { system } = parseMonthKey(shown);
  const before = monthKeyOf(previousToday, system);
  const now = monthKeyOf(today, system);
  if (before === now || !isSameMonthKey(shown, before)) return null;
  return now;
}

/** The once-a-day notification. With amounts hidden it names what is due without the figures. */
export function reminderNotificationText(notices: readonly ReminderNotice[], hideAmounts = false) {
  const shown = notices.slice(0, 3);
  const lines = shown.map((notice) => hideAmounts ? notice.title : `${notice.title}: ${notice.body}`);
  if (notices.length > shown.length) lines.push(`and ${notices.length - shown.length} more`);
  return { title: notices.length === 1 ? "SaveYoRupee reminder" : "SaveYoRupee reminders", body: lines.join("\n") };
}

/** The same reminders as an in-app toast: titles only, since toast text is never masked. */
export function reminderToastText(notices: readonly ReminderNotice[]) {
  const names = notices.slice(0, 2).map((notice) => notice.title);
  const more = notices.length - names.length;
  return {
    title: notices.length === 1 ? "1 thing is due soon" : `${notices.length} things are due soon`,
    body: `${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}. Open the bell to handle ${notices.length === 1 ? "it" : "them"}.`,
  };
}

interface NotificationRegistration { showNotification(title: string, options?: NotificationOptions): Promise<void> }
export interface NotificationEnvironment {
  getRegistration?: () => Promise<NotificationRegistration | null | undefined>;
  /** The page-level `Notification` constructor; Android Chrome throws when it is called. */
  createNotification?: (title: string, options: NotificationOptions) => unknown;
}

/**
 * Shows a notification without ever throwing: through the service worker when one is active
 * (the only way Android allows), else the page constructor. "failed" means show it in the app.
 */
export async function deliverNotification(environment: NotificationEnvironment, title: string, options: NotificationOptions): Promise<"service-worker" | "page" | "failed"> {
  try {
    const registration = await environment.getRegistration?.();
    if (registration) {
      await registration.showNotification(title, options);
      return "service-worker";
    }
  } catch {
    // Fall through to the page constructor.
  }
  try {
    if (environment.createNotification) {
      environment.createNotification(title, options);
      return "page";
    }
  } catch {
    // "Illegal constructor" on Android, or blocked by the browser.
  }
  return "failed";
}

export interface NotificationSupportInput {
  hasNotification: boolean;
  permission?: NotificationPermission;
  userAgent: string;
  maxTouchPoints?: number;
  standalone: boolean;
}

/** Whether "Notify this browser" can be turned on here, and if not, what to tell the person. */
export function browserNotificationBlocker(input: NotificationSupportInput): string | null {
  const iPhone = /iPhone|iPad|iPod/i.test(input.userAgent) || (/Macintosh/i.test(input.userAgent) && (input.maxTouchPoints ?? 0) > 1);
  if (!input.hasNotification) {
    if (iPhone && !input.standalone) return "Add SaveYoRupee to your Home Screen to get notifications: tap Share, then Add to Home Screen, and open it from there.";
    return "This browser can’t show notifications. Email reminders still work.";
  }
  if (input.permission === "denied") return "Notifications are blocked for this site. Allow them in your browser’s site settings, then turn this on again.";
  return null;
}

/** `browserNotificationBlocker` for the browser this runs in (null on the server). */
export function notificationBlockerHere(): string | null {
  if (typeof window === "undefined") return null;
  const hasNotification = typeof Notification !== "undefined";
  return browserNotificationBlocker({
    hasNotification,
    permission: hasNotification ? Notification.permission : undefined,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: Boolean(window.matchMedia?.("(display-mode: standalone)").matches) || (navigator as Navigator & { standalone?: boolean }).standalone === true,
  });
}
