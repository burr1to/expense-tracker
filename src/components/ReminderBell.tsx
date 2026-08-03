import { Bell, CalendarBlank, Check, ClockCountdown, DownloadSimple, FilePdf, HandCoins, Repeat, X } from "@phosphor-icons/react";
import { format } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { dueDateLabel, dueRemaining, groupActionableDues, urgentDueCount, type DueUrgency } from "../lib/dues";
import { formatMoney } from "../lib/currency";
import type { CurrencyCode, DueItem, TransactionKind } from "../types";
import { ButtonSpinner } from "./ButtonSpinner";

type ReminderAction = "complete" | "snooze" | "confirmRecurring";

export interface RecurringReminder {
  id: string;
  kind: TransactionKind;
  title: string;
  amountMinor: number;
  dueOn: string;
  scheduleLabel: string;
}

interface ReminderBellProps {
  items: DueItem[];
  currency: CurrencyCode;
  recurringEntries: RecurringReminder[];
  monthlyReport?: { monthKey: string; monthLabel: string; href: string } | null;
  onOpenDue: (id?: string, action?: "repay") => void;
  onComplete: (id: string, addToLedger: boolean) => Promise<void>;
  onSnooze: (id: string) => Promise<void>;
  onConfirmRecurring: (id: string) => Promise<void>;
}

const groupLabels: Record<DueUrgency, string> = {
  overdue: "Overdue",
  today: "Today",
  later: "Later",
};

function completionLabel(item: DueItem) {
  return item.kind === "payment" ? "Paid" : "Received";
}

function groupRecurringReminders(items: readonly RecurringReminder[], today: string) {
  const groups: Record<DueUrgency, RecurringReminder[]> = { overdue: [], today: [], later: [] };
  for (const item of items.filter((entry) => entry.dueOn <= today).sort((a, b) => a.dueOn.localeCompare(b.dueOn))) {
    const urgency: DueUrgency = item.dueOn < today ? "overdue" : "today";
    groups[urgency].push(item);
  }
  return groups;
}

