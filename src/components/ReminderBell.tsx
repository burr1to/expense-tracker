import { Bell, CalendarBlank, Check, ClockCountdown, DownloadSimple, FilePdf, HandCoins, Repeat, X } from "@phosphor-icons/react";
import { todayInput } from "../lib/dates";
import { useEffect, useMemo, useRef, useState } from "react";
import { dueDateLabel, dueRemaining, groupActionableDues, urgentDueCount, type DueUrgency } from "../lib/dues";
import { formatMoney } from "../lib/currency";
import type { CurrencyCode, DueItem, TransactionKind } from "../types";
import { ButtonSpinner } from "./ButtonSpinner";
import { FormError } from "./FormError";
import { RecurringConfirmSheet } from "./RecurringConfirmSheet";

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
  /** `dueOn` is the occurrence shown, so a stale tap never records the next one. */
  onConfirmRecurring: (id: string, overrides?: { dueOn?: string }) => Promise<void>;
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

function dropdownCloseMs() {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dropdown-close-dur"));
  return Number.isFinite(value) ? value : 150;
}

export function ReminderBell({ items, currency, recurringEntries, monthlyReport, onOpenDue, onComplete, onSnooze, onConfirmRecurring }: ReminderBellProps) {
  const [phase, setPhase] = useState<"closed" | "pre" | "open" | "closing">("closed");
  const [pending, setPending] = useState<{ id: string; action: ReminderAction } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewingRecurringId, setReviewingRecurringId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const groups = useMemo(() => groupActionableDues(items), [items]);
  const recurringGroups = useMemo(() => groupRecurringReminders(recurringEntries, todayInput()), [recurringEntries]);
  const reminders = useMemo(() => [...groups.overdue, ...groups.today, ...groups.later], [groups]);
  const recurringReminderCount = recurringGroups.overdue.length + recurringGroups.today.length + recurringGroups.later.length;
  const urgentCount = useMemo(() => urgentDueCount(items), [items]);
  const recurringUrgentCount = recurringGroups.overdue.length + recurringGroups.today.length;
  const totalUrgentCount = urgentCount + recurringUrgentCount;
  const notificationCount = reminders.length + recurringReminderCount + (monthlyReport ? 1 : 0);

  const closeTimer = useRef<number | null>(null);
  const openPanel = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setPhase("pre");
    window.requestAnimationFrame(() => setPhase("open"));
  };
  const closePanel = (restoreFocus = false) => {
    setPhase("closing");
    setError(null);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPhase("closed"), dropdownCloseMs());
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (phase !== "open") return;
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
  }, [phase]);

  const openDue = (id?: string, action?: "repay") => {
    closePanel();
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
      await onConfirmRecurring(item.id, { dueOn: item.dueOn });
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
      onClick={() => (phase === "open" || phase === "pre" ? closePanel() : openPanel())}
      aria-label={`${totalUrgentCount} urgent, ${notificationCount} total notifications`}
      aria-expanded={phase === "open" || phase === "pre"}
      aria-controls="money-reminders-panel"
      aria-haspopup="dialog"
    >
      <Bell size={20} weight={notificationCount ? "fill" : "regular"} />
      <span className="t-badge" data-open={notificationCount > 0 ? "true" : "false"}>
        <span className="t-badge-dot">{totalUrgentCount > 0 ? (totalUrgentCount > 9 ? "9+" : totalUrgentCount) : null}</span>
      </span>
    </button>
    <span className="sr-only" aria-live="polite">{totalUrgentCount} urgent money reminders</span>

    {phase !== "closed" && <section
      id="money-reminders-panel"
      className={`reminder-panel t-dropdown${phase === "open" ? " is-open" : phase === "closing" ? " is-closing" : ""}`}
      data-origin="top-right"
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
                <button className="reminder-item-main" disabled={confirming} onClick={() => { closePanel(); setReviewingRecurringId(item.id); }} aria-label={`Review ${item.title}: adjust, skip or pause`}>
                  <span className={`reminder-kind recurring ${item.kind}`}>
                    <Repeat size={18} weight="duotone" />
                  </span>
                  <span className="reminder-copy">
                    <strong>{item.title}</strong>
                    <small>{dueDateLabel(item.dueOn)} · {item.scheduleLabel}</small>
                  </span>
                  <b className="reminder-item-amount">{formatMoney(item.amountMinor, currency)}</b>
                </button>
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
        <FormError message={error} />
      </div>

      <button className="reminder-view-all" onClick={() => openDue()}>View all dues</button>
    </section>}
    <RecurringConfirmSheet entryId={reviewingRecurringId} onClose={() => setReviewingRecurringId(null)} />
  </div>;
}
