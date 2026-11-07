"use client";

import { DatePicker } from "@mantine/dates";
import { Popover } from "@mantine/core";
import { CaretDown, CaretLeft, Check, MapPin, Plus, SquaresFour } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { CategoryIcon } from "../components/CategoryIcon";
import { CategoryPickerSheet, type CategoryPick } from "../components/CategoryPickerSheet";
import { EntrySuggestions, useEntrySuggestions } from "../components/EntrySuggestions";
import { FormError } from "../components/FormError";
import { LocationPicker } from "../components/LocationPicker";
import { useToasts } from "../context/ToastContext";
import { batchRowToDraft, batchSummary, frequentCategories, isBlankRow, newBatchRow, rowAmountValid, rowChangeFromEntry, rowIssues, suggestFromHistory, type BatchDefaults, type BatchRow } from "../lib/batch-entry";
import { getCategory, pickerCategoriesFor } from "../lib/categories";
import { formatMoney, majorToMinor } from "../lib/currency";
import { formatLedgerDate, todayInput } from "../lib/dates";
import { paymentLabel } from "../lib/entry-labels";
import { onlinePaymentAccounts, paymentAccountLabel } from "../lib/payment-accounts";
import { shiftDateKey } from "../lib/transaction-defaults";
import { recentLocationsFrom } from "../lib/transaction-suggestions";
import { toUserMessage } from "../lib/user-messages";
import type { CalendarSystem, CurrencyCode, CustomCategory, CustomSubcategory, ImportJob, LedgerTransaction, PaymentAccount, SavedPlace, TransactionDraft, TransactionKind } from "../types";

interface AddMultiplePageProps {
  currency: CurrencyCode;
  calendarSystem: CalendarSystem;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  customSubcategories: CustomSubcategory[];
  paymentAccounts: PaymentAccount[];
  savedPlaces: SavedPlace[];
  ownerId?: string;
  onImport: (drafts: TransactionDraft[]) => Promise<ImportJob | null>;
}

const QUICK_CATEGORIES = 5;
const KIND_LABEL: Record<TransactionKind, string> = { expense: "Expense", income: "Income" };

function KindToggle({ value, onChange }: { value: TransactionKind; onChange: (kind: TransactionKind) => void }) {
  return <div className="kind-toggle" role="group" aria-label="Type">
    {(["expense", "income"] as const).map((kind) => <button type="button" key={kind} className={`kind-toggle-option is-${kind}${value === kind ? " on" : ""}`} aria-pressed={value === kind} onClick={() => onChange(kind)}>{KIND_LABEL[kind]}</button>)}
  </div>;
}

export function DateChoice({ value, today, calendarSystem, onChange }: { value: string; today: string; calendarSystem: CalendarSystem; onChange: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const yesterday = shiftDateKey(today, -1);
  // An empty value means no date is chosen yet, as when a bulk edit keeps each entry's own date.
  const custom = Boolean(value) && value !== today && value !== yesterday;
  return <div className="multi-options" role="group" aria-label="Date">
    <button type="button" className={value === today ? "multi-option on" : "multi-option"} onClick={() => onChange(today)}>Today</button>
    <button type="button" className={value === yesterday ? "multi-option on" : "multi-option"} onClick={() => onChange(yesterday)}>Yesterday</button>
    <Popover opened={open} onChange={setOpen} position="bottom-start" shadow="md">
      <Popover.Target><button type="button" className={custom ? "multi-option on" : "multi-option"} onClick={() => setOpen((current) => !current)}>{custom ? formatLedgerDate(value, calendarSystem) : "Pick date"}</button></Popover.Target>
      <Popover.Dropdown className="day-picker-popover"><DatePicker value={value} maxDate={today} firstDayOfWeek={0} onChange={(next) => { if (next) { onChange(next); setOpen(false); } }} /></Popover.Dropdown>
    </Popover>
  </div>;
}

export function AccountChoice({ value, options, onChange }: { value: string; options: { id: string; label: string }[]; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.id === value);
  return <Popover opened={open} onChange={setOpen} position="bottom-start" shadow="md" width="target">
    <Popover.Target><button type="button" className="multi-select" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((shown) => !shown)}><span>{current?.label ?? "Choose account"}</span><CaretDown size={14} weight="bold" /></button></Popover.Target>
    <Popover.Dropdown className="multi-select-menu">
      <div role="listbox" aria-label="Paid with">
        {options.map((option) => <button type="button" role="option" aria-selected={option.id === value} key={option.id || "cash"} className={option.id === value ? "multi-select-option on" : "multi-select-option"} onClick={() => { onChange(option.id); setOpen(false); }}><span>{option.label}</span>{option.id === value && <Check size={14} weight="bold" />}</button>)}
      </div>
    </Popover.Dropdown>
  </Popover>;
}

