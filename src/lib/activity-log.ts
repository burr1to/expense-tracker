import type { CurrencyCode } from "../types";

/** How long Logs keeps an entry. Older entries are purged when the ledger or Logs is loaded. */
export const ACTIVITY_RETENTION_DAYS = 90;
export const ACTIVITY_PAGE_SIZE = 40;

export const ACTIVITY_AREAS = ["transactions", "accounts", "planning", "dues", "categories", "settings", "security", "household", "data"] as const;
export type ActivityArea = typeof ACTIVITY_AREAS[number];

export const ACTIVITY_AREA_LABELS: Record<ActivityArea, string> = {
  transactions: "Transactions",
  accounts: "Accounts",
  planning: "Plans",
  dues: "Dues",
  categories: "Categories & places",
  settings: "Settings",
  security: "Security",
  household: "Household",
  data: "Imports & backups",
};

/** A value shown in a change row. Money and dates stay structured so the client can mask amounts and format dates in the user's calendar. */
export type ActivityValue = string | { money: number } | { date: string } | null;
export interface ActivityChange { field: string; from: ActivityValue; to: ActivityValue }

/** What a server action reports. The recorder adds id, currency and time. */
export interface ActivityDraft {
  action: string;
  area: ActivityArea;
  entityId?: string | null;
  title: string;
  subject?: string | null;
  amountMinor?: number | null;
  changes?: ActivityChange[];
  meta?: Record<string, string | number | boolean | null>;
}

export interface ActivityEntry {
  id: string;
  action: string;
  area: ActivityArea;
  entityId: string | null;
  title: string;
  subject: string | null;
  amountMinor: number | null;
  currency: CurrencyCode;
  changes: ActivityChange[];
  meta: Record<string, string | number | boolean | null> | null;
  createdAt: string;
}

export interface ActivityPage { entries: ActivityEntry[]; nextCursor: string | null }

type FieldKind = "text" | "money" | "date" | "flag";
export interface TrackedField<T> { key: keyof T; label: string; kind?: FieldKind }

function toValue(value: unknown, kind: FieldKind): ActivityValue {
  if (value === null || value === undefined || value === "") return null;
  if (kind === "money") return { money: Number(value) };
  if (kind === "date") return { date: value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10) };
  if (kind === "flag") return value ? "On" : "Off";
  return String(value);
}

function sameValue(a: ActivityValue, b: ActivityValue) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Lists only the tracked fields whose shown value changed between two records. */
export function diffFields<T>(before: T, after: T, fields: readonly TrackedField<T>[]): ActivityChange[] {
  return fields.flatMap(({ key, label, kind = "text" }) => {
    const from = toValue(before[key], kind);
    const to = toValue(after[key], kind);
    return sameValue(from, to) ? [] : [{ field: label, from, to }];
  });
}

export function activityCutoff(now = new Date()) {
  return new Date(now.getTime() - ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export function isActivityArea(value: string): value is ActivityArea {
  return (ACTIVITY_AREAS as readonly string[]).includes(value);
}

const AD_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BS_MONTHS = ["Baisakh", "Jestha", "Asar", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];

/** Names a stored budget period ("2026-10", "BS:2083-06", "FEST:dashain") for a log line. */
export function periodText(key: string) {
  const ad = /^(\d{4})-(\d{2})$/.exec(key);
  if (ad) return `${AD_MONTHS[Number(ad[2]) - 1]} ${ad[1]}`;
  const bs = /^BS:(\d{4})-(\d{2})$/.exec(key);
  if (bs) return `${BS_MONTHS[Number(bs[2]) - 1]} ${bs[1]}`;
  const festival = /^FEST:(.+)$/.exec(key);
  if (festival) return festival[1].split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  return key;
}

/** A short, human device name from a user agent, e.g. "Chrome on Linux". */
export function describeDevice(userAgent: string | null | undefined) {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent) ? "Edge" : /OPR\//.test(userAgent) ? "Opera" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : null;
  const os = /Android/.test(userAgent) ? "Android" : /iPhone|iPad|iPod/.test(userAgent) ? "iOS" : /Windows/.test(userAgent) ? "Windows" : /Mac OS X|Macintosh/.test(userAgent) ? "macOS" : /CrOS/.test(userAgent) ? "ChromeOS" : /Linux/.test(userAgent) ? "Linux" : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}

export const DUE_KIND_LABELS: Record<string, string> = { payment: "Bill to pay", receivable: "Money to receive", lent: "Money lent", borrowed: "Money borrowed" };

/** Keeps an IP only when it identifies a real network origin; loopback and unset addresses say nothing useful. */
export function meaningfulIp(ip: string | null | undefined) {
  if (!ip) return null;
  const value = ip.trim();
  if (!value || /^[0:.]+$/.test(value) || value === "::1" || value.startsWith("127.") || value === "::ffff:127.0.0.1") return null;
  return value;
}
