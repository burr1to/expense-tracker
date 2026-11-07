import { CaretDown } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { formatLedgerDay } from "../lib/dates";
import { dayGroupLabel, type LedgerDayGroup } from "../lib/day-groups";
import type { LedgerActivityItem } from "../lib/transaction-history";
import type { CalendarSystem, CurrencyCode, CustomCategory } from "../types";

interface LedgerDayGroupsProps {
  groups: LedgerDayGroup[];
  summary: string;
  today: string;
  calendarSystem: CalendarSystem;
  currency: CurrencyCode;
  customCategories: CustomCategory[];
  renderItem: (item: LedgerActivityItem) => ReactNode;
}

/** Hover intent, so sweeping the pointer across the list does not open every day it crosses. */
const HOVER_OPEN_DELAY = 110;
const LIST_LEAVE_DELAY = 260;

const without = (set: ReadonlySet<string>, key: string) => { const next = new Set(set); next.delete(key); return next; };
// Touch and pen fire pointerenter on tap too; only a mouse hovers.
const isMouse = (event: PointerEvent) => event.pointerType === "mouse";

/**
 * All-history days that open on hover and stay open while the pointer is anywhere in the list, so
 * moving down never collapses a day above and shifts the list under the cursor. Leaving the list
 * closes them again; a click (or tap, or Enter) keeps a day open or closes it. Today starts open.
 */
export function LedgerDayGroups({ groups, summary, today, calendarSystem, currency, customCategories, renderItem }: LedgerDayGroupsProps) {
  const idPrefix = useId();
  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set([today]));
  const [hovered, setHovered] = useState<ReadonlySet<string>>(() => new Set());
  const hoverTimer = useRef<number | undefined>(undefined);
  const leaveTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => { window.clearTimeout(hoverTimer.current); window.clearTimeout(leaveTimer.current); }, []);

  const hoverDay = (dayKey: string) => (event: PointerEvent) => {
    if (!isMouse(event)) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHovered((current) => current.has(dayKey) ? current : new Set(current).add(dayKey)), HOVER_OPEN_DELAY);
  };
  const leaveDay = (event: PointerEvent) => { if (isMouse(event)) window.clearTimeout(hoverTimer.current); };
  const enterList = (event: PointerEvent) => { if (isMouse(event)) window.clearTimeout(leaveTimer.current); };
  const leaveList = (event: PointerEvent) => {
    if (!isMouse(event)) return;
    window.clearTimeout(hoverTimer.current);
    leaveTimer.current = window.setTimeout(() => setHovered(new Set()), LIST_LEAVE_DELAY);
  };
  const toggle = (dayKey: string) => {
    const open = pinned.has(dayKey) || hovered.has(dayKey);
    window.clearTimeout(hoverTimer.current);
    setHovered((current) => without(current, dayKey));
    setPinned((current) => open ? without(current, dayKey) : new Set(current).add(dayKey));
  };
  const collapseAll = () => { window.clearTimeout(hoverTimer.current); setHovered(new Set()); setPinned(new Set()); };

  return <div className="ledger-days" onPointerEnter={enterList} onPointerLeave={leaveList}>
    <div className="ledger-list-heading"><span>{summary}</span><span className="ledger-days-controls">{groups.length > 0 && <><button type="button" className="text-button" onClick={() => setPinned(new Set(groups.map((group) => group.dayKey)))}>Expand all</button><button type="button" className="text-button" onClick={collapseAll}>Collapse all</button></>}<span>Newest first</span></span></div>
    {groups.map((group) => {
      const open = pinned.has(group.dayKey) || hovered.has(group.dayKey);
      const bodyId = `${idPrefix}-${group.dayKey}`;
      const colors = [...new Set(group.items.map((item) => item.type === "transfer" ? "var(--transfer)" : getCategory(item.transaction.category, customCategories).color))].slice(0, 4);
      return <section key={group.dayKey} className={`ledger-day${open ? " is-open" : ""}`} onPointerEnter={hoverDay(group.dayKey)} onPointerLeave={leaveDay}>
        <h2 className="ledger-day-heading"><button type="button" className="ledger-day-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => toggle(group.dayKey)}>
          <span className="ledger-day-title"><strong>{dayGroupLabel(group.dayKey, today)}</strong><small>{formatLedgerDay(group.dayKey, calendarSystem, "date")} · {group.items.length} {group.items.length === 1 ? "entry" : "entries"}</small></span>
          <span className="ledger-day-dots" aria-hidden="true">{colors.map((color) => <span key={color} style={{ "--category-color": color } as CSSProperties} />)}</span>
          <span className="ledger-day-totals">
            {group.spentMinor > 0 && <strong className="amount expense">−{formatMoney(group.spentMinor, currency)}</strong>}
            {group.earnedMinor > 0 && <strong className="amount income">+{formatMoney(group.earnedMinor, currency)}</strong>}
            {group.movedMinor > 0 && <small className="amount transfer">{formatMoney(group.movedMinor, currency)} moved</small>}
          </span>
          <CaretDown className="ledger-day-caret" size={17} weight="bold" aria-hidden="true" />
        </button></h2>
        <div className="ledger-day-body" id={bodyId} inert={!open}><div className="ledger-day-rows">{group.items.map(renderItem)}</div></div>
      </section>;
    })}
  </div>;
}