export function AddMultiplePage({ currency, calendarSystem, transactions, customCategories, customSubcategories, paymentAccounts, savedPlaces, ownerId, onImport }: AddMultiplePageProps) {
  const router = useRouter();
  const { push: pushToast } = useToasts();
  const today = todayInput();
  const accounts = useMemo(() => onlinePaymentAccounts(paymentAccounts).filter((account) => !ownerId || account.userId === ownerId), [ownerId, paymentAccounts]);
  const [defaults, setDefaults] = useState<BatchDefaults>({ kind: "expense", occurredOn: today, paymentMode: "cash", paymentAccountId: "" });
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [draft, setDraft] = useState<BatchRow>(() => newBatchRow({ kind: "expense", occurredOn: today, paymentMode: "cash", paymentAccountId: "" }));
  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ id: string; value: CategoryPick } | null>(null);
  const [mapFor, setMapFor] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const noteRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const accountOptions = useMemo(() => [
    { id: "", label: "Cash" },
    ...accounts.map((account) => ({ id: account.id, label: paymentAccountLabel(account) })),
  ], [accounts]);
  const accountLabel = (row: Pick<BatchRow, "paymentMode" | "paymentAccountId">) => row.paymentMode === "online" ? accountOptions.find((option) => option.id === row.paymentAccountId)?.label ?? "Choose account" : "Cash";
  const accountChange = (id: string) => id ? { paymentMode: "online" as const, paymentAccountId: id } : { paymentMode: "cash" as const, paymentAccountId: "" };
  const categoriesFor = (kind: TransactionKind) => pickerCategoriesFor(kind, customCategories);
  // Switching a line between expense and income keeps its category only when the new type has it.
  const kindChange = (row: BatchRow, kind: TransactionKind): Partial<BatchRow> => categoriesFor(kind).some((category) => category.id === row.category) ? { kind } : { kind, category: "", subcategory: "", categoryChosen: false };

  const pending = isBlankRow(draft) ? [] : [draft];
  const allRows = [...rows, ...pending];
  const summary = batchSummary(allRows);
  const draftHasAmountOnly = pending.length > 0 && !rowAmountValid(draft);
  const recentLocations = useMemo(() => recentLocationsFrom(transactions), [transactions]);
  const suggestions = useEntrySuggestions(transactions, ownerId, draft.kind, draft.note, suggestOpen && !draft.categoryChosen);
  const accountIds = useMemo(() => new Set(accounts.map((account) => account.id)), [accounts]);
  const mapTarget = mapFor === null ? null : mapFor === draft.id ? draft : rows.find((row) => row.id === mapFor) ?? null;
  const pickSuggestion = (entry: Parameters<typeof rowChangeFromEntry>[0]) => {
    setDraft((current) => ({ ...current, ...rowChangeFromEntry(entry, accountIds) }));
    setSuggestOpen(false);
    window.setTimeout(() => amountRef.current?.focus(), 0);
  };
  const setLocation = (id: string, location: BatchRow["location"]) => id === draft.id ? setDraft((current) => ({ ...current, location })) : updateRow(id, { location });

  const applyDefaults = (change: Partial<BatchDefaults>) => {
    setDefaults((current) => ({ ...current, ...change }));
    // The line you are typing follows the defaults; added lines keep what they were given.
    setDraft((current) => ({ ...current, ...change }));
  };

  const changeDraftKind = (kind: TransactionKind) => {
    setDefaults((current) => ({ ...current, kind }));
    setDraft((current) => ({ ...current, ...kindChange(current, kind) }));
  };

  const changeDraftNote = (note: string) => setDraft((current) => {
    const next = { ...current, note };
    if (current.categoryChosen) return next;
    const suggestion = suggestFromHistory(note, current.kind, transactions, ownerId);
    if (!suggestion) return { ...next, category: "", subcategory: "" };
    const accountOk = suggestion.paymentMode !== "online" || accounts.some((account) => account.id === suggestion.paymentAccountId);
    return { ...next, category: suggestion.category, subcategory: suggestion.subcategory, ...(accountOk && suggestion.paymentMode !== "cheque" ? { paymentMode: suggestion.paymentMode, paymentAccountId: suggestion.paymentAccountId } : {}) };
  });

  const addDraft = () => {
    if (!rowAmountValid(draft)) { amountRef.current?.focus(); return; }
    setRows((current) => [...current, draft]);
    setDraft(newBatchRow(defaults));
    setError("");
    window.setTimeout(() => noteRef.current?.focus(), 0);
  };

  const updateRow = (id: string, change: Partial<BatchRow>) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...change } : row));
  const removeRow = (id: string) => { setRows((current) => current.filter((row) => row.id !== id)); setOpenId(null); };

  const openPicker = (row: BatchRow) => setPicking({ id: row.id, value: { kind: row.kind, category: row.category, subcategory: row.subcategory } });
  const applyPick = (pick: CategoryPick) => {
    const change = { kind: pick.kind, category: pick.category, subcategory: pick.subcategory, categoryChosen: true };
    if (picking?.id === draft.id) {
      setDraft((current) => ({ ...current, ...change }));
      setDefaults((current) => ({ ...current, kind: pick.kind }));
    } else if (picking) updateRow(picking.id, change);
    setPicking(null);
  };

  const save = async () => {
    if (draftHasAmountOnly) { setError("Finish or clear the line you are typing first."); return; }
    if (!summary.ready || saving) return;
    setSaving(true);
    setError("");
    try {
      await onImport(allRows.map(batchRowToDraft));
      pushToast({ title: `${allRows.length} ${allRows.length === 1 ? "transaction" : "transactions"} added`, tone: "success" });
      router.push("/transactions");
    } catch (caught) {
      setError(toUserMessage(caught, null, "Could not save these transactions. Nothing was added, so you can try again."));
      setSaving(false);
    }
  };

  const draftCategories = categoriesFor(draft.kind);
  const quick = useMemo(() => {
    const ids = frequentCategories(draft.kind, transactions, ownerId);
    const ordered = [...draftCategories].sort((a, b) => (ids.indexOf(a.id) + 1 || Infinity) - (ids.indexOf(b.id) + 1 || Infinity));
    const top = ordered.slice(0, QUICK_CATEGORIES);
    // A category picked from the full list stays visible as the selected chip.
    const picked = draftCategories.find((category) => category.id === draft.category);
    return picked && !top.includes(picked) ? [picked, ...top.slice(0, QUICK_CATEGORIES - 1)] : top;
  }, [draft.category, draft.kind, draftCategories, ownerId, transactions]);

  const categoryText = (row: BatchRow) => row.category ? [getCategory(row.category, customCategories).label, row.subcategory].filter(Boolean).join(" · ") : "";
  const amountText = (row: BatchRow) => rowAmountValid(row) ? formatMoney(majorToMinor(row.amount), currency) : row.amount || "No amount";
  const renderIcon = (row: BatchRow, size = 38) => row.category
    ? <span className={`multi-icon is-${row.kind}`} style={{ width: size, height: size }}><CategoryIcon category={row.category} icon={getCategory(row.category, customCategories).icon} size={Math.round(size / 2)} /></span>
    : <span className="multi-icon is-missing" style={{ width: size, height: size }} aria-hidden>?</span>;

  return <div className="page">
    <section className="multi-page" aria-labelledby="multi-title">
      <Link href="/transactions" className="multi-back"><CaretLeft size={16} weight="bold" />Transactions</Link>
      <h1 id="multi-title">Add multiple</h1>
      <p className="multi-lede">Log several expenses and incomes at once, then save them together.</p>

      <div className="multi-defaults" aria-label="Applies to new lines">
        <div className="multi-default"><span>Date</span><DateChoice value={defaults.occurredOn} today={today} calendarSystem={calendarSystem} onChange={(occurredOn) => applyDefaults({ occurredOn })} /></div>
        <div className="multi-default"><span>Paid with</span><AccountChoice value={defaults.paymentMode === "online" ? defaults.paymentAccountId : ""} options={accountOptions} onChange={(id) => applyDefaults(accountChange(id))} /></div>
      </div>

      <ul className="multi-list" aria-label="Transactions to add">
        {rows.map((row) => {
          const issues = rowIssues(row);
          const open = openId === row.id;
          const meta = [categoryText(row), row.location?.label ?? "", row.occurredOn !== defaults.occurredOn ? formatLedgerDate(row.occurredOn, calendarSystem) : "", row.paymentMode !== defaults.paymentMode || row.paymentAccountId !== defaults.paymentAccountId ? accountLabel(row) : ""].filter(Boolean).join(" · ");
          const title = row.note || (row.category ? getCategory(row.category, customCategories).label : "No note");
          return <li key={row.id} className={open ? "multi-item is-open" : "multi-item"}>
            <div className="multi-item-row">
              <button type="button" className="multi-item-hit" aria-expanded={open} aria-label={`${title}, ${amountText(row)}. ${open ? "Close details" : "Edit details"}`} onClick={() => setOpenId(open ? null : row.id)} />
              <button type="button" className="multi-icon-button" aria-label={row.category ? `Category: ${categoryText(row)}. Change` : "Choose a category"} onClick={() => openPicker(row)}>{renderIcon(row)}</button>
              <span className="multi-item-text" aria-hidden><strong>{title}</strong>
                {issues.includes("category") ? <small className="is-warning">Choose a category</small> : issues.includes("account") ? <small className="is-warning">Choose an account</small> : meta ? <small>{meta}</small> : null}</span>
              <button type="button" className={`kind-pill is-${row.kind}`} aria-label={`${KIND_LABEL[row.kind]}. Switch to ${row.kind === "expense" ? "income" : "expense"}`} onClick={() => updateRow(row.id, kindChange(row, row.kind === "expense" ? "income" : "expense"))}>{KIND_LABEL[row.kind]}</button>
              <span className={`multi-amount is-${row.kind}`} aria-hidden>{row.kind === "income" ? "+" : "−"}{amountText(row)}</span>
            </div>
            {open && <div className="multi-details">
              <div className="multi-inline"><input aria-label="Note" value={row.note} onChange={(event) => updateRow(row.id, { note: event.target.value })} placeholder="What was it for?" /><input aria-label="Amount" inputMode="decimal" value={row.amount} onChange={(event) => updateRow(row.id, { amount: event.target.value.replace(/[^\d.,]/g, "") })} /></div>
              <div className="multi-field"><span>Type</span><KindToggle value={row.kind} onChange={(kind) => updateRow(row.id, kindChange(row, kind))} /></div>
              <div className="multi-field"><span>Category</span><button type="button" className={row.category ? "multi-category-button" : "multi-category-button is-missing"} onClick={() => openPicker(row)}>{renderIcon(row, 30)}<span>{categoryText(row) || "Choose a category"}</span><em>Change</em></button></div>
              <div className="multi-field"><span>Paid with</span><AccountChoice value={row.paymentMode === "online" ? row.paymentAccountId : ""} options={accountOptions} onChange={(id) => updateRow(row.id, accountChange(id))} /></div>
              <div className="multi-field"><span>Place</span><div className="multi-place"><button type="button" className={row.location ? "multi-option on" : "multi-option"} onClick={() => setMapFor(row.id)}><MapPin size={15} weight={row.location ? "fill" : "regular"} />{row.location ? row.location.label : "Add place on map"}</button>{row.location && <button type="button" className="multi-remove" onClick={() => setLocation(row.id, null)}>Remove place</button>}</div></div>
              <div className="multi-field"><span>Date</span><DateChoice value={row.occurredOn} today={today} calendarSystem={calendarSystem} onChange={(occurredOn) => updateRow(row.id, { occurredOn })} /></div>
              <div className="multi-details-actions"><button type="button" className="multi-remove" onClick={() => removeRow(row.id)}>Remove</button><button type="button" className="secondary-button" onClick={() => setOpenId(null)}>Done</button></div>
            </div>}
          </li>;
        })}
      </ul>

      <form className="multi-entry" onSubmit={(event) => { event.preventDefault(); addDraft(); }}>
        <KindToggle value={draft.kind} onChange={changeDraftKind} />
        <div className={`multi-entry-line is-${draft.kind}`}>
          <button type="button" className="multi-icon-button" aria-label={draft.category ? `Category: ${categoryText(draft)}. Change` : "Choose a category"} onClick={() => openPicker(draft)}>{renderIcon(draft, 34)}</button>
          <div className="entry-suggest-wrap">
            <input ref={noteRef} className="multi-note" aria-label="What was it for?" placeholder={draft.kind === "income" ? "Where did it come from?" : "What was it for?"} value={draft.note} autoComplete="off" onFocus={() => setSuggestOpen(true)} onBlur={() => setSuggestOpen(false)} onChange={(event) => { setSuggestOpen(true); changeDraftNote(event.target.value); }} autoFocus />
            <EntrySuggestions suggestions={suggestions} customCategories={customCategories} accountText={(entry) => paymentLabel(entry, paymentAccounts)} onPick={pickSuggestion} />
          </div>
          <input ref={amountRef} className="multi-amount-input" aria-label="Amount" inputMode="decimal" placeholder="0" value={draft.amount} onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value.replace(/[^\d.,]/g, "") }))} />
          <button type="submit" className="multi-add" aria-label="Add to list" disabled={!rowAmountValid(draft)}><Plus size={18} weight="bold" /></button>
        </div>
        <div className="multi-strip" role="group" aria-label="Category">
          {quick.map((category) => <button type="button" key={category.id} aria-pressed={draft.category === category.id} className={draft.category === category.id ? "multi-chip on" : "multi-chip"} onClick={() => setDraft((current) => ({ ...current, category: category.id, subcategory: current.category === category.id ? current.subcategory : "", categoryChosen: true }))}><CategoryIcon category={category.id} icon={category.icon} size={15} />{draft.category === category.id && draft.subcategory ? `${category.label} · ${draft.subcategory}` : category.label}</button>)}
          <button type="button" className="multi-chip is-all" onClick={() => openPicker(draft)}><SquaresFour size={15} />All categories</button>
        </div>
        <div className="multi-place">
          <button type="button" className={draft.location ? "multi-option on" : "multi-option"} onClick={() => setMapFor(draft.id)}><MapPin size={15} weight={draft.location ? "fill" : "regular"} />{draft.location ? draft.location.label : "Add place on map"}</button>
          {draft.location && <button type="button" className="multi-remove" onClick={() => setLocation(draft.id, null)}>Remove place</button>}
        </div>
        <p className="multi-hint">Type what it was and the amount, then press Enter. Tap a line to edit it, or its pill to switch between expense and income.</p>
      </form>

      <FormError message={error} />
      <div className="multi-bar">
        <div className="multi-total"><strong>{summary.count} {summary.count === 1 ? "transaction" : "transactions"}</strong>
          <span>{summary.blocked ? <em>{summary.blocked} still need details</em> : [summary.outMinor ? `${formatMoney(summary.outMinor, currency)} out` : "", summary.inMinor ? `${formatMoney(summary.inMinor, currency)} in` : ""].filter(Boolean).join(" · ") || "Nothing added yet"}</span></div>
        <button type="button" className="primary-button" disabled={!summary.ready || saving} onClick={() => void save()}>{saving ? <ButtonSpinner /> : null}Save {summary.count || ""}</button>
      </div>
    </section>
    <LocationPicker open={mapFor !== null} value={mapTarget?.location ?? null} recentLocations={recentLocations} savedPlaces={savedPlaces} onClose={() => setMapFor(null)} onSelect={(location) => { if (mapFor) setLocation(mapFor, location); setMapFor(null); }} />
    <CategoryPickerSheet value={picking?.value ?? null} customCategories={customCategories} customSubcategories={customSubcategories} onPick={applyPick} onClose={() => setPicking(null)} />
  </div>;
}