export function ReminderBell({ items, currency, recurringEntries, monthlyReport, onOpenDue, onComplete, onSnooze, onConfirmRecurring }: ReminderBellProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ id: string; action: ReminderAction } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const groups = useMemo(() => groupActionableDues(items), [items]);
  const recurringGroups = useMemo(() => groupRecurringReminders(recurringEntries, format(new Date(), "yyyy-MM-dd")), [recurringEntries]);
  const reminders = useMemo(() => [...groups.overdue, ...groups.today, ...groups.later], [groups]);
  const recurringReminderCount = recurringGroups.overdue.length + recurringGroups.today.length + recurringGroups.later.length;
  const urgentCount = useMemo(() => urgentDueCount(items), [items]);
  const recurringUrgentCount = recurringGroups.overdue.length + recurringGroups.today.length;
  const totalUrgentCount = urgentCount + recurringUrgentCount;
  const notificationCount = reminders.length + recurringReminderCount + (monthlyReport ? 1 : 0);

  const closePanel = (restoreFocus = false) => {
    setOpen(false);
    setError(null);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closePanel();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel(true);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const openDue = (id?: string, action?: "repay") => {
    setOpen(false);
    onOpenDue(id, action);
  };

  const runAction = async (item: DueItem, action: ReminderAction) => {
    setPending({ id: item.id, action });
    setError(null);
    try {
      if (action === "complete") await onComplete(item.id, true);
      else await onSnooze(item.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this reminder.");
    } finally {
      setPending(null);
    }
  };

  const confirmRecurring = async (item: RecurringReminder) => {
    setPending({ id: item.id, action: "confirmRecurring" });
    setError(null);
    try {
      await onConfirmRecurring(item.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not confirm this recurring entry.");
    } finally {
      setPending(null);
    }
  };

  return <div className="reminder-bell" ref={rootRef}>
    <button
      ref={triggerRef}
      id="money-reminders-trigger"
      className="reminder-trigger"
      onClick={() => setOpen((value) => !value)}
      aria-label={`${totalUrgentCount} urgent, ${notificationCount} total notifications`}
      aria-expanded={open}
      aria-controls="money-reminders-panel"
      aria-haspopup="dialog"
    >
      <Bell size={20} weight={notificationCount ? "fill" : "regular"} />
      {totalUrgentCount > 0
        ? <span>{totalUrgentCount > 9 ? "9+" : totalUrgentCount}</span>
        : notificationCount > 0 && <i aria-hidden="true" />}
    </button>
    <span className="sr-only" aria-live="polite">{totalUrgentCount} urgent money reminders</span>

    {open && <section
      id="money-reminders-panel"
      className="reminder-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="money-reminders-title"
    >
      <header>
        <div>
          <span className="section-label">Money to handle</span>
          <h2 id="money-reminders-title">{notificationCount ? `${notificationCount} ${notificationCount === 1 ? "item is" : "items are"} ready` : "You’re all caught up"}</h2>
          {notificationCount > 0 && <p>{urgentCount ? `${urgentCount} urgent right now` : "Nothing urgent right now"}</p>}
        </div>
        <button ref={closeRef} className="icon-button" onClick={() => closePanel(true)} aria-label="Close money reminders"><X size={18} /></button>
      </header>

      <div className="reminder-panel-body">
        {monthlyReport && <section className="monthly-report-notification" aria-labelledby="monthly-report-notification-title">
          <span className="reminder-kind report"><FilePdf size={18} weight="duotone" /></span>
          <span>
            <strong id="monthly-report-notification-title">{monthlyReport.monthLabel} report is ready</strong>
            <small>Your completed income and expense report is available as a PDF.</small>
          </span>
          <a href={monthlyReport.href} download={`SaveYoRupee-${monthlyReport.monthKey}-monthly-report.pdf`} className="reminder-action primary">
            <DownloadSimple size={14} />Download
          </a>
        </section>}

        {(["overdue", "today", "later"] as DueUrgency[]).map((urgency) => {
          const dueGroup = groups[urgency];
          const recurringGroup = recurringGroups[urgency];
          const groupCount = dueGroup.length + recurringGroup.length;
          if (!groupCount) return null;
          return <section className={`reminder-group ${urgency}`} key={urgency} aria-labelledby={`reminder-group-${urgency}`}>
          <h3 id={`reminder-group-${urgency}`}>{groupLabels[urgency]} <span>{groupCount}</span></h3>
          <div className="reminder-list">
            {dueGroup.map((item) => {
              const completing = pending?.id === item.id && pending.action === "complete";
              const snoozing = pending?.id === item.id && pending.action === "snooze";
              const disabled = pending?.id === item.id;
              const debt = item.kind === "lent" || item.kind === "borrowed";
              return <article className="reminder-item" key={item.id} aria-busy={disabled}>
                <button className="reminder-item-main" onClick={() => openDue(item.id)}>
                  <span className={`reminder-kind ${item.kind}`}>
                    {debt ? <HandCoins size={18} weight="duotone" /> : <CalendarBlank size={18} weight="duotone" />}
                  </span>
                  <span className="reminder-copy">
                    <strong>{item.title}</strong>
                    <small>{dueDateLabel(item.dueOn)}{item.person ? ` · ${item.person}` : ""}</small>
                  </span>
                  <b className="reminder-item-amount">{formatMoney(dueRemaining(item), currency)}</b>
                </button>
                <div className="reminder-actions">
                  {debt
                    ? <button className="reminder-action primary" disabled={disabled} onClick={() => openDue(item.id, "repay")}><HandCoins size={14} />Record repayment</button>
                    : <button className="reminder-action primary" disabled={disabled} onClick={() => void runAction(item, "complete")}>
                      {completing ? <ButtonSpinner /> : <Check size={14} />}{completing ? "Updating…" : completionLabel(item)}
                    </button>}
                  <button className="reminder-action" disabled={disabled} onClick={() => void runAction(item, "snooze")}>
                    {snoozing ? <ButtonSpinner /> : <ClockCountdown size={14} />}{snoozing ? "Snoozing…" : "Tomorrow"}
                  </button>
                </div>
              </article>;
            })}
            {recurringGroup.map((item) => {
              const confirming = pending?.id === item.id && pending.action === "confirmRecurring";
              return <article className="reminder-item" key={`recurring-${item.id}`} aria-busy={confirming}>
                <div className="reminder-item-main">
                  <span className={`reminder-kind recurring ${item.kind}`}>
                    <Repeat size={18} weight="duotone" />
                  </span>
                  <span className="reminder-copy">
                    <strong>{item.title}</strong>
                    <small>{dueDateLabel(item.dueOn)} · {item.scheduleLabel}</small>
                  </span>
                  <b className="reminder-item-amount">{formatMoney(item.amountMinor, currency)}</b>
                </div>
                <div className="reminder-actions">
                  <button className="reminder-action primary" disabled={confirming} onClick={() => void confirmRecurring(item)}>
                    {confirming ? <ButtonSpinner /> : <Check size={14} />}{confirming ? "Confirming…" : "Confirm"}
                  </button>
                </div>
              </article>;
            })}
          </div>
        </section>;
        })}

        {!notificationCount && <div className="reminder-empty">
          <span><Check size={22} weight="bold" /></span>
          <strong>No money tasks need attention</strong>
          <p>New reminders will appear here when their reminder date arrives.</p>
        </div>}
        {error && <div className="reminder-error" role="alert">{error}</div>}
      </div>

      <button className="reminder-view-all" onClick={() => openDue()}>View all dues</button>
    </section>}
  </div>;
}
