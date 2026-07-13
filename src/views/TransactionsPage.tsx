import { DownloadSimple, FunnelSimple, MagnifyingGlass, Plus, UploadSimple, X } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { TransactionRow } from "../components/TransactionRow";
import { CATEGORIES, getCategory } from "../lib/categories";
import { parseTransactionCsv } from "../lib/csv";
import type { CurrencyCode, CustomCategory, LedgerTransaction, TransactionDraft, TransactionKind } from "../types";

interface TransactionsPageProps {
  currency: CurrencyCode; transactions: LedgerTransaction[]; customCategories: CustomCategory[];
  onAdd: () => void; onEdit: (transaction: LedgerTransaction) => void; onDelete: (transaction: LedgerTransaction) => void;
  onImport: (drafts: TransactionDraft[]) => Promise<number>;
}

export function TransactionsPage({ currency, transactions, customCategories, onAdd, onEdit, onDelete, onImport }: TransactionsPageProps) {
  const [query, setQuery] = useState(""); const [kind, setKind] = useState<TransactionKind | "all">("all");
  const [category, setCategory] = useState("all"); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [min, setMin] = useState(""); const [max, setMax] = useState(""); const [tag, setTag] = useState(""); const [filtersOpen, setFiltersOpen] = useState(false);
  const [preview, setPreview] = useState<TransactionDraft[] | null>(null); const [importErrors, setImportErrors] = useState<string[]>([]); const [importing, setImporting] = useState(false); const fileRef = useRef<HTMLInputElement>(null);
  const tags = useMemo(() => [...new Set(transactions.flatMap((item) => item.tags))].sort(), [transactions]);
  const sorted = useMemo(() => [...transactions]
    .filter((item) => kind === "all" || item.kind === kind)
    .filter((item) => category === "all" || item.category === category)
    .filter((item) => !from || item.occurredOn >= from).filter((item) => !to || item.occurredOn <= to)
    .filter((item) => !min || item.amountMinor >= Number(min) * 100).filter((item) => !max || item.amountMinor <= Number(max) * 100)
    .filter((item) => !tag || item.tags.includes(tag))
    .filter((item) => `${item.note} ${getCategory(item.category, customCategories).label} ${item.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => `${b.occurredOn}${b.createdAt}`.localeCompare(`${a.occurredOn}${a.createdAt}`)), [transactions, kind, category, from, to, min, max, tag, query, customCategories]);

  const readFile = async (file: File) => { const result = parseTransactionCsv(await file.text(), customCategories); setPreview(result.rows); setImportErrors(result.errors); };
  const importRows = async () => { if (!preview?.length) return; setImporting(true); try { await onImport(preview); setPreview(null); setImportErrors([]); } finally { setImporting(false); } };
  const resetFilters = () => { setKind("all"); setCategory("all"); setFrom(""); setTo(""); setMin(""); setMax(""); setTag(""); setQuery(""); };

  return <div className="page list-page">
    <header className="page-header"><div><span className="eyebrow">Your ledger</span><h1>Transactions</h1><p>Every income and expense entry, in one clear timeline.</p></div><div className="header-actions"><input ref={fileRef} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={(event) => event.target.files?.[0] && void readFile(event.target.files[0])} /><button className="secondary-button" onClick={() => fileRef.current?.click()}><UploadSimple size={18} />Import CSV</button><button className="primary-button" onClick={onAdd}><Plus size={18} />Add transaction</button></div></header>
    <section className="toolbar"><label className="search-field"><MagnifyingGlass size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes, categories or tags" />{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={17} /></button>}</label><div className="filter-tabs" aria-label="Filter transaction type"><FunnelSimple size={18} />{(["all", "expense", "income"] as const).map((value) => <button key={value} className={kind === value ? "active" : ""} onClick={() => setKind(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}<button className={filtersOpen ? "active" : ""} onClick={() => setFiltersOpen((open) => !open)}>More</button></div></section>
    {filtersOpen && <section className="advanced-filters"><label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{[...CATEGORIES, ...customCategories].map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label><span>Min amount</span><input inputMode="decimal" value={min} onChange={(event) => setMin(event.target.value)} /></label><label><span>Max amount</span><input inputMode="decimal" value={max} onChange={(event) => setMax(event.target.value)} /></label><label><span>Tag</span><select value={tag} onChange={(event) => setTag(event.target.value)}><option value="">Any tag</option>{tags.map((item) => <option key={item}>{item}</option>)}</select></label><button className="text-button" onClick={resetFilters}>Clear all</button></section>}
    <section className="ledger-list"><div className="ledger-list-heading"><span>{sorted.length} {sorted.length === 1 ? "entry" : "entries"}</span><span>Newest first</span></div>{sorted.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} currency={currency} customCategories={customCategories} onEdit={onEdit} onDelete={onDelete} />)}{!sorted.length && <EmptyState title="No matching entries" message="Try a different filter, or add a new transaction." action={<button className="primary-button small" onClick={onAdd}><Plus size={17} />Add transaction</button>} />}</section>
    {preview && <div className="modal-backdrop"><section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title"><header><div><span className="eyebrow">CSV IMPORT</span><h2 id="import-title">Review before importing</h2></div><button className="icon-button" onClick={() => setPreview(null)} aria-label="Close"><X size={20} /></button></header>{importErrors.length > 0 && <div className="import-errors"><strong>{importErrors.length} rows need attention</strong>{importErrors.slice(0, 5).map((error) => <span key={error}>{error}</span>)}</div>}<div className="import-preview">{preview.slice(0, 8).map((row, index) => <div key={`${row.occurredOn}-${index}`}><span>{row.occurredOn}</span><strong>{row.note || getCategory(row.category, customCategories).label}</strong><span>{row.kind}</span><span>{row.amount} {currency}</span></div>)}</div><p>{preview.length} valid rows ready. Invalid rows will not be imported.</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setPreview(null)}>Cancel</button><button className="primary-button" disabled={!preview.length || importing} onClick={() => void importRows()}><DownloadSimple size={17} />{importing ? "Importing…" : `Import ${preview.length} rows`}</button></div></section></div>}
  </div>;
}
