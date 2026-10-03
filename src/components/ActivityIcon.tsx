/* eslint-disable react-refresh/only-export-components */
import { ArrowsLeftRight, Bank, Database, Flag, GearSix, HandCoins, PencilSimple, Receipt, ShieldCheck, SignIn, SignOut, Tag, Trash, UsersThree, WarningCircle } from "@phosphor-icons/react";
import type { ActivityArea, ActivityChange, ActivityEntry } from "../lib/activity-log";
import { formatMoney } from "../lib/currency";
import type { ToastInput, ToastTone } from "../context/ToastContext";

const areaIcons: Record<ActivityArea, typeof Bank> = {
  transactions: Receipt,
  accounts: Bank,
  planning: Flag,
  dues: HandCoins,
  categories: Tag,
  settings: GearSix,
  security: ShieldCheck,
  household: UsersThree,
  data: Database,
};

const DANGER = /\.(deleted|member_removed|closed|left|import_failed|failed|locked_out|reconciliation_reset|unshared)$/;
const SIGNED = new Set(["transaction.created", "transaction.restored", "recurring.recorded"]);

export function activityTone(entry: Pick<ActivityEntry, "action" | "area">): ToastTone {
  if (DANGER.test(entry.action)) return "danger";
  if (entry.area === "security") return "security";
  if (/\.(edited|updated|icon_changed|balance_updated|snoozed)$/.test(entry.action) || entry.area === "settings") return "neutral";
  return "success";
}

export function ActivityIcon({ entry, size = 18 }: { entry: Pick<ActivityEntry, "action" | "area">; size?: number }) {
  const { action } = entry;
  if (action === "session.signed_in") return <SignIn size={size} />;
  if (action === "session.signed_out") return <SignOut size={size} />;
  if (/failed|locked_out/.test(action)) return <WarningCircle size={size} weight="fill" />;
  if (DANGER.test(action)) return <Trash size={size} />;
  if (/\.(edited|updated|icon_changed|balance_updated)$/.test(action)) return <PencilSimple size={size} />;
  if (action.startsWith("transfer.")) return <ArrowsLeftRight size={size} />;
  const Icon = areaIcons[entry.area];
  return <Icon size={size} weight={entry.area === "security" ? "fill" : "regular"} />;
}

/** The entry's figure, signed only where the sign means money in or out of the ledger. */
export function activityAmountText(entry: Pick<ActivityEntry, "action" | "amountMinor" | "currency" | "meta">) {
  if (entry.amountMinor === null) return null;
  const money = formatMoney(entry.amountMinor, entry.currency);
  if (!SIGNED.has(entry.action)) return money;
  return `${entry.meta?.kind === "income" ? "+" : "−"}${money}`;
}

function changeText(change: ActivityChange) {
  const plain = (value: ActivityChange["from"]) => value === null ? "none" : typeof value === "string" ? value : "date" in value ? value.date : null;
  if ((change.from && typeof change.from === "object" && "money" in change.from) || (change.to && typeof change.to === "object" && "money" in change.to)) return `${change.field} changed`;
  return `${change.field}: ${plain(change.from)} → ${plain(change.to)}`;
}

/** Builds the confirmation toast for a log entry, so a toast never says more or less than Logs will. */
export function activityToast(entry: ActivityEntry, action?: ToastInput["action"]): ToastInput {
  const changes = entry.changes.length;
  const body = entry.subject
    ? changes > 1 ? `${entry.subject} · ${changes} changes` : changes === 1 ? `${entry.subject} · ${changeText(entry.changes[0])}` : entry.subject
    : changes ? entry.changes.map(changeText).join(" · ") : null;
  return {
    title: entry.title,
    body,
    amount: activityAmountText(entry),
    tone: activityTone(entry),
    icon: <ActivityIcon entry={entry} size={19} />,
    action,
  };
}
