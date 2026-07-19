import { ArrowSquareOut, CalendarBlank, Check, HandCoins, Paperclip, PencilSimple, Plus, Trash, User, Wallet } from "@phosphor-icons/react";
import { NumberInput, Select, TextInput, Textarea } from "@mantine/core";
import { addDays, format, parseISO } from "date-fns";
import { useMemo, useState } from "react";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { EmptyState } from "../components/EmptyState";
import { allCategoriesFor, getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { dueDateLabel, duePaid, dueRemaining } from "../lib/dues";
import { discardReceipt, uploadReceipt } from "../lib/receipts";
import type { CurrencyCode, CustomCategory, DueDraft, DueItem, DueKind, ReceiptUpload } from "../types";

type DuesTab = "upcoming" | "lent" | "borrowed" | "settled";
const today = () => format(new Date(), "yyyy-MM-dd");
const dueDefault = () => format(addDays(new Date(), 7), "yyyy-MM-dd");
const reminderDefault = () => format(addDays(new Date(), 6), "yyyy-MM-dd");
const labels: Record<DueKind, { title: string; amount: string }> = {
  payment: { title: "Payment name", amount: "Amount to pay" }, receivable: { title: "Expected income", amount: "Amount to receive" },
  lent: { title: "What was it for?", amount: "Amount lent" }, borrowed: { title: "What was it for?", amount: "Amount borrowed" },
};

function DueKindToggle({ value, disabled, onChange }: { value: DueKind; disabled: boolean; onChange: (value: string) => void }) {
  const options: { value: DueKind; label: string }[] = [
    { value: "payment", label: "Pay" }, { value: "receivable", label: "Receive" },
    { value: "lent", label: "Lent" }, { value: "borrowed", label: "Borrowed" },
  ];
  return <div className="due-kind-control" role="radiogroup" aria-label="Due type">
    {options.map((option) => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={value === option.value ? "active" : ""} disabled={disabled} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

interface Props {
  currency: CurrencyCode; items: DueItem[]; customCategories: CustomCategory[];
  onSave: (draft: DueDraft, id?: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
  onRecordPayment: (id: string, amount: string, occurredOn: string, note: string, addToLedger: boolean) => Promise<void>;
  onComplete: (id: string, addToLedger: boolean) => Promise<void>;
}

export function DuesPage({ currency, items, customCategories, onSave, onDelete, onRecordPayment, onComplete }: Props) {
  const [tab, setTab] = useState<DuesTab>("upcoming");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DueItem | null>(null);
  const filtered = useMemo(() => items.filter((item) => tab === "settled" ? item.status === "completed" : item.status === "open" && (tab === "upcoming" ? item.kind === "payment" || item.kind === "receivable" : item.kind === tab)), [items, tab]);
  const openCount = items.filter((item) => item.status === "open").length;
  return <div className="page dues-page">
    <header className="page-header"><div><span className="eyebrow">Promises your money needs to keep</span><h1>Dues</h1><p>Remember upcoming payments and keep track of money between people.</p></div><button className="primary-button" onClick={() => { setEditing(null); setShowForm((value) => !value); }}><Plus size={18} />Add due</button></header>
    <section className="dues-summary"><div><span>Open items</span><strong>{openCount}</strong></div><div><span>To receive</span><strong className="income">{formatMoney(items.filter((item) => item.status === "open" && (item.kind === "receivable" || item.kind === "lent")).reduce((sum, item) => sum + dueRemaining(item), 0), currency)}</strong></div><div><span>To pay</span><strong className="expense">{formatMoney(items.filter((item) => item.status === "open" && (item.kind === "payment" || item.kind === "borrowed")).reduce((sum, item) => sum + dueRemaining(item), 0), currency)}</strong></div></section>
    <nav className="section-tabs dues-tabs" aria-label="Due sections">{(["upcoming", "lent", "borrowed", "settled"] as DuesTab[]).map((id) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{id === "upcoming" ? "Upcoming" : id[0].toUpperCase() + id.slice(1)}</button>)}</nav>
    <div className={showForm ? "dues-layout form-open" : "dues-layout"}>
      {showForm && <DueForm key={editing?.id ?? "new"} item={editing} currency={currency} customCategories={customCategories} onSave={async (draft) => { await onSave(draft, editing?.id); setShowForm(false); setEditing(null); }} onCancel={() => { setShowForm(false); setEditing(null); }} />}
      <section className="dues-content">
        <div className="dues-list">{filtered.map((item) => <DueCard key={item.id} item={item} currency={currency} customCategories={customCategories} onEdit={() => { setEditing(item); setShowForm(true); }} onDelete={onDelete} onRecordPayment={onRecordPayment} onComplete={onComplete} />)}</div>
        {!filtered.length && <EmptyState action={tab !== "settled" ? <button className="text-button" onClick={() => setShowForm(true)}>Add your first {tab === "upcoming" ? "upcoming payment" : tab.slice(0, -1)}</button> : undefined} />}
      </section>
    </div>
  </div>;
}

function DueForm({ item, currency, customCategories, onSave, onCancel }: { item: DueItem | null; currency: CurrencyCode; customCategories: CustomCategory[]; onSave: (draft: DueDraft) => Promise<void>; onCancel: () => void }) {
  const [kind, setKind] = useState<DueKind>(item?.kind ?? "payment"); const [title, setTitle] = useState(item?.title ?? ""); const [person, setPerson] = useState(item?.person ?? ""); const [amount, setAmount] = useState<string | number>(item ? item.amountMinor / 100 : "");
  const [category, setCategory] = useState(item?.category ?? "other"); const [occurredOn, setOccurredOn] = useState(item?.occurredOn ?? today()); const [dueOn, setDueOn] = useState(item?.dueOn ?? dueDefault()); const [remindOn, setRemindOn] = useState(item ? item.remindOn ?? "" : reminderDefault()); const [note, setNote] = useState(item?.note ?? ""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptUpload | undefined>();
  const direction = kind === "payment" || kind === "borrowed" ? "expense" : "income";
  const categories = allCategoriesFor(direction, customCategories);
  const changeKind = (value: string) => { const next = value as DueKind; setKind(next); const nextDirection = next === "payment" || next === "borrowed" ? "expense" : "income"; setCategory(allCategoriesFor(nextDirection, customCategories)[0]?.id ?? "other"); };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); try { setError(null); await onSave({ kind, title, person, amount: String(amount), category, occurredOn: kind === "lent" || kind === "borrowed" ? occurredOn : "", dueOn, remindOn, note, receipt }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save this due."); } finally { setSaving(false); } };
  const cancel = () => { if (receipt) void discardReceipt(receipt); onCancel(); };
  return <aside className="due-form-panel"><div className="section-heading"><div><span className="section-label">{item ? "Update reminder" : "New reminder"}</span><h2>{item ? "Edit due" : "Add a due"}</h2></div></div><form className="stack-form" onSubmit={submit} aria-busy={saving}>
    <DueKindToggle value={kind} onChange={changeKind} disabled={Boolean(item?.payments.length)} />
    <TextInput label={labels[kind].title} value={title} onChange={(event) => setTitle(event.currentTarget.value)} required maxLength={100} />
    {(kind === "lent" || kind === "borrowed") && <TextInput label="Person" leftSection={<User size={15} />} value={person} onChange={(event) => setPerson(event.currentTarget.value)} required maxLength={80} />}
    <NumberInput label={labels[kind].amount} leftSection={currency} leftSectionWidth={58} value={amount} onChange={setAmount} min={0.01} decimalScale={2} thousandSeparator="," required />
    <Select label="Ledger category" value={category} onChange={(value) => value && setCategory(value)} data={categories.map((item) => ({ value: item.id, label: item.label }))} allowDeselect={false} searchable />
    {(kind === "lent" || kind === "borrowed") && <TextInput label="Date money changed hands" type="date" leftSection={<CalendarBlank size={16} aria-hidden />} value={occurredOn} onChange={(event) => setOccurredOn(event.currentTarget.value)} required />}
    <TextInput label="Due date" type="date" leftSection={<CalendarBlank size={16} aria-hidden />} value={dueOn} onChange={(event) => setDueOn(event.currentTarget.value)} required />
    <TextInput label="Remind me on" type="date" leftSection={<CalendarBlank size={16} aria-hidden />} value={remindOn} onChange={(event) => setRemindOn(event.currentTarget.value)} description="The bell will show this item from this date." />
    <Textarea label="Note" value={note} onChange={(event) => setNote(event.currentTarget.value)} maxLength={300} autosize minRows={2} />
    <div className="receipt-field"><label><Paperclip size={17} /><span>{receipt?.name ?? "Attach receipt or document"}</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (!file) return; setError(null); void uploadReceipt(file).then((value) => { if (receipt) void discardReceipt(receipt); setReceipt(value); }).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not attach this file.")); }} /></label>{receipt && <button type="button" className="text-button danger-text" onClick={() => { void discardReceipt(receipt); setReceipt(undefined); }}>Remove</button>}</div>
    <p className="field-hint">Maximum file size: 3 MB.</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    <button className="primary-button" disabled={saving || !title.trim() || !amount || !dueOn}>{saving ? <><ButtonSpinner />Saving…</> : "Save due"}</button><button type="button" className="secondary-button" onClick={cancel} disabled={saving}>Cancel</button>
  </form></aside>;
}

function DueCard({ item, currency, customCategories, onEdit, onDelete, onRecordPayment, onComplete }: { item: DueItem; currency: CurrencyCode; customCategories: CustomCategory[]; onEdit: () => void; onDelete: (id: string) => Promise<void>; onRecordPayment: Props["onRecordPayment"]; onComplete: Props["onComplete"] }) {
  const [repaying, setRepaying] = useState(false); const [amount, setAmount] = useState<string | number>(dueRemaining(item) / 100); const [date, setDate] = useState(today()); const [note, setNote] = useState(""); const [addToLedger, setAddToLedger] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const isDebt = item.kind === "lent" || item.kind === "borrowed"; const remaining = dueRemaining(item); const paid = duePaid(item); const overdue = item.status === "open" && item.dueOn < today();
  const complete = async (log: boolean) => { setBusy(true); try { setError(null); await onComplete(item.id, log); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not complete this item."); } finally { setBusy(false); } };
  const record = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); try { setError(null); await onRecordPayment(item.id, String(amount), date, note, addToLedger); setRepaying(false); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not record this repayment."); } finally { setBusy(false); } };
  const remove = async () => { if (!window.confirm(`Delete “${item.title}” and its repayment history?`)) return; setBusy(true); try { await onDelete(item.id); } finally { setBusy(false); } };
  return <article className={`due-card ${item.status} ${overdue ? "overdue" : ""}`}>
    <div className={`due-card-icon ${item.kind}`}>{isDebt ? <HandCoins size={23} weight="duotone" /> : <CalendarBlank size={23} weight="duotone" />}</div>
    <div className="due-card-main"><div className="due-card-heading"><div><span>{item.kind === "receivable" ? "To receive" : item.kind === "payment" ? "To pay" : item.kind}</span><h2>{item.title}</h2>{item.person && <small><User size={12} />{item.person}</small>}</div><div><strong>{formatMoney(remaining, currency)}</strong><small>{item.status === "completed" ? `Settled ${item.completedOn ? format(parseISO(item.completedOn), "MMM d, yyyy") : ""}` : dueDateLabel(item.dueOn)}</small></div></div>
      <div className="due-meta"><span><Wallet size={14} />{getCategory(item.category, customCategories).label}</span>{paid > 0 && <span>{formatMoney(paid, currency)} repaid</span>}{item.remindOn && item.status === "open" && <span>Reminder {format(parseISO(item.remindOn), "MMM d")}</span>}</div>
      {item.note && <p>{item.note}</p>}
      {item.receipt && <a className="receipt-link" href={`/api/receipts/${item.receipt.id}`} target="_blank" rel="noreferrer"><Paperclip size={14} />{item.receipt.name}<ArrowSquareOut size={13} /></a>}
      {item.status === "open" && <div className="due-actions">{isDebt ? <button className="primary-button small" onClick={() => setRepaying((value) => !value)}><HandCoins size={16} />Record repayment</button> : <><button className="primary-button small" disabled={busy} onClick={() => void complete(true)}>{busy ? <ButtonSpinner /> : <Check size={16} />}{item.kind === "payment" ? "Paid + add to ledger" : "Received + add to ledger"}</button><button className="secondary-button small" disabled={busy} onClick={() => void complete(false)}>Complete only</button></>}<button className="icon-button" disabled={busy} onClick={onEdit} aria-label={`Edit ${item.title}`}><PencilSimple size={16} /></button><button className="icon-button danger" disabled={busy} onClick={() => void remove()} aria-label={`Delete ${item.title}`}><Trash size={16} /></button></div>}
      {repaying && <form className="repayment-form" onSubmit={record}><NumberInput label="Amount" value={amount} onChange={setAmount} min={0.01} max={remaining / 100} decimalScale={2} thousandSeparator="," required /><TextInput label="Date" type="date" leftSection={<CalendarBlank size={16} aria-hidden />} value={date} onChange={(event) => setDate(event.currentTarget.value)} required /><TextInput label="Note" value={note} onChange={(event) => setNote(event.currentTarget.value)} placeholder="Optional" /><label className="ledger-checkbox"><input type="checkbox" checked={addToLedger} onChange={(event) => setAddToLedger(event.currentTarget.checked)} /><span>Add this cash movement to the ledger</span></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="primary-button" disabled={busy}>{busy ? <><ButtonSpinner />Recording…</> : "Record repayment"}</button></form>}
      {error && !repaying && <div className="form-error" role="alert">{error}</div>}
    </div>
  </article>;
}
