"use client";

import { DatePicker } from "@mantine/dates";
import { Popover } from "@mantine/core";
import { CaretLeft, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { CategoryIcon } from "../components/CategoryIcon";
import { FormError } from "../components/FormError";
import { useToasts } from "../context/ToastContext";
import { batchRowToDraft, batchSummary, isBlankRow, newBatchRow, rowAmountValid, rowIssues, suggestFromHistory, type BatchDefaults, type BatchRow } from "../lib/batch-entry";
import { getCategory, pickerCategoriesFor } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { formatLedgerDate, todayInput } from "../lib/dates";
import { onlinePaymentAccounts, paymentAccountLabel } from "../lib/payment-accounts";
import { shiftDateKey } from "../lib/transaction-defaults";
import { toUserMessage } from "../lib/user-messages";
import type { CalendarSystem, CurrencyCode, CustomCategory, ImportJob, LedgerTransaction, PaymentAccount, TransactionDraft, TransactionKind } from "../types";

interface AddMultiplePageProps {
  currency: CurrencyCode;
  calendarSystem: CalendarSystem;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  paymentAccounts: PaymentAccount[];
  ownerId?: string;
  onImport: (drafts: TransactionDraft[]) => Promise<ImportJob | null>;
}

const QUICK_CATEGORIES = 5;

function DateChoice({ value, today, calendarSystem, onChange }: { value: string; today: string; calendarSystem: CalendarSystem; onChange: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const yesterday = shiftDateKey(today, -1);
  const custom = value !== today && value !== yesterday;
  return <div className="multi-options" role="group" aria-label="Date">
    <button type="button" className={value === today ? "multi-option on" : "multi-option"} onClick={() => onChange(today)}>Today</button>
    <button type="button" className={value === yesterday ? "multi-option on" : "multi-option"} onClick={() => onChange(yesterday)}>Yesterday</button>
    <Popover opened={open} onChange={setOpen} position="bottom-start" shadow="md">
      <Popover.Target><button type="button" className={custom ? "multi-option on" : "multi-option"} onClick={() => setOpen((current) => !current)}>{custom ? formatLedgerDate(value, calendarSystem) : "Pick…"}</button></Popover.Target>
      <Popover.Dropdown className="day-picker-popover"><DatePicker value={value} maxDate={today} firstDayOfWeek={0} onChange={(next) => { if (next) { onChange(next); setOpen(false); } }} /></Popover.Dropdown>
    </Popover>
  </div>;
}

export function AddMultiplePage({ currency, calendarSystem, transactions, customCategories, paymentAccounts, ownerId, onImport }: AddMultiplePageProps) {
  const router = useRouter();
  const { push: pushToast } = useToasts();
  const today = todayInput();
  const accounts = useMemo(() => onlinePaymentAccounts(paymentAccounts).filter((account) => !ownerId || account.userId === ownerId), [ownerId, paymentAccounts]);
  const [defaults, setDefaults] = useState<BatchDefaults>({ kind: "expense", occurredOn: today, paymentMode: "cash", paymentAccountId: "" });
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [draft, setDraft] = useState<BatchRow>(() => newBatchRow({ kind: "expense", occurredOn: today, paymentMode: "cash", paymentAccountId: "" }));
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const noteRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const accountOptions = useMemo(() => [
    { id: "", label: "Cash" },
    ...accounts.map((account) => ({ id: account.id, label: paymentAccountLabel(account) })),
  ], [accounts]);
  const accountLabel = (row: Pick<BatchRow, "paymentMode" | "paymentAccountId">) => row.paymentMode === "online" ? accountOptions.find((option) => option.id === row.paymentAccountId)?.label ?? "Choose account" : "Cash";
  const categoriesFor = (kind: TransactionKind) => pickerCategoriesFor(kind, customCategories);

  const pending = isBlankRow(draft) ? [] : [draft];
  const allRows = [...rows, ...pending];
  const summary = batchSummary(allRows);
  const draftHasAmountOnly = pending.length > 0 && !rowAmountValid(draft);

  const applyDefaults = (change: Partial<typeof defaults>) => {
    const next = { ...defaults, ...change };
    setDefaults(next);
    // Lines you have not added yet follow the defaults; added lines keep what they were given.
    setDraft((current) => ({ ...current, ...(change.kind ? { kind: change.kind, category: current.categoryChosen && categoriesFor(change.kind).some((category) => category.id === current.category) ? current.category : "", categoryChosen: false } : {}), ...(change.occurredOn ? { occurredOn: change.occurredOn } : {}), ...(change.paymentMode ? { paymentMode: change.paymentMode, paymentAccountId: change.paymentAccountId ?? "" } : {}) }));
  };
  const chooseDefaultAccount = (id: string) => applyDefaults(id ? { paymentMode: "online", paymentAccountId: id } : { paymentMode: "cash", paymentAccountId: "" });

  const changeDraftNote = (note: string) => setDraft((current) => {
    const next = { ...current, note };
    if (current.categoryChosen) return next;
    const suggestion = suggestFromHistory(note, current.kind, transactions, ownerId);
    if (!suggestion) return { ...next, category: "" };
    const accountOk = suggestion.paymentMode !== "online" || accounts.some((account) => account.id === suggestion.paymentAccountId);
    return { ...next, category: suggestion.category, ...(accountOk && suggestion.paymentMode !== "cheque" ? { paymentMode: suggestion.paymentMode, paymentAccountId: suggestion.paymentAccountId } : {}) };
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
  const quick = showAllCategories ? draftCategories : draftCategories.slice(0, QUICK_CATEGORIES);

  const renderIcon = (row: BatchRow, size = 38) => row.category
    ? <span className="multi-icon" style={{ width: size, height: size }}><CategoryIcon category={row.category} icon={getCategory(row.category, customCategories).icon} size={Math.round(size / 2)} /></span>
    : <span className="multi-icon is-missing" style={{ width: size, height: size }} aria-hidden>?</span>;

  return <section className="multi-page" aria-labelledby="multi-title">
    <Link href="/transactions" className="multi-back"><CaretLeft size={15} weight="bold" />Transactions</Link>
    <h1 id="multi-title">Add multiple</h1>
    <div className="multi-defaults" aria-label="Applies to new lines">
      <span className="multi-defaults-label">New lines</span>
      <div className="multi-options" role="group" aria-label="Type">
        {(["expense", "income"] as const).map((kind) => <button type="button" key={kind} className={defaults.kind === kind ? "multi-option on" : "multi-option"} onClick={() => applyDefaults({ kind })}>{kind === "expense" ? "Expense" : "Income"}</button>)}
      </div>
      <DateChoice value={defaults.occurredOn} today={today} calendarSystem={calendarSystem} onChange={(occurredOn) => applyDefaults({ occurredOn })} />
      <div className="multi-options" role="group" aria-label="Paid with">
        {accountOptions.map((option) => <button type="button" key={option.id || "cash"} className={(defaults.paymentAccountId || "") === option.id ? "multi-option on" : "multi-option"} onClick={() => chooseDefaultAccount(option.id)}>{option.label}</button>)}
      </div>
    </div>

    <ul className="multi-list" aria-label="Transactions to add">
      {rows.map((row) => {
        const issues = rowIssues(row);
        const open = openId === row.id;
        const sub = [row.occurredOn !== defaults.occurredOn ? formatLedgerDate(row.occurredOn, calendarSystem) : "", row.paymentMode !== defaults.paymentMode || row.paymentAccountId !== defaults.paymentAccountId ? accountLabel(row) : ""].filter(Boolean).join(" · ");
        return <li key={row.id} className={open ? "multi-item is-open" : "multi-item"}>
          <button type="button" className="multi-item-main" aria-expanded={open} onClick={() => setOpenId(open ? null : row.id)}>
            {renderIcon(row)}
            <span className="multi-item-text"><strong>{row.note || (row.category ? getCategory(row.category, customCategories).label : "No note")}</strong>
              {issues.includes("category") ? <small className="is-warning">Tap to pick a category</small> : issues.includes("account") ? <small className="is-warning">Choose an account</small> : sub ? <small>{sub}</small> : null}</span>
            <span className={row.kind === "income" ? "multi-amount is-income" : "multi-amount"}>{row.kind === "income" ? "+" : ""}{row.amount}</span>
          </button>
          {open && <div className="multi-details">
            <div className="multi-field"><label htmlFor={`note-${row.id}`}>Note</label><div className="multi-inline"><input id={`note-${row.id}`} value={row.note} onChange={(event) => updateRow(row.id, { note: event.target.value })} placeholder="What was it for?" /><input aria-label="Amount" inputMode="decimal" value={row.amount} onChange={(event) => updateRow(row.id, { amount: event.target.value.replace(/[^\d.,]/g, "") })} /></div></div>
            <div className="multi-field"><span>Type</span><div className="multi-options">{(["expense", "income"] as const).map((kind) => <button type="button" key={kind} className={row.kind === kind ? "multi-option on" : "multi-option"} onClick={() => updateRow(row.id, { kind, ...(categoriesFor(kind).some((category) => category.id === row.category) ? {} : { category: "", categoryChosen: false }) })}>{kind === "expense" ? "Expense" : "Income"}</button>)}</div></div>
            <div className="multi-field"><span>Category</span><div className="multi-options">{categoriesFor(row.kind).map((category) => <button type="button" key={category.id} className={row.category === category.id ? "multi-option on" : "multi-option"} onClick={() => updateRow(row.id, { category: category.id, categoryChosen: true })}>{category.label}</button>)}</div></div>
            <div className="multi-field"><span>Paid with</span><div className="multi-options">{accountOptions.map((option) => <button type="button" key={option.id || "cash"} className={(row.paymentMode === "online" ? row.paymentAccountId : "") === option.id ? "multi-option on" : "multi-option"} onClick={() => updateRow(row.id, option.id ? { paymentMode: "online", paymentAccountId: option.id } : { paymentMode: "cash", paymentAccountId: "" })}>{option.label}</button>)}</div></div>
            <div className="multi-field"><span>Date</span><DateChoice value={row.occurredOn} today={today} calendarSystem={calendarSystem} onChange={(occurredOn) => updateRow(row.id, { occurredOn })} /></div>
            <div className="multi-details-actions"><button type="button" className="multi-remove" onClick={() => removeRow(row.id)}>Remove</button><button type="button" className="multi-done" onClick={() => setOpenId(null)}>Done</button></div>
          </div>}
        </li>;
      })}
    </ul>

    <form className="multi-entry" onSubmit={(event) => { event.preventDefault(); addDraft(); }}>
      <div className="multi-entry-line">
        {renderIcon(draft, 34)}
        <input ref={noteRef} className="multi-note" aria-label="What was it for?" placeholder="What was it for?" value={draft.note} onChange={(event) => changeDraftNote(event.target.value)} autoFocus />
        <input ref={amountRef} className="multi-amount-input" aria-label="Amount" inputMode="decimal" placeholder="0" value={draft.amount} onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value.replace(/[^\d.,]/g, "") }))} />
        <button type="submit" className="multi-add" aria-label="Add to list" disabled={!rowAmountValid(draft)}><Plus size={18} weight="bold" /></button>
      </div>
      <div className="multi-strip" role="group" aria-label="Category">
        {quick.map((category) => <button type="button" key={category.id} className={draft.category === category.id ? "multi-chip on" : "multi-chip"} onClick={() => setDraft((current) => ({ ...current, category: category.id, categoryChosen: true }))}><CategoryIcon category={category.id} icon={category.icon} size={15} />{category.label}</button>)}
        {!showAllCategories && draftCategories.length > QUICK_CATEGORIES && <button type="button" className="multi-chip" onClick={() => setShowAllCategories(true)}>More</button>}
      </div>
      <p className="multi-hint">Type what it was and the amount, then press Enter. Tap a line above to change its details.</p>
    </form>

    <FormError message={error} />
    <div className="multi-bar">
      <div className="multi-total"><strong>{summary.count} {summary.count === 1 ? "transaction" : "transactions"}</strong>
        <span>{summary.blocked ? <em>{summary.blocked} still need details</em> : [summary.outMinor ? `${formatMoney(summary.outMinor, currency)} out` : "", summary.inMinor ? `${formatMoney(summary.inMinor, currency)} in` : ""].filter(Boolean).join(" · ") || "Nothing added yet"}</span></div>
      <button type="button" className="primary-button" disabled={!summary.ready || saving} onClick={() => void save()}>{saving ? <ButtonSpinner /> : null}Save {summary.count || ""}</button>
    </div>
  </section>;
}
