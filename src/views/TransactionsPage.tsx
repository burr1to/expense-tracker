import { CaretDown, DownloadSimple, FunnelSimple, MagnifyingGlass, Plus, UploadSimple, X } from "@phosphor-icons/react";
import { NumberInput, Popover, Select, TextInput } from "@mantine/core";
import { DatePicker } from "@mantine/dates";
import { format, isSameMonth, parseISO, startOfMonth } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { AnimatedOverlay } from "../components/AnimatedOverlay";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { LedgerDatePickerInput as DatePickerInput } from "../components/LedgerDatePickerInput";
import { MonthPicker } from "../components/MonthPicker";
import { TransactionRow } from "../components/TransactionRow";
import { ReceiptScanner } from "../components/ReceiptScanner";
import { CategoryIconPicker } from "../components/CategoryIconPicker";
import { isFullBackupCsv } from "../lib/backup";
import { allCategoriesFor, CATEGORIES, getCategory } from "../lib/categories";
import { parseTransactionCsv, TRANSACTION_CSV_TEMPLATE, type CsvCategoryDraft, type CsvSubcategoryDraft } from "../lib/csv";
import { toDateInput } from "../lib/dates";
import { filterTransactionHistory, type TransactionHistoryScope } from "../lib/transaction-history";
import type { CurrencyCode, CustomCategory, CustomSubcategory, LedgerTransaction, PaymentAccount, PaymentMode, ReceiptUpload, TransactionDraft, TransactionKind } from "../types";

interface TransactionsPageProps {
  month: Date;
  currency: CurrencyCode; transactions: LedgerTransaction[]; customCategories: CustomCategory[]; customSubcategories: CustomSubcategory[]; paymentAccounts: PaymentAccount[];
  onMonthChange: (date: Date) => void;
  onAdd: (occurredOn: string) => void; onDuplicate: (transaction: LedgerTransaction) => void; onEdit: (transaction: LedgerTransaction) => void; onDelete: (transaction: LedgerTransaction) => Promise<void>;
  onImport: (drafts: TransactionDraft[], newCategories?: CsvCategoryDraft[], newSubcategories?: CsvSubcategoryDraft[]) => Promise<number>;
  onSaveReceiptSplit: (drafts: TransactionDraft[], receipt: ReceiptUpload, totalMinor: number) => Promise<number>;
}

