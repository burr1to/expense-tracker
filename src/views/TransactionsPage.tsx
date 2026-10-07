import { Camera, CaretDown, ChatText, CheckCircle, DownloadSimple, FileText, FunnelSimple, MagnifyingGlass, Plus, UploadSimple, WarningCircle, X } from "@phosphor-icons/react";
import { NumberInput, Popover, Select, TextInput } from "@mantine/core";
import { DatePicker } from "@mantine/dates";
import { format, parseISO } from "date-fns";
import { useSearchParams } from "next/navigation";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { LedgerWorkspaceContext } from "../context/LedgerWorkspaceContext";
import { EmptyState } from "../components/EmptyState";
import { SlidingTabs } from "../components/SlidingTabs";
import { AnimatedOverlay } from "../components/AnimatedOverlay";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { LedgerDatePickerInput as DatePickerInput } from "../components/LedgerDatePickerInput";
import { MonthPicker } from "../components/MonthPicker";
import { TransactionRow } from "../components/TransactionRow";
import { TransferRow } from "../components/TransferRow";
import { CategoryIconPicker } from "../components/CategoryIconPicker";
import { isFullBackupCsv } from "../lib/backup";
import { allCategoriesFor, CATEGORIES, getCategory, pickerCategoriesFor } from "../lib/categories";
import { parseTransactionCsv, TRANSACTION_CSV_TEMPLATE, type CsvCategoryDraft, type CsvSubcategoryDraft } from "../lib/csv";
import { formatLedgerDay, isInMonth, localDate, periodRange, todayInput } from "../lib/dates";
import { monthKeyOf, type PeriodKey } from "../lib/period";
import { useToday } from "../lib/use-today";
import { onlinePaymentAccounts, paymentAccountLabel } from "../lib/payment-accounts";
import { listLedgerActivity, transferAccountLabel, type TransactionHistoryScope } from "../lib/transaction-history";
import { analyzeStatementFile } from "../lib/statement-import";
import { countImportDuplicates } from "../lib/transaction-intelligence";
import type { AccountTransfer, CalendarSystem, CurrencyCode, CustomCategory, CustomSubcategory, ImportJob, LearningState, LedgerTransaction, PaymentAccount, PaymentMode, ReceiptUpload, TransactionDraft, TransactionKind } from "../types";

type LedgerKindFilter = TransactionKind | "transfer" | "all";

interface TransactionsPageProps {
  period: PeriodKey;
  currency: CurrencyCode; transactions: LedgerTransaction[]; transfers: AccountTransfer[]; customCategories: CustomCategory[]; customSubcategories: CustomSubcategory[]; paymentAccounts: PaymentAccount[];
  onPeriodChange: (period: PeriodKey) => void;
  onAdd: (occurredOn: string) => void; onDuplicate: (transaction: LedgerTransaction) => void; onEdit: (transaction: LedgerTransaction) => void; onDelete: (transaction: LedgerTransaction) => Promise<void>; onDeleteTransfer: (id: string) => Promise<void>;
  onImport: (drafts: TransactionDraft[], newCategories?: CsvCategoryDraft[], newSubcategories?: CsvSubcategoryDraft[]) => Promise<ImportJob | null>;
  importJobs: ImportJob[];
  onDismissImportJob: (id: string) => void;
  /** Unused: SMS capture and receipt scanning are the single global sheets in LedgerAppLayout. */
  onSaveReceiptSplit?: (drafts: TransactionDraft[], receipt: ReceiptUpload, totalMinor: number) => Promise<number>;
  learning?: LearningState;
  calendarSystem: CalendarSystem;
  onSaveTransaction?: (draft: TransactionDraft) => Promise<string | undefined>;
}

