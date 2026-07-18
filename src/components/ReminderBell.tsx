import { Bell, CalendarBlank, HandCoins, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { actionableDues, dueDateLabel, dueRemaining } from "../lib/dues";
import { formatMoney } from "../lib/currency";
import type { AppView, CurrencyCode, DueItem } from "../types";

export function ReminderBell({ items, currency, onNavigate }: { items: DueItem[]; currency: CurrencyCode; onNavigate: (view: AppView) => void }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const reminders = actionableDues(items);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!panelRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const goToDues = () => { setOpen(false); onNavigate("dues"); };
  return <div className="reminder-bell" ref={panelRef}>
    <button className="reminder-trigger" onClick={() => setOpen((value) => !value)} aria-label={`${reminders.length} money reminders`} aria-expanded={open}>
      <Bell size={20} weight={reminders.length ? "fill" : "regular"} />
      {reminders.length > 0 && <span>{reminders.length > 9 ? "9+" : reminders.length}</span>}
    </button>
    {open && <section className="reminder-panel" aria-label="Money reminders">
      <header><div><span className="section-label">Dues & reminders</span><h2>{reminders.length ? `${reminders.length} need attention` : "You’re all caught up"}</h2></div><button className="icon-button" onClick={() => setOpen(false)} aria-label="Close reminders"><X size={17} /></button></header>
      <div className="reminder-list">
        {reminders.slice(0, 5).map((item) => <button key={item.id} onClick={goToDues}>
          <span className={`reminder-kind ${item.kind}`}><HandCoins size={18} weight="duotone" /></span>
          <span><strong>{item.title}</strong><small><CalendarBlank size={12} />{dueDateLabel(item.dueOn)}</small></span>
          <b>{formatMoney(dueRemaining(item), currency)}</b>
        </button>)}
        {!reminders.length && <p>No overdue or scheduled reminders right now.</p>}
      </div>
      <button className="reminder-view-all" onClick={goToDues}>View all dues</button>
    </section>}
  </div>;
}