export function TransactionsPage({ month, currency, transactions, customCategories, customSubcategories, paymentAccounts, onMonthChange, onAdd, onDuplicate, onEdit, onDelete, onImport, onSaveReceiptSplit }: TransactionsPageProps) {
  const [query, setQuery] = useState(""); const [kind, setKind] = useState<TransactionKind | "all">("all");
  const [category, setCategory] = useState("all"); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [min, setMin] = useState(""); const [max, setMax] = useState(""); const [paymentMode, setPaymentMode] = useState<PaymentMode | "all">("all");
  const [preview, setPreview] = useState<TransactionDraft[] | null>(null); const [importDialogOpen, setImportDialogOpen] = useState(false); const [importErrors, setImportErrors] = useState<string[]>([]); const [importing, setImporting] = useState(false); const fileRef = useRef<HTMLInputElement>(null);
  const [newImportCategories, setNewImportCategories] = useState<CsvCategoryDraft[]>([]);
  const [newImportSubcategories, setNewImportSubcategories] = useState<CsvSubcategoryDraft[]>([]);
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${TRANSACTION_CSV_TEMPLATE}`)}`;
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [scope, setScope] = useState<TransactionHistoryScope>("history");
  const [selectedDay, setSelectedDay] = useState<Date>(() => isSameMonth(month, new Date()) ? new Date() : startOfMonth(month));
  const [visibleCount, setVisibleCount] = useState(50);
  const selectedDayKey = format(selectedDay, "yyyy-MM-dd");
  const activeOccurredOn = scope === "day" ? selectedDayKey : toDateInput();
  const filterCategories = useMemo(() => kind === "all" ? [...CATEGORIES, ...customCategories] : [...allCategoriesFor(kind, customCategories)], [kind, customCategories]);
  useEffect(() => { if (category !== "all" && !filterCategories.some((item) => item.id === category)) setCategory("all"); }, [category, filterCategories]);
  const sorted = useMemo(() => filterTransactionHistory(transactions, customCategories, {
    scope, selectedDayKey, kind, category, from, to,
    minMinor: min ? Number(min) * 100 : null, maxMinor: max ? Number(max) * 100 : null,
    paymentMode, query,
  }), [transactions, customCategories, scope, selectedDayKey, kind, category, from, to, min, max, paymentMode, query]);
  useEffect(() => { setVisibleCount(50); }, [scope, selectedDayKey, kind, category, from, to, min, max, paymentMode, query]);
  const visibleTransactions = sorted.slice(0, visibleCount);

  const readFile = async (file: File) => {
    const csv = await file.text();
    if (isFullBackupCsv(csv)) {
      setPreview([]);
      setNewImportCategories([]);
      setNewImportSubcategories([]);
      setImportErrors(["This is a full-backup CSV. Restore it from Profile → Backup so accounts, plans, places, dues, and receipts stay connected."]);
      setImportDialogOpen(true);
      return;
    }
    const result = parseTransactionCsv(csv, customCategories, paymentAccounts, customSubcategories);
    setPreview(result.rows); setNewImportCategories(result.newCategories); setNewImportSubcategories(result.newSubcategories); setImportErrors(result.errors); setImportDialogOpen(true);
  };
  const closeImportDialog = () => { if (!importing) setImportDialogOpen(false); };
  const importRows = async () => { if (!preview?.length) return; setImporting(true); try { await onImport(preview, newImportCategories, newImportSubcategories); setImportDialogOpen(false); setImportErrors([]); setNewImportCategories([]); setNewImportSubcategories([]); } finally { setImporting(false); } };
  const remove = async (transaction: LedgerTransaction) => { if (deletingId) return; setDeletingId(transaction.id); try { await onDelete(transaction); } finally { setDeletingId(null); } };
  const clearFilters = () => { setCategory("all"); setFrom(""); setTo(""); setMin(""); setMax(""); setPaymentMode("all"); };
  const hasActiveFilters = category !== "all" || Boolean(from || to || min || max) || paymentMode !== "all";
  const changeMonth = (nextMonth: Date) => {
    onMonthChange(nextMonth);
    if (!isSameMonth(selectedDay, nextMonth)) setSelectedDay(isSameMonth(nextMonth, new Date()) ? new Date() : startOfMonth(nextMonth));
  };
  const selectDay = (value: string | null) => {
    if (!value) return;
    const nextDay = parseISO(value);
    setSelectedDay(nextDay);
    if (!isSameMonth(month, nextDay)) onMonthChange(nextDay);
  };

  return <div className="page list-page">
    <header className="page-header"><div><span className="eyebrow">Your ledger</span><h1>Transactions</h1><p>Every income and expense entry, in one clear timeline.</p></div><div className="transaction-actions"><div className="header-actions"><input ref={fileRef} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={(event) => event.target.files?.[0] && void readFile(event.target.files[0])} /><ReceiptScanner currency={currency} fallbackOccurredOn={activeOccurredOn} customCategories={customCategories} customSubcategories={customSubcategories} paymentAccounts={paymentAccounts} onSave={onSaveReceiptSplit} /><button className="secondary-button csv-import-trigger" onClick={() => fileRef.current?.click()}><UploadSimple size={18} />Import CSV</button><button className="primary-button" onClick={() => onAdd(activeOccurredOn)}><Plus size={18} />Add transaction</button></div><div className="csv-template-help"><span>New to CSV imports?</span><a href={templateHref} download="transaction-import-template.csv"><DownloadSimple size={14} />Download CSV template</a></div></div></header>
    <section className="transaction-scope">
      <div>{scope === "day" && <><span className="section-label">Viewing month</span><MonthPicker month={month} onChange={changeMonth} /><Popover position="bottom-start" shadow="md" withArrow><Popover.Target><button className="current-date" aria-label={`Choose day. Selected ${format(selectedDay, "EEEE, MMMM d, yyyy")}`}>{format(selectedDay, "EEEE, MMMM d")} <CaretDown size={13} weight="bold" /></button></Popover.Target><Popover.Dropdown className="day-picker-popover"><DatePicker value={selectedDayKey} onChange={selectDay} firstDayOfWeek={0} /></Popover.Dropdown></Popover></>} {scope === "history" && <><span className="section-label">Viewing</span><strong className="month-label">All history</strong></>}</div>
      <div className="transaction-scope-controls"><nav className="filter-tabs transaction-history-scope" aria-label="Transaction scope">{(["history", "day"] as const).map((value) => <button key={value} className={scope === value ? "active" : ""} aria-pressed={scope === value} onClick={() => setScope(value)}>{value === "history" ? "All history" : "By day"}</button>)}</nav><nav className="filter-tabs" aria-label="Transaction type">{(["all", "expense", "income"] as const).map((value) => <button key={value} className={kind === value ? "active" : ""} aria-pressed={kind === value} onClick={() => setKind(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</nav></div>
    </section>
    <section className="toolbar"><TextInput className="search-field" aria-label={scope === "history" ? "Search all transactions" : "Search transactions on selected day"} leftSection={<MagnifyingGlass size={19} />} rightSection={query ? <button onClick={() => setQuery("")} aria-label="Clear search"><X size={17} /></button> : null} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={scope === "history" ? "Search all transactions" : `Search ${format(selectedDay, "MMMM d")} transactions`} /></section>
    <section className="advanced-filters" aria-label="Transaction filters">
      <div className="filter-panel-heading"><span><FunnelSimple size={18} /><strong>Filters</strong></span><button className="text-button clear-filter-button" disabled={!hasActiveFilters} onClick={clearFilters}>Clear filters</button></div>
      <Select label={kind === "all" ? "Category" : `${kind === "expense" ? "Expense" : "Income"} category`} value={category} onChange={(value) => value && setCategory(value)} data={[{ value: "all", label: "All categories" }, ...filterCategories.map((item) => ({ value: item.id, label: item.label }))]} searchable allowDeselect={false} />
      <DatePickerInput label="From date" value={from || null} onChange={(value) => setFrom(value ?? "")} clearable valueFormat="MMM D, YYYY" firstDayOfWeek={0} />
      <DatePickerInput label="To date" value={to || null} onChange={(value) => setTo(value ?? "")} clearable valueFormat="MMM D, YYYY" firstDayOfWeek={0} />
      <NumberInput label="Min amount" aria-label={`Minimum amount in ${currency}`} leftSection={<span className="currency-prefix">{currency}</span>} leftSectionWidth={52} value={min} onChange={(value) => setMin(String(value))} min={0} thousandSeparator="," decimalScale={2} />
      <NumberInput label="Max amount" aria-label={`Maximum amount in ${currency}`} leftSection={<span className="currency-prefix">{currency}</span>} leftSectionWidth={52} value={max} onChange={(value) => setMax(String(value))} min={0} thousandSeparator="," decimalScale={2} />
      <Select label="Payment mode" value={paymentMode} onChange={(value) => value && setPaymentMode(value as PaymentMode | "all")} data={[{ value: "all", label: "All payment modes" }, { value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" }, { value: "online", label: "Online payment" }]} allowDeselect={false} />
    </section>
    <section className="ledger-list"><div className="ledger-list-heading"><span>{sorted.length} {sorted.length === 1 ? "entry" : "entries"}{scope === "day" ? ` on ${format(selectedDay, "MMMM d, yyyy")}` : ""}</span><span>Newest first</span></div>{visibleTransactions.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} currency={currency} customCategories={customCategories} onDuplicate={onDuplicate} onEdit={onEdit} onDelete={(item) => void remove(item)} deletePending={deletingId === transaction.id} />)}{!sorted.length && <EmptyState title={scope === "history" ? "No matching transactions" : `No ${kind === "all" ? "" : `${kind} `}entries on ${format(selectedDay, "MMMM d")}`} message={scope === "history" ? "Try changing your search or filters, or add a transaction." : "Try another day or filter, or add a new transaction."} action={<button className="primary-button small" onClick={() => onAdd(activeOccurredOn)}><Plus size={17} />Add transaction</button>} />}{visibleTransactions.length < sorted.length && <nav className="transaction-history-pagination" aria-label="More transactions"><span aria-live="polite">Showing {visibleTransactions.length} of {sorted.length}</span><button className="secondary-button small" onClick={() => setVisibleCount((count) => count + 50)}>Load 50 more</button></nav>}</section>
    <AnimatedOverlay open={importDialogOpen} dismissOnBackdrop onClose={closeImportDialog} onExited={() => { if (!importDialogOpen) { setPreview(null); setImportErrors([]); setNewImportCategories([]); setNewImportSubcategories([]); } }}>
      {preview && <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" aria-busy={importing}>
        <header><div><span className="eyebrow">CSV import</span><h2 id="import-title">Review before importing</h2></div><button className="icon-button" disabled={importing} onClick={closeImportDialog} aria-label="Close"><X size={20} /></button></header>
        {importErrors.length > 0 && <div className="import-errors"><strong>{importErrors.length} rows need attention</strong>{importErrors.slice(0, 5).map((error) => <span key={error}>{error}</span>)}</div>}
        {newImportCategories.length > 0 && <div className="import-new-categories"><div><strong>{newImportCategories.length} new {newImportCategories.length === 1 ? "category" : "categories"}</strong><span>Choose an icon now. They will be saved with the valid rows.</span></div>{newImportCategories.map((category) => <div key={category.key}><span><strong>{category.name}</strong><small>{category.kind}</small></span><CategoryIconPicker legend={`Icon for ${category.name}`} value={category.icon} disabled={importing} onChange={(icon) => setNewImportCategories((current) => current.map((item) => item.key === category.key ? { ...item, icon } : item))} /></div>)}</div>}
        {newImportSubcategories.length > 0 && <div className="import-new-categories"><div><strong>{newImportSubcategories.length} new {newImportSubcategories.length === 1 ? "subcategory" : "subcategories"}</strong><span>These will remain available beneath their parent categories after import.</span></div>{newImportSubcategories.map((subcategory) => <div key={subcategory.key}><span><strong>{subcategory.name}</strong><small>{newImportCategories.find((category) => category.key === subcategory.category)?.name ?? getCategory(subcategory.category, customCategories).label}</small></span><CategoryIconPicker legend={`Icon for ${subcategory.name}`} value={subcategory.icon} disabled={importing} onChange={(icon) => setNewImportSubcategories((current) => current.map((item) => item.key === subcategory.key ? { ...item, icon } : item))} /></div>)}</div>}
        <div className="import-preview">{preview.slice(0, 8).map((row, index) => <div key={`${row.occurredOn}-${index}`}><span>{row.occurredOn}</span><strong>{row.note || newImportCategories.find((category) => category.key === row.category)?.name || getCategory(row.category, customCategories).label}</strong><span>{row.kind}</span><span>{row.amount} {currency}</span></div>)}</div>
        <p>{preview.length} valid rows ready. Invalid rows will not be imported.</p>
        <div className="dialog-actions"><button className="secondary-button" disabled={importing} onClick={closeImportDialog}>Cancel</button><button className="primary-button" disabled={!preview.length || importing} onClick={() => void importRows()}>{importing ? <><ButtonSpinner />Importing…</> : <><DownloadSimple size={17} />Import {preview.length} rows</>}</button></div>
      </section>}
    </AnimatedOverlay>
  </div>;
}
