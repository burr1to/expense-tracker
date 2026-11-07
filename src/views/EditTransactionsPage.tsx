"use client";

import { CaretLeft, LockSimple, MagnifyingGlass, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { CategoryIcon } from "../components/CategoryIcon";
import { CategoryPickerSheet, type CategoryPick } from "../components/CategoryPickerSheet";
import { EmptyState } from "../components/EmptyState";
import { FormError } from "../components/FormError";
import { applyBulkChanges, BULK_EDIT_LIMIT, bulkEditTargets, hasBulkChanges, lockedByReconciliation, previewBulkEdit, type BulkChanges } from "../lib/bulk-edit";
import { getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { formatLedgerDate, todayInput } from "../lib/dates";
import { onlinePaymentAccounts, paymentAccountLabel } from "../lib/payment-accounts";
import { filterTransactionHistory } from "../lib/transaction-history";
import { toUserMessage } from "../lib/user-messages";
import type { AccountReconciliation, CalendarSystem, CurrencyCode, CustomCategory, CustomSubcategory, LedgerTransaction, PaymentAccount, TransactionKind } from "../types";
import { AccountChoice, DateChoice } from "./AddMultiplePage";

interface EditTransactionsPageProps {
  currency: CurrencyCode;
  calendarSystem: CalendarSystem;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  customSubcategories: CustomSubcategory[];
  paymentAccounts: PaymentAccount[];
  reconciliations: AccountReconciliation[];
  ownerId?: string;
  onSave: (ids: string[], changes: BulkChanges) => Promise<void>;
}

const PAGE_SIZE = 50;
const KEEP = "keep";
type KindFilter = TransactionKind | "all";
const KIND_FILTERS: { id: KindFilter; label: string }[] = [{ id: "all", label: "All" }, { id: "expense", label: "Expenses" }, { id: "income", label: "Income" }];

export function EditTransactionsPage({ currency, calendarSystem, transactions, customCategories, customSubcategories, paymentAccounts, reconciliations, ownerId, onSave }: EditTransactionsPageProps) {
  const today = todayInput();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [changes, setChanges] = useState<BulkChanges>({});
  const [picking, setPicking] = useState<CategoryPick | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // A partner's shared entries stay theirs to edit; the server refuses them too.
  const own = useMemo(() => transactions.filter((entry) => !ownerId || entry.userId === ownerId), [ownerId, transactions]);
  const accounts = useMemo(() => onlinePaymentAccounts(paymentAccounts).filter((account) => !ownerId || account.userId === ownerId), [ownerId, paymentAccounts]);
  const accountOptions = useMemo(() => [
    { id: KEEP, label: "Keep each entry's" },
    { id: "", label: "Cash" },
    ...accounts.map((account) => ({ id: account.id, label: paymentAccountLabel(account) })),
  ], [accounts]);
  const matching = useMemo(() => filterTransactionHistory(own, customCategories, { scope: "history", selectedDayKey: "", kind, category: "all", from: "", to: "", minMinor: null, maxMinor: null, paymentMode: "all", query }, paymentAccounts), [customCategories, kind, own, paymentAccounts, query]);
  const lockedIds = useMemo(() => new Set(own.filter((entry) => lockedByReconciliation(entry, reconciliations)).map((entry) => entry.id)), [own, reconciliations]);
  // Entries removed or locked since they were picked drop out of the selection on their own.
  const selectedEntries = useMemo(() => own.filter((entry) => selected.has(entry.id) && !lockedIds.has(entry.id)), [lockedIds, own, selected]);
  const selectable = matching.filter((entry) => !lockedIds.has(entry.id));
  const allMatchingSelected = selectable.length > 0 && selectable.every((entry) => selected.has(entry.id));
  const hiddenSelected = selectedEntries.filter((entry) => !matching.includes(entry)).length;
  const preview = previewBulkEdit(selectedEntries, changes, reconciliations);
  const canSave = preview.changed > 0 && preview.intoLocked === 0 && !saving;

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else if (next.size < BULK_EDIT_LIMIT) next.add(id);
    return next;
  });
  const toggleAllMatching = () => setSelected((current) => {
    const next = new Set(current);
    if (allMatchingSelected) for (const entry of selectable) next.delete(entry.id);
    else for (const entry of selectable) { if (next.size >= BULK_EDIT_LIMIT) break; next.add(entry.id); }
    return next;
  });
  const setChange = <K extends keyof BulkChanges>(key: K, value: BulkChanges[K] | undefined) => {
    setChanges((current) => {
      const next = { ...current };
      if (value === undefined) delete next[key]; else next[key] = value;
      return next;
    });
    setError("");
  };

  const kinds = new Set(selectedEntries.map((entry) => entry.kind));
  const openPicker = () => setPicking({ kind: changes.category?.kind ?? (kinds.size === 1 ? [...kinds][0] : "expense"), category: changes.category?.category ?? "", subcategory: changes.category?.subcategory ?? "" });
  const categoryText = (category: string, subcategory: string | null) => [getCategory(category, customCategories).label, subcategory].filter(Boolean).join(" · ");
  const accountText = (entry: Pick<LedgerTransaction, "paymentMode" | "paymentAccountId">) => {
    if (entry.paymentMode === "cheque") return "Cheque";
    if (entry.paymentMode !== "online") return "Cash";
    const account = paymentAccounts.find((item) => item.id === entry.paymentAccountId);
    return account ? paymentAccountLabel(account) : "Online";
  };

  const save = async () => {
    if (!canSave) return;
    const targets = bulkEditTargets(selectedEntries, changes);
    if (preview.kindSwitches && !window.confirm(`${preview.kindSwitches} ${preview.kindSwitches === 1 ? "entry switches" : "entries switch"} to ${changes.category?.kind === "income" ? "income" : "expense"}, which moves ${preview.kindSwitches === 1 ? "it" : "them"} between your spending and earnings. Save anyway?`)) return;
    setSaving(true);
    setError("");
    try {
      await onSave(targets.map((entry) => entry.id), changes);
      setSelected(new Set());
      setChanges({});
    } catch (caught) {
      setError(toUserMessage(caught, null, "Could not save these changes. Nothing was changed, so you can try again."));
    } finally {
      setSaving(false);
    }
  };

  // Shows each changed part of a selected entry as it will read, marked, so the list doubles as the review.
  const part = (before: string, after: string, key: string): ReactNode => before === after ? <span key={key}>{before}</span> : <mark key={key} className="edit-change" title={`Was ${before}`}>{after}</mark>;
  const joinParts = (parts: ReactNode[]) => parts.flatMap((item, index) => index ? [<span key={`dot-${index}`} aria-hidden> · </span>, item] : [item]);

  const summary = !selectedEntries.length
    ? "Select the entries to change"
    : !hasBulkChanges(changes)
      ? "Choose what to change above"
      : [`${preview.changed} will change`, preview.unchanged ? `${preview.unchanged} already match` : ""].filter(Boolean).join(" · ");

  return <div className="page">
    <section className="multi-page edit-page" aria-labelledby="edit-title">
      <Link href="/transactions" className="multi-back"><CaretLeft size={16} weight="bold" />Transactions</Link>
      <h1 id="edit-title">Edit transactions</h1>
      <p className="multi-lede">Select several entries, choose a new category, date or account once, and check the marked changes before saving.</p>

      <div className="multi-defaults edit-changes" aria-label="Change selected entries">
        <div className="multi-default"><span>Category</span>
          <div className="edit-choice">
            <button type="button" className={changes.category ? "multi-category-button" : "multi-category-button is-keep"} onClick={openPicker}>
              {changes.category
                ? <span className={`multi-icon is-${changes.category.kind}`} style={{ width: 26, height: 26 }}><CategoryIcon category={changes.category.category} icon={getCategory(changes.category.category, customCategories).icon} size={13} /></span>
                : null}
              <span>{changes.category ? categoryText(changes.category.category, changes.category.subcategory) : "Keep each entry's"}</span><em>{changes.category ? "Change" : "Choose"}</em>
            </button>
            {changes.category && <button type="button" className="icon-button edit-clear" aria-label="Keep each entry's category" onClick={() => setChange("category", undefined)}><X size={15} /></button>}
          </div>
        </div>
        <div className="multi-default"><span>Date</span>
          <div className="edit-choice">
            <button type="button" className={changes.occurredOn ? "multi-option" : "multi-option on"} onClick={() => setChange("occurredOn", undefined)}>Keep</button>
            <DateChoice value={changes.occurredOn ?? ""} today={today} calendarSystem={calendarSystem} onChange={(occurredOn) => setChange("occurredOn", occurredOn)} />
          </div>
        </div>
        <div className="multi-default"><span>Paid with</span>
          <AccountChoice value={changes.payment ? changes.payment.paymentAccountId : KEEP} options={accountOptions} onChange={(id) => setChange("payment", id === KEEP ? undefined : id ? { paymentMode: "online", paymentAccountId: id } : { paymentMode: "cash", paymentAccountId: "" })} />
        </div>
      </div>

      <div className="edit-filters">
        <label className="edit-search"><MagnifyingGlass size={17} aria-hidden /><input type="search" aria-label="Search transactions" placeholder="Search note, category, amount or account" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }} /></label>
        <div className="multi-options" role="group" aria-label="Type">
          {KIND_FILTERS.map((option) => <button type="button" key={option.id} aria-pressed={kind === option.id} className={kind === option.id ? "multi-option on" : "multi-option"} onClick={() => { setKind(option.id); setVisibleCount(PAGE_SIZE); }}>{option.label}</button>)}
        </div>
      </div>

      <div className="edit-list-heading">
        <span>{matching.length} {matching.length === 1 ? "entry" : "entries"}</span>
        {selectable.length > 0 && <button type="button" className="text-button" onClick={toggleAllMatching}>{allMatchingSelected ? "Unselect these" : `Select ${Math.min(selectable.length, BULK_EDIT_LIMIT)}`}</button>}
      </div>
      <ul className="multi-list edit-list" aria-label="Transactions to edit">
        {matching.slice(0, visibleCount).map((entry) => {
          const locked = lockedIds.has(entry.id);
          const checked = !locked && selected.has(entry.id);
          const next = checked ? applyBulkChanges(entry, changes) : entry;
          // A note-less entry is titled by its category, so the title follows a category change in the preview.
          const title = next.note || getCategory(next.category, customCategories).label;
          const parts = joinParts([
            part(formatLedgerDate(entry.occurredOn, calendarSystem), formatLedgerDate(next.occurredOn, calendarSystem), "date"),
            part(categoryText(entry.category, entry.subcategory), categoryText(next.category, next.subcategory), "category"),
            part(accountText(entry), accountText(next), "account"),
          ]);
          return <li key={entry.id} className={`multi-item edit-item${checked ? " is-selected" : ""}${locked ? " is-locked" : ""}`}>
            <label className="edit-item-row">
              <input type="checkbox" aria-label={`Select ${title}, ${formatMoney(entry.amountMinor, currency)}`} checked={checked} disabled={locked} onChange={() => toggle(entry.id)} aria-describedby={locked ? `locked-${entry.id}` : undefined} />
              <span className={`multi-icon is-${next.kind}`} style={{ width: 36, height: 36 }} aria-hidden><CategoryIcon category={next.category} icon={getCategory(next.category, customCategories).icon} size={18} /></span>
              <span className="multi-item-text"><strong>{title}</strong>
                <small>{locked ? <span id={`locked-${entry.id}`} className="edit-locked"><LockSimple size={12} weight="bold" aria-hidden />Reconciled · {formatLedgerDate(entry.occurredOn, calendarSystem)}</span> : parts}</small></span>
              <span className={`multi-amount is-${next.kind}`}>{next.kind !== entry.kind ? <mark className="edit-change" title={`Was ${entry.kind}`}>{next.kind === "income" ? "+" : "−"}</mark> : next.kind === "income" ? "+" : "−"}{formatMoney(entry.amountMinor, currency)}</span>
            </label>
          </li>;
        })}
      </ul>
      {!matching.length && <EmptyState title="No matching entries" message={own.length ? "Try another search or type." : "Add a transaction first, then come back to edit several at once."} />}
      {visibleCount < matching.length && <nav className="transaction-history-pagination" aria-label="More transactions"><span aria-live="polite">Showing {visibleCount} of {matching.length}</span><button type="button" className="secondary-button small" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Load {PAGE_SIZE} more</button></nav>}

      <FormError message={error} />
      <div className="multi-bar">
        <div className="multi-total" aria-live="polite"><strong>{selectedEntries.length} selected{hiddenSelected ? ` · ${hiddenSelected} not shown` : ""}</strong>
          <span>{summary}{preview.kindSwitches > 0 && <em> · {preview.kindSwitches} switch type</em>}{preview.intoLocked > 0 && <em> · {preview.intoLocked} would land in a reconciled period</em>}</span></div>
        <div className="edit-bar-actions">
          {selectedEntries.length > 0 && <button type="button" className="secondary-button" disabled={saving} onClick={() => setSelected(new Set())}>Clear</button>}
          <button type="button" className="primary-button" disabled={!canSave} onClick={() => void save()}>{saving ? <ButtonSpinner /> : null}Save{preview.changed ? ` ${preview.changed}` : ""}</button>
        </div>
      </div>
    </section>
    <CategoryPickerSheet value={picking} customCategories={customCategories} customSubcategories={customSubcategories} onPick={(pick) => { setChange("category", pick); setPicking(null); }} onClose={() => setPicking(null)} />
  </div>;
}