export function TransactionsPage({ period: month, currency, transactions, transfers, customCategories, customSubcategories, paymentAccounts, importJobs, onPeriodChange, onAdd, onDuplicate, onEdit, onDelete, onDeleteTransfer, onImport, onDismissImportJob, calendarSystem }: TransactionsPageProps) {
  const workspace = useContext(LedgerWorkspaceContext);
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(""); const [kind, setKind] = useState<LedgerKindFilter>("all");
  const [category, setCategory] = useState("all"); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [min, setMin] = useState(""); const [max, setMax] = useState(""); const [paymentMode, setPaymentMode] = useState<PaymentMode | "all">("all");
  const [preview, setPreview] = useState<TransactionDraft[] | null>(null); const [importDialogOpen, setImportDialogOpen] = useState(false); const [importErrors, setImportErrors] = useState<string[]>([]); const [importing, setImporting] = useState(false); const fileRef = useRef<HTMLInputElement>(null);
  const [analyzingImport, setAnalyzingImport] = useState(false); const [importWarnings, setImportWarnings] = useState<string[]>([]); const [importSource, setImportSource] = useState<{ name: string; kind: "csv" | "statement" } | null>(null); const [importAccountId, setImportAccountId] = useState("");
  const [newImportCategories, setNewImportCategories] = useState<CsvCategoryDraft[]>([]);
  const [newImportSubcategories, setNewImportSubcategories] = useState<CsvSubcategoryDraft[]>([]);
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${TRANSACTION_CSV_TEMPLATE}`)}`;
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [scope, setScope] = useState<TransactionHistoryScope>("history");
  const today = useToday();
  // Today inside the running month, else the month's first day (Ashwin 1 for a BS month).
  const dayFor = (period: PeriodKey) => localDate(isInMonth(today, period) ? today : periodRange(period).start);
  const [selectedDay, setSelectedDay] = useState<Date>(() => dayFor(month));
  const [visibleCount, setVisibleCount] = useState(50);
  const selectedDayKey = format(selectedDay, "yyyy-MM-dd");
  // When the date changes under an open tab, a day view sitting on "today" follows it to the new day (and month).
  const followedToday = useRef(today);
  useEffect(() => {
    const previous = followedToday.current;
    if (previous === today) return;
    followedToday.current = today;
    if (selectedDayKey !== previous) return;
    setSelectedDay(parseISO(today));
    if (!isInMonth(today, month)) onPeriodChange(monthKeyOf(today, calendarSystem));
  }, [calendarSystem, month, onPeriodChange, selectedDayKey, today]);
  // Read at tap time, so a tab left open overnight still adds to the real today.
  const activeOccurredOn = () => scope === "day" ? selectedDayKey : todayInput();
  // A statement's rows are online payments, so Cash in hand is not a statement account; imports land only in your own accounts.
  const ownerId = workspace?.ledger.profile.id;
  const importAccounts = useMemo(() => onlinePaymentAccounts(paymentAccounts).filter((account) => !ownerId || account.userId === ownerId), [ownerId, paymentAccounts]);
  const filterCategories = useMemo(() => kind === "all" || kind === "transfer" ? [...CATEGORIES, ...customCategories] : [...allCategoriesFor(kind, customCategories)], [kind, customCategories]);
  useEffect(() => { if (category !== "all" && !filterCategories.some((item) => item.id === category)) setCategory("all"); }, [category, filterCategories]);
  useEffect(() => {
    const nextQuery = searchParams.get("q");
    if (nextQuery) {
      setQuery(nextQuery);
      setScope("history");
    }
  }, [searchParams]);
  const sorted = useMemo(() => listLedgerActivity(transactions, transfers, paymentAccounts, customCategories, {
    scope, selectedDayKey, kind, category, from, to,
    minMinor: min ? Number(min) * 100 : null, maxMinor: max ? Number(max) * 100 : null,
    paymentMode, query,
  }), [transactions, transfers, paymentAccounts, customCategories, scope, selectedDayKey, kind, category, from, to, min, max, paymentMode, query]);
  useEffect(() => { setVisibleCount(50); }, [scope, selectedDayKey, kind, category, from, to, min, max, paymentMode, query]);
  const visibleTransactions = sorted.slice(0, visibleCount);
  const possibleImportDuplicates = useMemo(() => countImportDuplicates(preview ?? [], transactions), [preview, transactions]);
  const importPreviewIsValid = Boolean(preview?.length && preview.every((row) => Number(row.amount.replace(/,/g, "")) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.occurredOn)));
  useEffect(() => {
    let timeout: number | undefined;
    const focusImport = () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (window.location.hash !== "#import-csv") return;
      timeout = window.setTimeout(() => document.getElementById("csv-import-trigger")?.focus(), 0);
    };
    focusImport();
    window.addEventListener("hashchange", focusImport);
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      window.removeEventListener("hashchange", focusImport);
    };
  }, []);

  const readFile = async (file: File) => {
    if (analyzingImport) return;
    setAnalyzingImport(true); setImportErrors([]); setImportWarnings([]); setImportAccountId("");
    try {
      const isText = file.type.startsWith("text/") || /\.(csv|txt)$/i.test(file.name);
      const text = isText ? await file.text() : "";
      if (text && isFullBackupCsv(text)) {
        setPreview([]); setNewImportCategories([]); setNewImportSubcategories([]); setImportSource({ name: file.name, kind: "csv" });
        setImportErrors(["This is a full-backup CSV. Restore it from Profile → Backup so accounts, plans, places, dues, and receipts stay connected."]);
        setImportDialogOpen(true); return;
      }
      const headers = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
      const standardCsv = /\bdate\b/.test(headers) && /\btype\b/.test(headers) && /\bcategory\b/.test(headers) && /\bamount\b/.test(headers);
      if (standardCsv) {
        const result = parseTransactionCsv(text, customCategories, paymentAccounts, customSubcategories);
        setPreview(result.rows); setNewImportCategories(result.newCategories); setNewImportSubcategories(result.newSubcategories); setImportErrors(result.errors); setImportSource({ name: file.name, kind: "csv" });
      } else {
        const result = await analyzeStatementFile(file);
        setPreview(result.rows); setNewImportCategories([]); setNewImportSubcategories([]); setImportWarnings(result.warnings); setImportSource({ name: file.name, kind: "statement" });
      }
      setImportDialogOpen(true);
    } catch (caught) {
      setPreview([]); setNewImportCategories([]); setNewImportSubcategories([]); setImportSource({ name: file.name, kind: "statement" }); setImportErrors([caught instanceof Error ? caught.message : "Could not read this import file."]); setImportDialogOpen(true);
    } finally { setAnalyzingImport(false); }
  };
  const closeImportDialog = () => { if (!importing) setImportDialogOpen(false); };
  const importRows = async () => { if (!preview?.length) return; setImporting(true); try { await onImport(preview, newImportCategories, newImportSubcategories); setImportDialogOpen(false); setImportErrors([]); setImportWarnings([]); setNewImportCategories([]); setNewImportSubcategories([]); } catch (caught) { setImportErrors([caught instanceof Error ? caught.message : "Could not start this import."]); } finally { setImporting(false); } };
  const chooseImportAccount = (accountId: string | null) => { const next = accountId ?? ""; setImportAccountId(next); setPreview((current) => current?.map((row) => ({ ...row, paymentMode: next ? "online" : "cash", paymentAccountId: next })) ?? null); };
  const updatePreviewRow = (index: number, changes: Partial<TransactionDraft>) => setPreview((current) => current?.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row) ?? null);
  const remove = async (transaction: LedgerTransaction) => { if (deletingId) return; setDeletingId(transaction.id); try { await onDelete(transaction); } finally { setDeletingId(null); } };
  const removeTransfer = async (id: string) => { if (deletingId || !window.confirm("Delete this transfer? Account balances will be recalculated.")) return; setDeletingId(`transfer:${id}`); try { await onDeleteTransfer(id); } finally { setDeletingId(null); } };
  const clearFilters = () => { setCategory("all"); setFrom(""); setTo(""); setMin(""); setMax(""); setPaymentMode("all"); };
  const hasActiveFilters = category !== "all" || Boolean(from || to || min || max) || paymentMode !== "all";
  const changeMonth = (nextMonth: PeriodKey) => {
    onPeriodChange(nextMonth);
    if (!isInMonth(selectedDayKey, nextMonth)) setSelectedDay(dayFor(nextMonth));
  };
  const selectDay = (value: string | null) => {
    if (!value) return;
    setSelectedDay(parseISO(value));
    if (!isInMonth(value, month)) onPeriodChange(monthKeyOf(value, calendarSystem));
  };

  return <div className="page list-page">
    <header className="page-header"><div><span className="eyebrow">Your ledger</span><h1>Transactions</h1><p>Income, expenses, and transfers between your accounts, in one timeline.</p></div><div className="transaction-actions"><div className="header-actions"><input ref={fileRef} className="visually-hidden" type="file" accept=".csv,.txt,.pdf,text/csv,text/plain,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void readFile(file); }} /><button className="secondary-button receipt-scan-trigger" onClick={() => workspace?.openReceiptScan(activeOccurredOn())}><Camera size={18} />Scan receipt <span>AI</span></button><button className="secondary-button sms-capture-trigger" onClick={() => workspace?.openSms()}><ChatText size={18} />Paste bank SMS</button><button id="csv-import-trigger" className="secondary-button csv-import-trigger" disabled={analyzingImport} onClick={() => fileRef.current?.click()}>{analyzingImport ? <ButtonSpinner /> : <UploadSimple size={18} />}{analyzingImport ? "Reading statement…" : "Import statement"}</button><button className="primary-button" onClick={() => onAdd(activeOccurredOn())}><Plus size={18} />Add transaction</button></div><div className="csv-template-help"><span>CSV, PDF, image, or text · always review before import</span><a href={templateHref} download="transaction-import-template.csv"><DownloadSimple size={14} />Download CSV template</a></div></div></header>
    {importJobs.length > 0 && <section className="import-progress-stack" aria-label="CSV import progress" aria-live="polite">{importJobs.map((job) => {
      const percent = job.totalRows ? Math.round(job.processedRows / job.totalRows * 100) : 0;
      const completed = job.status === "completed";
      const failed = job.status === "failed";
      return <article className={`import-progress-card${failed ? " has-error" : completed ? " is-complete" : ""}`} key={job.id}>
        <div className="import-progress-heading"><span className="import-progress-icon" aria-hidden="true">{failed ? <WarningCircle size={19} /> : completed ? <CheckCircle size={19} weight="fill" /> : <UploadSimple size={19} />}</span><div><strong>{failed ? "Import stopped" : completed ? "Import complete" : "Importing transactions"}</strong><small>{failed ? "No partial rows were kept." : completed ? `${job.totalRows} rows added to your ledger.` : `${job.processedRows} of ${job.totalRows} rows imported…`}</small></div><button type="button" className="icon-button" onClick={() => onDismissImportJob(job.id)} aria-label={`Dismiss import ${job.id}`}><X size={16} /></button></div>
        {!failed && <><div className="import-progress-track" role="progressbar" aria-label={`Import progress: ${percent}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div><div className="import-progress-meta"><span>{completed ? "Ready to review" : job.status === "queued" ? "Preparing rows" : "Working in small batches"}</span><strong>{percent}%</strong></div></>}
        {failed && <p className="import-progress-error">{job.error ?? "The import failed and was rolled back."}</p>}
      </article>;
    })}</section>}
    <section className="transaction-scope">
      <div className={scope === "history" ? "transaction-scope-title is-history" : "transaction-scope-title"}>{scope === "day"
        ? <><span className="section-label">Viewing month</span><MonthPicker calendarSystem={calendarSystem} period={month} onChange={changeMonth} /><Popover position="bottom-start" shadow="md" withArrow><Popover.Target><button className="current-date" aria-label={`Choose day. Selected ${formatLedgerDay(selectedDay, calendarSystem)}`}>{formatLedgerDay(selectedDay, calendarSystem)} <CaretDown size={13} weight="bold" /></button></Popover.Target><Popover.Dropdown className="day-picker-popover"><DatePicker value={selectedDayKey} onChange={selectDay} firstDayOfWeek={0} /></Popover.Dropdown></Popover></>
        : <><span className="section-label">Viewing</span><strong className="month-label">All history</strong><span className="current-date as-text">Every transaction you have recorded</span></>}</div>
      <div className="transaction-scope-controls"><SlidingTabs<TransactionHistoryScope> className="transaction-history-scope" label="Transaction scope" value={scope} onChange={setScope} options={[{ id: "history", label: "All history" }, { id: "day", label: "By day" }]} /><SlidingTabs<LedgerKindFilter> className="transaction-kind-tabs" label="Transaction type" value={kind} onChange={setKind} options={[{ id: "all", label: "All" }, { id: "expense", label: "Expense" }, { id: "income", label: "Income" }, { id: "transfer", label: "Transfer" }]} /></div>
    </section>
    <section className="toolbar"><TextInput className="search-field" aria-label={scope === "history" ? "Search all transactions" : "Search transactions on selected day"} leftSection={<MagnifyingGlass size={19} />} rightSection={query ? <button onClick={() => setQuery("")} aria-label="Clear search"><X size={17} /></button> : null} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={scope === "history" ? "Search all transactions" : `Search ${format(selectedDay, "MMMM d")} transactions`} /></section>
    <section className="advanced-filters" aria-label="Transaction filters">
      <div className="filter-panel-heading"><span><FunnelSimple size={18} /><strong>Filters</strong></span><button className="text-button clear-filter-button" disabled={!hasActiveFilters} onClick={clearFilters}>Clear filters</button></div>
      <Select label={kind === "all" || kind === "transfer" ? "Category" : `${kind === "expense" ? "Expense" : "Income"} category`} value={category} onChange={(value) => value && setCategory(value)} data={[{ value: "all", label: "All categories" }, ...filterCategories.map((item) => ({ value: item.id, label: item.label }))]} searchable allowDeselect={false} disabled={kind === "transfer"} />
      <DatePickerInput label="From date" value={from || null} onChange={(value) => setFrom(value ?? "")} clearable valueFormat="MMM D, YYYY" firstDayOfWeek={0} />
      <DatePickerInput label="To date" value={to || null} onChange={(value) => setTo(value ?? "")} clearable valueFormat="MMM D, YYYY" firstDayOfWeek={0} />
      <NumberInput label="Min amount" aria-label={`Minimum amount in ${currency}`} leftSection={<span className="currency-prefix">{currency}</span>} leftSectionWidth={52} value={min} onChange={(value) => setMin(String(value))} min={0} thousandSeparator="," decimalScale={2} />
      <NumberInput label="Max amount" aria-label={`Maximum amount in ${currency}`} leftSection={<span className="currency-prefix">{currency}</span>} leftSectionWidth={52} value={max} onChange={(value) => setMax(String(value))} min={0} thousandSeparator="," decimalScale={2} />
      <Select label="Payment mode" value={paymentMode} onChange={(value) => value && setPaymentMode(value as PaymentMode | "all")} data={[{ value: "all", label: "All payment modes" }, { value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" }, { value: "online", label: "Online payment" }]} allowDeselect={false} disabled={kind === "transfer"} />
    </section>
    <section className="ledger-list"><div className="ledger-list-heading"><span>{sorted.length} {sorted.length === 1 ? "entry" : "entries"}{scope === "day" ? ` on ${formatLedgerDay(selectedDay, calendarSystem, "date")}` : ""}</span><span>Newest first</span></div>{visibleTransactions.map((entry) => entry.type === "transaction" ? <TransactionRow key={`transaction-${entry.transaction.id}`} transaction={entry.transaction} currency={currency} customCategories={customCategories} onDuplicate={onDuplicate} onEdit={onEdit} onDelete={(item) => void remove(item)} deletePending={deletingId === entry.transaction.id} /> : <TransferRow key={`transfer-${entry.transfer.id}`} transfer={entry.transfer} fromLabel={transferAccountLabel(paymentAccounts, entry.transfer.fromAccountId)} toLabel={transferAccountLabel(paymentAccounts, entry.transfer.toAccountId)} currency={currency} onDelete={() => void removeTransfer(entry.transfer.id)} deletePending={deletingId === `transfer:${entry.transfer.id}`} />)}{!sorted.length && <EmptyState title={scope === "history" ? "No matching entries" : `No ${kind === "all" ? "" : `${kind} `}entries on ${format(selectedDay, "MMMM d")}`} message={scope === "history" ? "Try changing your search or filters, or add a transaction." : "Try another day or filter, or add a new transaction."} action={kind === "transfer" ? undefined : <button className="primary-button small" onClick={() => onAdd(activeOccurredOn())}><Plus size={17} />Add transaction</button>} />}{visibleTransactions.length < sorted.length && <nav className="transaction-history-pagination" aria-label="More transactions"><span aria-live="polite">Showing {visibleTransactions.length} of {sorted.length}</span><button className="secondary-button small" onClick={() => setVisibleCount((count) => count + 50)}>Load 50 more</button></nav>}</section>
    <AnimatedOverlay open={importDialogOpen} dismissOnBackdrop onClose={closeImportDialog} onExited={() => { if (!importDialogOpen) { setPreview(null); setImportErrors([]); setNewImportCategories([]); setNewImportSubcategories([]); } }}>
        {preview && <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title" aria-busy={importing}>
        <header><div><span className="eyebrow">{importSource?.kind === "statement" ? "AI statement import" : "CSV import"}</span><h2 id="import-title">Review before importing</h2><small className="import-source-name"><FileText size={14} />{importSource?.name}</small></div><button className="icon-button" disabled={importing} onClick={closeImportDialog} aria-label="Close"><X size={20} /></button></header>
        <p className="import-dialog-explanation"><strong>This is a history import, not a reconciliation.</strong> It adds past transactions only; it does not change an account balance or approve an audit. Reconcile later from Accounts when you are ready to compare your ledger with the balance shown by your bank or wallet.</p>
        {importErrors.length > 0 && <div className="import-errors"><strong>Import needs attention</strong>{importErrors.slice(0, 5).map((error) => <span key={error}>{error}</span>)}</div>}
        {importWarnings.length > 0 && <div className="import-warnings"><strong>Review these extraction notes</strong>{importWarnings.slice(0, 8).map((warning) => <span key={warning}>{warning}</span>)}</div>}
        {possibleImportDuplicates > 0 && <div className="import-warnings duplicate"><strong><WarningCircle size={16} />{possibleImportDuplicates} possible {possibleImportDuplicates === 1 ? "duplicate" : "duplicates"}</strong><span>Matching existing or repeated rows are still included. Review them before importing.</span></div>}
        {importSource?.kind === "statement" && importAccounts.length > 0 && <Select label="Statement account" description="Optional. Assign all extracted rows to one tracked account." placeholder="Leave as cash / untracked" value={importAccountId || null} data={importAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} onChange={chooseImportAccount} clearable searchable disabled={importing} />}
        {newImportCategories.length > 0 && <div className="import-new-categories"><div><strong>{newImportCategories.length} new {newImportCategories.length === 1 ? "category" : "categories"}</strong><span>Choose an icon now. They will be saved with the valid rows.</span></div>{newImportCategories.map((category) => <div key={category.key}><span><strong>{category.name}</strong><small>{category.kind}</small></span><CategoryIconPicker legend={`Icon for ${category.name}`} value={category.icon} disabled={importing} onChange={(icon) => setNewImportCategories((current) => current.map((item) => item.key === category.key ? { ...item, icon } : item))} /></div>)}</div>}
        {newImportSubcategories.length > 0 && <div className="import-new-categories"><div><strong>{newImportSubcategories.length} new {newImportSubcategories.length === 1 ? "subcategory" : "subcategories"}</strong><span>These will remain available beneath their parent categories after import.</span></div>{newImportSubcategories.map((subcategory) => <div key={subcategory.key}><span><strong>{subcategory.name}</strong><small>{newImportCategories.find((category) => category.key === subcategory.category)?.name ?? getCategory(subcategory.category, customCategories).label}</small></span><CategoryIconPicker legend={`Icon for ${subcategory.name}`} value={subcategory.icon} disabled={importing} onChange={(icon) => setNewImportSubcategories((current) => current.map((item) => item.key === subcategory.key ? { ...item, icon } : item))} /></div>)}</div>}
        {importSource?.kind === "statement" ? <div className="statement-review-list" aria-label="Editable extracted statement rows">{preview.map((row, index) => <article key={`${row.occurredOn}-${index}`}>
          <DatePickerInput label="Date" value={row.occurredOn} onChange={(value) => value && updatePreviewRow(index, { occurredOn: value })} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required disabled={importing} />
          <Select label="Type" value={row.kind} data={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }]} onChange={(value) => { if (!value) return; const nextKind = value as TransactionKind; updatePreviewRow(index, { kind: nextKind, category: allCategoriesFor(nextKind, customCategories)[0].id, subcategory: "" }); }} allowDeselect={false} disabled={importing} />
          <Select label="Category" value={row.category} data={pickerCategoriesFor(row.kind, customCategories).map((item) => ({ value: item.id, label: item.label }))} onChange={(value) => value && updatePreviewRow(index, { category: value, subcategory: "" })} searchable allowDeselect={false} disabled={importing} />
          <NumberInput label={`Amount in ${currency}`} value={row.amount} onChange={(value) => updatePreviewRow(index, { amount: String(value) })} min={0.01} thousandSeparator="," decimalScale={2} disabled={importing} />
          <TextInput label="Description" value={row.note} onChange={(event) => updatePreviewRow(index, { note: event.currentTarget.value.slice(0, 80) })} maxLength={80} disabled={importing} />
          <button type="button" className="icon-button danger" disabled={importing} onClick={() => setPreview((current) => current?.filter((_, rowIndex) => rowIndex !== index) ?? null)} aria-label={`Remove statement row ${index + 1}`}><X size={16} /></button>
        </article>)}</div> : <div className="import-preview">{preview.slice(0, 8).map((row, index) => <div key={`${row.occurredOn}-${index}`}><span>{row.occurredOn}</span><strong>{row.note || newImportCategories.find((category) => category.key === row.category)?.name || getCategory(row.category, customCategories).label}</strong><span>{row.kind}</span><span>{row.amount} {currency}</span></div>)}</div>}
        <p>{preview.length} valid rows ready. Invalid rows will not be imported. Nothing has been saved yet.</p>
        <div className="dialog-actions"><button className="secondary-button" disabled={importing} onClick={closeImportDialog}>Cancel</button><button className="primary-button" disabled={!importPreviewIsValid || importing} onClick={() => void importRows()}>{importing ? <><ButtonSpinner />Importing…</> : <><DownloadSimple size={17} />Import {preview.length} rows</>}</button></div>
      </section>}
    </AnimatedOverlay>
  </div>;
}
