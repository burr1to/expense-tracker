"use client";

import { CalendarBlank, CaretLeft, Copy, DotsThree, MagnifyingGlass, MinusCircle, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { Menu } from "@mantine/core";
import { differenceInCalendarDays, parseISO } from "date-fns";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type CSSProperties } from "react";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { FormError } from "../components/FormError";
import { GroupFormSheet } from "../components/GroupFormSheet";
import { GroupIcon } from "../components/GroupIcon";
import { CategoryTile } from "../components/ToneIcon";
import { getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { formatLedgerDate } from "../lib/dates";
import { plainAmount } from "../lib/entry-labels";
import { categoryTone } from "../lib/tones";
import { filterTransactionHistory } from "../lib/transaction-history";
import { GROUP_ASSIGN_LIMIT, GROUPS_HREF, groupDatesText, groupEntries, groupSpan, summarizeGroup } from "../lib/transaction-groups";
import { toUserMessage } from "../lib/user-messages";
import type { CalendarSystem, CurrencyCode, CustomCategory, LedgerTransaction, PaymentAccount, TransactionGroup, TransactionGroupDraft, TransactionKind } from "../types";

interface GroupDetailPageProps {
  groupId: string;
  currency: CurrencyCode;
  calendarSystem: CalendarSystem;
  groups: TransactionGroup[];
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  paymentAccounts: PaymentAccount[];
  ownerId?: string;
  onSaveGroup: (draft: TransactionGroupDraft, id: string) => Promise<unknown>;
  onDeleteGroup: (id: string) => Promise<void>;
  onSetGroup: (groupId: string | null, ids: string[]) => Promise<void>;
  onEdit: (transaction: LedgerTransaction) => void;
  onDuplicate: (transaction: LedgerTransaction) => void;
}

type Mode = "view" | "add" | "remove";
type KindFilter = TransactionKind | "all";
const PAGE_SIZE = 50;
/** The same id-picked colours as the Groups list, so a group looks the same on both pages. */
const GROUP_TONES = [
  { bg: "#d8f1f3", ink: "#11707a" }, { bg: "#fbe0ec", ink: "#b0386a" }, { bg: "#fdf0c4", ink: "#8a5a00" },
  { bg: "#dfe6fb", ink: "#3446a8" }, { bg: "#d6f0df", ink: "#1f7a45" }, { bg: "#ece2f8", ink: "#5c2d91" },
];
const groupTileStyle = (id: string, size = 46) => { const tone = GROUP_TONES[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % GROUP_TONES.length]; return { "--tile-bg": tone.bg, "--tile-ink": tone.ink, "--tile-size": `${size}px` } as CSSProperties; };
const KIND_FILTERS: { id: KindFilter; label: string }[] = [{ id: "all", label: "All" }, { id: "expense", label: "Expenses" }, { id: "income", label: "Income" }];

export function GroupDetailPage({ groupId, currency, calendarSystem, groups, transactions, customCategories, paymentAccounts, ownerId, onSaveGroup, onDeleteGroup, onSetGroup, onEdit, onDuplicate }: GroupDetailPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const group = groups.find((item) => item.id === groupId) ?? null;
  const hasDates = Boolean(group?.startOn || group?.endOn);
  const [mode, setMode] = useState<Mode>(() => searchParams.get("add") ? "add" : "view");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [onlyDates, setOnlyDates] = useState(true);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // A partner's shared entries stay theirs to group.
  const own = useMemo(() => transactions.filter((entry) => !ownerId || entry.userId === ownerId), [ownerId, transactions]);
  const entries = useMemo(() => groupEntries(groupId, own).sort((a, b) => `${b.occurredOn}${b.createdAt}`.localeCompare(`${a.occurredOn}${a.createdAt}`)), [groupId, own]);
  const summary = useMemo(() => summarizeGroup(entries), [entries]);
  const groupNames = useMemo(() => new Map(groups.map((item) => [item.id, item.name])), [groups]);
  const pool = mode === "add" ? own.filter((entry) => entry.groupId !== groupId) : entries;
  const useDates = mode === "add" && hasDates && onlyDates;
  const matching = useMemo(() => filterTransactionHistory(pool, customCategories, { scope: "history", selectedDayKey: "", kind, category: "all", from: useDates ? group?.startOn ?? "" : "", to: useDates ? group?.endOn ?? "" : "", minMinor: null, maxMinor: null, paymentMode: "all", query }, paymentAccounts), [customCategories, group?.endOn, group?.startOn, kind, paymentAccounts, pool, query, useDates]);
  const selectedIds = useMemo(() => pool.filter((entry) => selected.has(entry.id)).map((entry) => entry.id), [pool, selected]);
  const allMatchingSelected = matching.length > 0 && matching.every((entry) => selected.has(entry.id));

  if (!group) return <div className="v2-page v2-groups">
    <Link href={GROUPS_HREF} className="v2-back"><CaretLeft size={16} weight="bold" />Groups</Link>
    <section className="v2-card v2-groups-empty"><h2>This group isn’t here</h2><p>It may have been removed on another device. Its entries are still in your ledger.</p><Link className="v2-button is-primary" href={GROUPS_HREF}>See all groups</Link></section>
  </div>;

  const span = groupSpan(group, summary);
  const dates = groupDatesText(span, calendarSystem);
  const days = span.from && span.to ? differenceInCalendarDays(parseISO(span.to), parseISO(span.from)) + 1 : 0;
  const switchMode = (next: Mode) => {
    setMode(next);
    setSelected(new Set());
    setQuery("");
    setKind("all");
    setVisibleCount(PAGE_SIZE);
    setError("");
    if (searchParams.get("add")) router.replace(window.location.pathname);
  };
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else if (next.size < GROUP_ASSIGN_LIMIT) next.add(id);
    return next;
  });
  const toggleAllMatching = () => setSelected((current) => {
    const next = new Set(current);
    if (allMatchingSelected) for (const entry of matching) next.delete(entry.id);
    else for (const entry of matching) { if (next.size >= GROUP_ASSIGN_LIMIT) break; next.add(entry.id); }
    return next;
  });
  const apply = async () => {
    if (!selectedIds.length || saving) return;
    const moving = mode === "add" ? selectedIds.filter((id) => own.find((entry) => entry.id === id)?.groupId).length : 0;
    if (moving && !window.confirm(`${moving} of these ${moving === 1 ? "entry is" : "entries are"} in another group and will move to ${group.name}. Continue?`)) return;
    setSaving(true);
    setError("");
    try {
      await onSetGroup(mode === "add" ? group.id : null, selectedIds);
      switchMode("view");
    } catch (caught) {
      setError(toUserMessage(caught, null, "Could not update this group. Nothing was changed, so you can try again."));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (deleting || !window.confirm(`Remove the group “${group.name}”? Its ${summary.count === 1 ? "entry stays" : `${summary.count} entries stay`} in your ledger, just ungrouped.`)) return;
    setDeleting(true);
    try {
      await onDeleteGroup(group.id);
      router.replace(GROUPS_HREF);
    } catch (caught) {
      setError(toUserMessage(caught, null, "Could not remove this group."));
      setDeleting(false);
    }
  };
  const categoryText = (entry: LedgerTransaction) => [getCategory(entry.category, customCategories).label, entry.subcategory].filter(Boolean).join(" · ");

  const perDay = days > 1 ? Math.round(summary.spentMinor / days / 100) * 100 : null;
  const pagination = (total: number) => visibleCount < total && <div className="v2-load-more" aria-live="polite"><span>Showing {visibleCount} of {total}</span><button type="button" className="v2-button is-small" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Show {PAGE_SIZE} more</button></div>;

  return <div className="v2-page v2-groups v2-group-detail">
    <Link href={GROUPS_HREF} className="v2-back"><CaretLeft size={16} weight="bold" />Groups</Link>
    <header className="v2-page-head">
      <div className="v2-account-title">
        <span className="v2-tile" style={groupTileStyle(group.id, 52)} aria-hidden="true"><GroupIcon icon={group.icon} size={28} /></span>
        <div><h1 id="group-title">{group.name}</h1><span className="v2-muted">{dates ?? "No dates yet"}{group.note && <> · {group.note}</>}</span></div>
      </div>
      <div className="v2-head-actions">
        <Menu position="bottom-end" shadow="md" withinPortal>
          <Menu.Target><button type="button" className="v2-icon-btn" disabled={deleting} aria-label={`More actions for ${group.name}`}>{deleting ? <ButtonSpinner /> : <DotsThree size={20} weight="bold" />}</button></Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<PencilSimple size={16} />} onClick={() => setEditing(true)}>Edit group</Menu.Item>
            {entries.length > 0 && <Menu.Item leftSection={<MinusCircle size={16} />} onClick={() => switchMode("remove")}>Take entries out</Menu.Item>}
            <Menu.Item color="red" leftSection={<Trash size={16} />} onClick={() => void remove()}>Remove group</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
    </header>

    <section className="v2-hero v2-group-hero" aria-label="Group totals">
      <span className="v2-hero-label">Spent{days > 1 ? ` over ${days} days` : ""}</span>
      <strong className="v2-hero-amount amount">{formatMoney(summary.spentMinor, currency)}</strong>
      <div className="v2-budget-hero-facts">
        {perDay !== null && <span><small>Per day</small><strong className="amount">{formatMoney(perDay, currency)}</strong></span>}
        <span><small>Received</small><strong className="amount">{formatMoney(summary.receivedMinor, currency)}</strong></span>
        <span><small>Entries</small><strong>{summary.count}</strong></span>
      </div>
    </section>

    {mode === "view" ? <div className="v2-plan-grid">
      <section className="v2-card v2-plan-main-card" aria-labelledby="group-entries-title">
        <header className="v2-card-head"><h2 id="group-entries-title">{summary.count} {summary.count === 1 ? "entry" : "entries"}</h2><button type="button" className="v2-link is-plain" onClick={() => switchMode("add")}><Plus size={14} weight="bold" />Add entries</button></header>
        {entries.length ? <ul className="v2-rows">{entries.slice(0, visibleCount).map((entry) => {
          const title = entry.note || getCategory(entry.category, customCategories).label;
          return <li key={entry.id} className="v2-entry">
            <button type="button" className="v2-row" onClick={() => onEdit(entry)}>
              <CategoryTile category={entry.category} custom={customCategories} />
              <span className="v2-row-main"><strong>{title}</strong><small>{formatLedgerDate(entry.occurredOn, calendarSystem)} · {categoryText(entry)}</small></span>
              <span className="v2-row-end"><strong className={`v2-money${entry.kind === "income" ? " is-in" : ""}`}>{entry.kind === "income" ? "+" : ""}{plainAmount(entry.amountMinor)}</strong></span>
            </button>
            <Menu position="bottom-end" shadow="md" withinPortal>
              <Menu.Target><button type="button" className="v2-icon-btn is-quiet v2-entry-menu" aria-label={`More actions for ${title}`}><DotsThree size={20} weight="bold" /></button></Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<PencilSimple size={16} />} onClick={() => onEdit(entry)}>Edit</Menu.Item>
                <Menu.Item leftSection={<Copy size={16} />} onClick={() => onDuplicate(entry)}>Use again</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </li>;
        })}</ul> : <div className="v2-group-empty-entries"><p className="v2-empty">{hasDates ? "Nothing in here yet. Add the entries from these dates, or any others that belong." : "Nothing in here yet. Pick the entries that belong to it."}</p><button type="button" className="v2-button is-primary" onClick={() => switchMode("add")}><Plus size={16} weight="bold" />Add entries</button></div>}
        {pagination(entries.length)}
        <FormError message={error} />
      </section>
      {summary.categories.length > 0 && <aside className="v2-plan-side"><section className="v2-card" aria-labelledby="group-breakdown-title">
        <header className="v2-card-head"><h2 id="group-breakdown-title">Where it went</h2></header>
        <ul className="v2-rows">{summary.categories.slice(0, 6).map((item) => {
          const category = getCategory(item.category, customCategories);
          const percent = summary.spentMinor ? Math.round(item.amountMinor / summary.spentMinor * 100) : 0;
          return <li key={item.category} className="v2-row">
            <CategoryTile category={item.category} custom={customCategories} size={38} />
            <span className="v2-row-main"><strong>{category.label}</strong><span className="v2-progress"><span style={{ width: `${Math.max(percent, 2)}%`, background: categoryTone(item.category, customCategories).ink }} /></span></span>
            <span className="v2-row-end"><strong className="amount">{plainAmount(item.amountMinor)}</strong><small className="v2-muted">{percent}%</small></span>
          </li>;
        })}</ul>
      </section></aside>}
    </div> : <section className="v2-card v2-group-picker" aria-labelledby="group-picker-title">
      <header className="v2-card-head"><h2 id="group-picker-title">{mode === "add" ? `Add to ${group.name}` : `Take out of ${group.name}`}</h2><button type="button" className="v2-link is-plain" disabled={saving} onClick={() => switchMode("view")}>Cancel</button></header>
      <label className="v2-search"><MagnifyingGlass size={18} aria-hidden /><input type="search" aria-label="Search transactions" placeholder="Search note, category, amount or account" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }} /></label>
      <div className="v2-chip-row v2-group-filters" role="group" aria-label="Type">
        {KIND_FILTERS.map((option) => <button type="button" key={option.id} aria-pressed={kind === option.id} className={kind === option.id ? "v2-chip active" : "v2-chip"} onClick={() => { setKind(option.id); setVisibleCount(PAGE_SIZE); }}>{option.label}</button>)}
        {mode === "add" && hasDates && <button type="button" aria-pressed={onlyDates} className={onlyDates ? "v2-chip active" : "v2-chip"} onClick={() => { setOnlyDates((value) => !value); setVisibleCount(PAGE_SIZE); }}><CalendarBlank size={15} />Only {groupDatesText({ from: group.startOn, to: group.endOn }) ?? "these dates"}</button>}
      </div>
      <div className="v2-group-pick-head">
        <span>{matching.length} {matching.length === 1 ? "entry" : "entries"}</span>
        {matching.length > 0 && <button type="button" className="v2-link is-plain" onClick={toggleAllMatching}>{allMatchingSelected ? "Unselect these" : `Select ${Math.min(matching.length, GROUP_ASSIGN_LIMIT)}`}</button>}
      </div>
      <ul className="v2-rows v2-pick-list" aria-label={mode === "add" ? "Transactions to add" : "Transactions to remove"}>
        {matching.slice(0, visibleCount).map((entry) => {
          const checked = selected.has(entry.id);
          const title = entry.note || getCategory(entry.category, customCategories).label;
          const elsewhere = mode === "add" && entry.groupId ? groupNames.get(entry.groupId) : null;
          return <li key={entry.id} className={checked ? "is-selected" : undefined}>
            <label className="v2-row v2-pick-row">
              <input type="checkbox" aria-label={`Select ${title}, ${formatMoney(entry.amountMinor, currency)}`} checked={checked} onChange={() => toggle(entry.id)} />
              <CategoryTile category={entry.category} custom={customCategories} size={38} />
              <span className="v2-row-main"><strong>{title}</strong><small>{formatLedgerDate(entry.occurredOn, calendarSystem)} · {categoryText(entry)}{elsewhere && <> · <span className="v2-group-elsewhere">In {elsewhere}</span></>}</small></span>
              <span className="v2-row-end"><strong className={`v2-money${entry.kind === "income" ? " is-in" : ""}`}>{entry.kind === "income" ? "+" : ""}{plainAmount(entry.amountMinor)}</strong></span>
            </label>
          </li>;
        })}
      </ul>
      {!matching.length && <div className="v2-group-empty-entries"><p className="v2-empty">{useDates ? "Nothing else on these dates. Show all dates to pick from your whole history." : mode === "add" ? "No matching entries. Try another search or type." : "No matching entries. Try another search."}</p>{useDates && <button type="button" className="v2-button is-small" onClick={() => setOnlyDates(false)}>Show all dates</button>}</div>}
      {pagination(matching.length)}
      <FormError message={error} />
      <div className="v2-pick-bar">
        <div aria-live="polite"><strong>{selectedIds.length} selected</strong><span>{mode === "add" ? "They keep their dates, amounts and accounts" : "They stay in your ledger, ungrouped"}</span></div>
        {selectedIds.length > 0 && <button type="button" className="v2-button" disabled={saving} onClick={() => setSelected(new Set())}>Clear</button>}
        <button type="button" className={`v2-button ${mode === "remove" ? "is-danger" : "is-primary"}`} disabled={!selectedIds.length || saving} onClick={() => void apply()}>{saving ? <ButtonSpinner /> : null}{mode === "add" ? `Add${selectedIds.length ? ` ${selectedIds.length}` : ""}` : `Take out${selectedIds.length ? ` ${selectedIds.length}` : ""}`}</button>
      </div>
    </section>}
    <GroupFormSheet open={editing} group={group} calendarSystem={calendarSystem} onSave={async (draft) => { await onSaveGroup(draft, group.id); setEditing(false); }} onClose={() => setEditing(false)} />
  </div>;
}
