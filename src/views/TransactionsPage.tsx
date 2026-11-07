import { CalendarBlank, Camera, CaretDown, CaretLeft, CaretRight, ChatText, CheckCircle, CheckSquare, CursorClick, DotsThree, DownloadSimple, FileText, Folders, FunnelSimple, ListPlus, MagnifyingGlass, Plus, Tag, UploadSimple, WarningCircle, X } from "@phosphor-icons/react";
import { Menu, NumberInput, Popover, Select, TextInput } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LedgerWorkspaceContext } from "../context/LedgerWorkspaceContext";
import { EmptyState } from "../components/EmptyState";
import { SlidingTabs } from "../components/SlidingTabs";
import { AnimatedOverlay } from "../components/AnimatedOverlay";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { LedgerDatePickerInput as DatePickerInput } from "../components/LedgerDatePickerInput";
import { EntryDetail, EntryRow } from "../components/V2Entries";
import { AccountTile, CategoryTile } from "../components/ToneIcon";
import { CategoryIconPicker } from "../components/CategoryIconPicker";
import { isFullBackupCsv } from "../lib/backup";
import { allCategoriesFor, CATEGORIES, countsAsIncomeOrSpending, getCategory, pickerCategoriesFor } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { activityKey, plainAmount } from "../lib/entry-labels";
import { CASH_BUCKET, spendBucket } from "../lib/month-compare";
import { accountLook } from "../lib/tones";
import { parseTransactionCsv, TRANSACTION_CSV_TEMPLATE, type CsvCategoryDraft, type CsvSubcategoryDraft } from "../lib/csv";
import { formatLedgerDay, formatLedgerMonth, isInMonth, periodRange, todayInput } from "../lib/dates";
import { dayGroupLabel, groupLedgerActivityByDay, takeWholeDays } from "../lib/day-groups";
import { addMonthsToKey, lastDayOf, periodBounds, type PeriodKey } from "../lib/period";
import { useToday } from "../lib/use-today";
import { onlinePaymentAccounts, paymentAccountLabel } from "../lib/payment-accounts";
import { listLedgerActivity, type LedgerActivityItem } from "../lib/transaction-history";
import { analyzeStatementFile } from "../lib/statement-import";
import { countImportDuplicates } from "../lib/transaction-intelligence";
import { GROUPS_HREF } from "../lib/transaction-groups";
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
  const today = useToday();
  // The list shows one month (the workspace month) or everything; a search from elsewhere opens on everything.
  const [range, setRange] = useState<"month" | "all">("month");
  const [accountChip, setAccountChip] = useState("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Set when the Add sheet's Statement tile sent you here: a file picker needs your own tap, so the page offers one.
  const [importAsked, setImportAsked] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const wide = useMediaQuery("(min-width: 1200px)") ?? false;
  // Read at tap time, so a tab left open overnight still adds to the real today.
  const activeOccurredOn = () => range === "month" && !isInMonth(todayInput(), month) ? periodRange(month).start : todayInput();
  // A statement's rows are online payments, so Cash in hand is not a statement account; imports land only in your own accounts.
  const ownerId = workspace?.ledger.profile.id;
  const importAccounts = useMemo(() => onlinePaymentAccounts(paymentAccounts).filter((account) => !ownerId || account.userId === ownerId), [ownerId, paymentAccounts]);
  const filterCategories = useMemo(() => kind === "all" || kind === "transfer" ? [...CATEGORIES, ...customCategories] : [...allCategoriesFor(kind, customCategories)], [kind, customCategories]);
  useEffect(() => { if (category !== "all" && !filterCategories.some((item) => item.id === category)) setCategory("all"); }, [category, filterCategories]);
  useEffect(() => {
    const nextQuery = searchParams.get("q");
    if (nextQuery) {
      setQuery(nextQuery);
      setRange("all");
    }
    if (searchParams.get("import")) setImportAsked(true);
    const account = searchParams.get("account");
    if (account) setAccountChip(account);
  }, [searchParams]);
  const monthStart = periodRange(month).start;
  const monthEnd = lastDayOf(periodBounds(month));
  const effectiveFrom = range === "month" ? (from && from > monthStart ? from : monthStart) : from;
  const effectiveTo = range === "month" ? (to && to < monthEnd ? to : monthEnd) : to;
  const listed = useMemo(() => listLedgerActivity(transactions, transfers, paymentAccounts, customCategories, {
    scope: "history", selectedDayKey: "", kind, category, from: effectiveFrom, to: effectiveTo,
    minMinor: min ? Number(min) * 100 : null, maxMinor: max ? Number(max) * 100 : null,
    paymentMode, query,
  }), [transactions, transfers, paymentAccounts, customCategories, kind, category, effectiveFrom, effectiveTo, min, max, paymentMode, query]);
  // Account chips: a cash entry with no account belongs to Cash, like on Home; a transfer belongs to both ends.
  const accountChips = useMemo(() => {
    const keys = new Set(paymentAccounts.map((account) => account.id));
    if (transactions.some((transaction) => spendBucket(transaction, paymentAccounts) === CASH_BUCKET)) keys.add(CASH_BUCKET);
    return [...keys];
  }, [paymentAccounts, transactions]);
  const sorted = useMemo(() => accountChip === "all" ? listed : listed.filter((item) => item.type === "transaction"
    ? spendBucket(item.transaction, paymentAccounts) === accountChip
    : item.transfer.fromAccountId === accountChip || item.transfer.toAccountId === accountChip), [accountChip, listed, paymentAccounts]);
  const totals = useMemo(() => {
    let outMinor = 0, inMinor = 0;
    for (const item of sorted) {
      if (item.type !== "transaction" || !countsAsIncomeOrSpending(item.transaction)) continue;
      if (item.transaction.kind === "income") inMinor += item.transaction.amountMinor; else outMinor += item.transaction.amountMinor;
    }
    return { outMinor, inMinor };
  }, [sorted]);
  useEffect(() => { setVisibleCount(50); }, [range, month, accountChip, kind, category, from, to, min, max, paymentMode, query]);
  // Pages by whole days, so "Load more" never splits a day.
  const visibleDays = useMemo(() => takeWholeDays(groupLedgerActivityByDay(sorted), visibleCount), [sorted, visibleCount]);
  const visibleCountShown = visibleDays.reduce((total, day) => total + day.items.length, 0);
  const selectedItem = wide && selectedKey ? sorted.find((item) => activityKey(item) === selectedKey) ?? null : null;
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
  const askDeleteTransfer = (transfer: AccountTransfer) => void removeTransfer(transfer.id);
  const openItem = (item: LedgerActivityItem) => {
    if (wide) { setSelectedKey(activityKey(item)); return; }
    if (item.type === "transfer") workspace?.openTransfer({ transferId: item.transfer.id });
    else if (!ownerId || item.transaction.userId === ownerId) onEdit(item.transaction);
  };
  const clearFilters = () => { setKind("all"); setFrom(""); setTo(""); setMin(""); setMax(""); setPaymentMode("all"); };
  const extraFilterCount = (kind !== "all" ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0) + (min ? 1 : 0) + (max ? 1 : 0) + (paymentMode !== "all" ? 1 : 0);
  const stepMonth = (delta: number) => { try { onPeriodChange(addMonthsToKey(month, delta)); setRange("month"); } catch { /* outside the supported range */ } };
  const categoryLabel = category === "all" ? "Any category" : getCategory(category, customCategories).label;
  const chipLabel = (key: string) => {
    if (key === CASH_BUCKET) return "Cash";
    const account = paymentAccounts.find((item) => item.id === key);
    return account ? (account.label || paymentAccountLabel(account)) : "Account";
  };

  return <div className={`v2-page v2-transactions${selectedItem ? " has-detail" : ""}`}>
    <input ref={fileRef} className="visually-hidden" type="file" accept=".csv,.txt,.pdf,text/csv,text/plain,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void readFile(file); }} />
    <header className="v2-page-head">
      <div><span className="v2-eyebrow">{range === "month" ? formatLedgerMonth(month, calendarSystem) : "All history"}</span><h1>Transactions</h1></div>
      <div className="v2-head-actions">
        <Link className="v2-button is-compact" href="/transactions/edit" aria-label="Select entries to edit together"><CheckSquare size={18} /><span>Select</span></Link>
        <Menu position="bottom-end" shadow="md" width={260} withinPortal>
          <Menu.Target><button type="button" id="csv-import-trigger" className="v2-icon-btn" aria-label="More ways to add" disabled={analyzingImport}>{analyzingImport ? <ButtonSpinner /> : <DotsThree size={22} weight="bold" />}</button></Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<Plus size={17} />} onClick={() => onAdd(activeOccurredOn())}>Add one entry</Menu.Item>
            <Menu.Item leftSection={<ListPlus size={17} />} component={Link} href="/transactions/multiple">Add several at once</Menu.Item>
            <Menu.Item leftSection={<ChatText size={17} />} onClick={() => workspace?.openSms()}>Paste bank SMS</Menu.Item>
            <Menu.Item leftSection={<Camera size={17} />} onClick={() => workspace?.openReceiptScan(activeOccurredOn())}>Scan a receipt</Menu.Item>
            <Menu.Item leftSection={<UploadSimple size={17} />} onClick={() => fileRef.current?.click()}>Import a statement or CSV</Menu.Item>
            <Menu.Item leftSection={<DownloadSimple size={17} />} component="a" href={templateHref} download="transaction-import-template.csv">Download CSV template</Menu.Item>
            <Menu.Divider />
            <Menu.Item leftSection={<Folders size={17} />} component={Link} href={GROUPS_HREF}>Groups</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
    </header>
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

    {importAsked && <section className="v2-card v2-import-ask" aria-labelledby="v2-import-ask-title">
      <span className="v2-tile" style={{ "--tile-bg": "#fdf0c4", "--tile-ink": "#8a5a00", "--tile-size": "46px" } as CSSProperties} aria-hidden="true"><FileText size={24} weight="duotone" /></span>
      <div><h2 id="v2-import-ask-title">Import a statement</h2><p>A bank or wallet statement (PDF, image, text) or a CSV. You review every row before anything is saved.</p></div>
      <div className="v2-import-ask-actions"><button type="button" className="v2-button is-primary" disabled={analyzingImport} onClick={() => { setImportAsked(false); fileRef.current?.click(); }}>{analyzingImport ? <ButtonSpinner /> : <UploadSimple size={17} />}Choose a file</button><button type="button" className="v2-icon-btn is-quiet" onClick={() => setImportAsked(false)} aria-label="Dismiss"><X size={17} /></button></div>
    </section>}
    <label className="v2-search">
      <MagnifyingGlass size={19} aria-hidden="true" />
      <input type="search" aria-label="Search transactions" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes, places, amounts" />
      {query && <button type="button" className="v2-icon-btn is-quiet" onClick={() => setQuery("")} aria-label="Clear search"><X size={17} /></button>}
    </label>

    <div className="v2-chip-row" role="group" aria-label="Account">
      <button type="button" className={accountChip === "all" ? "v2-chip active" : "v2-chip"} aria-pressed={accountChip === "all"} onClick={() => setAccountChip("all")}>All accounts</button>
      {accountChips.map((key) => {
        const account = paymentAccounts.find((item) => item.id === key) ?? null;
        const { tone } = accountLook(account, key);
        const on = accountChip === key;
        return <button key={key} type="button" className={on ? "v2-chip active" : "v2-chip"} aria-pressed={on} style={on ? { background: tone.ink, borderColor: tone.ink, color: "#fff" } : { background: tone.bg, borderColor: "transparent", color: tone.ink }} onClick={() => setAccountChip(on ? "all" : key)}>
          <AccountTile account={account} bucket={key} size={22} />{chipLabel(key)}
        </button>;
      })}
    </div>

    <div className="v2-chip-row" role="group" aria-label="Filters">
      {range === "month"
        ? <span className="v2-chip is-stepper"><button type="button" onClick={() => stepMonth(-1)} aria-label="Previous month"><CaretLeft size={15} weight="bold" /></button><strong>{formatLedgerMonth(month, calendarSystem)}</strong><button type="button" onClick={() => stepMonth(1)} aria-label="Next month"><CaretRight size={15} weight="bold" /></button></span>
        : <button type="button" className="v2-chip" onClick={() => setRange("month")}><CalendarBlank size={16} />One month</button>}
      <button type="button" className={range === "all" ? "v2-chip active" : "v2-chip"} aria-pressed={range === "all"} onClick={() => setRange(range === "all" ? "month" : "all")}>All time</button>
      <Menu position="bottom-start" shadow="md" width={240} withinPortal>
        <Menu.Target><button type="button" className={category === "all" ? "v2-chip" : "v2-chip active"}><Tag size={16} />{categoryLabel}<CaretDown size={13} weight="bold" /></button></Menu.Target>
        <Menu.Dropdown className="v2-category-menu">
          <Menu.Item onClick={() => setCategory("all")}>Any category</Menu.Item>
          {filterCategories.map((item) => <Menu.Item key={item.id} leftSection={<CategoryTile category={item.id} custom={customCategories} size={26} />} onClick={() => setCategory(item.id)}>{item.label}</Menu.Item>)}
        </Menu.Dropdown>
      </Menu>
      <Popover position="bottom-start" shadow="md" width={320} withinPortal>
        <Popover.Target><button type="button" className={extraFilterCount ? "v2-chip active" : "v2-chip"}><FunnelSimple size={16} />{extraFilterCount ? `${extraFilterCount} more filter${extraFilterCount === 1 ? "" : "s"}` : "More filters"}</button></Popover.Target>
        <Popover.Dropdown className="v2-filter-pop">
          <SlidingTabs<LedgerKindFilter> className="transaction-kind-tabs" label="Transaction type" value={kind} onChange={setKind} options={[{ id: "all", label: "All" }, { id: "expense", label: "Out" }, { id: "income", label: "In" }, { id: "transfer", label: "Transfer" }]} />
          <div className="v2-filter-pair">
            <DatePickerInput label="From" value={from || null} onChange={(value) => setFrom(value ?? "")} clearable valueFormat="MMM D, YYYY" firstDayOfWeek={0} />
            <DatePickerInput label="To" value={to || null} onChange={(value) => setTo(value ?? "")} clearable valueFormat="MMM D, YYYY" firstDayOfWeek={0} />
          </div>
          <div className="v2-filter-pair">
            <NumberInput label="Min amount" aria-label={`Minimum amount in ${currency}`} value={min} onChange={(value) => setMin(String(value))} min={0} thousandSeparator="," decimalScale={2} />
            <NumberInput label="Max amount" aria-label={`Maximum amount in ${currency}`} value={max} onChange={(value) => setMax(String(value))} min={0} thousandSeparator="," decimalScale={2} />
          </div>
          <Select label="Paid by" value={paymentMode} onChange={(value) => value && setPaymentMode(value as PaymentMode | "all")} data={[{ value: "all", label: "Any way" }, { value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" }, { value: "online", label: "Online payment" }]} allowDeselect={false} disabled={kind === "transfer"} comboboxProps={{ withinPortal: false }} />
          <button type="button" className="v2-button" disabled={!extraFilterCount} onClick={clearFilters}>Clear these filters</button>
        </Popover.Dropdown>
      </Popover>
    </div>

    <div className="v2-totals">
      <div className="v2-total is-out"><span>Out</span><strong className="amount">{formatMoney(totals.outMinor, currency)}</strong></div>
      <div className="v2-total is-in"><span>In</span><strong className="amount">{formatMoney(totals.inMinor, currency)}</strong></div>
    </div>

    <div className="v2-tx-layout">
      <section className="v2-tx-list" aria-label={`${sorted.length} ${sorted.length === 1 ? "entry" : "entries"}`}>
        {visibleDays.map((day) => {
          const net = day.earnedMinor - day.spentMinor;
          return <section key={day.dayKey} className="v2-card v2-tx-day" aria-label={formatLedgerDay(day.dayKey, calendarSystem)}>
            <header className="v2-day-head"><span>{dayGroupLabel(day.dayKey, today)} · {formatLedgerDay(day.dayKey, calendarSystem, "date")}</span><span className="amount">{net > 0 ? "+" : net < 0 ? "−" : ""}{plainAmount(Math.abs(net))}{day.movedMinor > 0 ? ` · ${plainAmount(day.movedMinor)} moved` : ""}</span></header>
            <ul className="v2-rows">{day.items.map((item) => {
              const key = activityKey(item);
              const pending = item.type === "transaction" ? deletingId === item.transaction.id : deletingId === `transfer:${item.transfer.id}`;
              return <EntryRow key={key} item={item} accounts={paymentAccounts} customCategories={customCategories} selected={selectedKey === key && wide} deletePending={pending} onOpen={openItem} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={(entry) => void remove(entry)} onDeleteTransfer={askDeleteTransfer} />;
            })}</ul>
          </section>;
        })}
        {!sorted.length && <div className="v2-card v2-tx-empty"><EmptyState title={query || category !== "all" || extraFilterCount || accountChip !== "all" ? "No matching entries" : range === "month" ? `Nothing logged in ${formatLedgerMonth(month, calendarSystem)}` : "Nothing logged yet"} message={query || category !== "all" || extraFilterCount || accountChip !== "all" ? "Try another search, account or filter." : "Tap + to add entries, or import a statement."} action={kind === "transfer" ? undefined : <button className="v2-button is-primary" onClick={() => onAdd(activeOccurredOn())}><Plus size={17} />Add entries</button>} /></div>}
        {visibleCountShown < sorted.length && <nav className="v2-load-more" aria-label="More transactions"><span aria-live="polite">Showing {visibleCountShown} of {sorted.length}</span><button className="v2-button" onClick={() => setVisibleCount((count) => count + 50)}>Load 50 more</button></nav>}
      </section>
      {wide && <aside className="v2-tx-side" aria-label="Entry details">
        {selectedItem
          ? <EntryDetail item={selectedItem} accounts={paymentAccounts} customCategories={customCategories} currency={currency} deletePending={selectedItem.type === "transaction" ? deletingId === selectedItem.transaction.id : deletingId === `transfer:${selectedItem.transfer.id}`} onClose={() => setSelectedKey(null)} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={(entry) => void remove(entry)} onDeleteTransfer={askDeleteTransfer} />
          : <div className="v2-card v2-detail-empty"><span className="v2-tile" style={{ "--tile-bg": "#dcebe1", "--tile-ink": "#24503d", "--tile-size": "48px" } as CSSProperties} aria-hidden="true"><CursorClick size={24} weight="duotone" /></span><strong>Pick an entry</strong><p>Its details and actions show here.</p></div>}
      </aside>}
    </div>
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
