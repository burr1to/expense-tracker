import { ArrowCounterClockwise, ArrowSquareOut, CalendarBlank, CaretDown, ChatCircleText, ChatText, Check, Copy, HandCoins, LockSimple, Paperclip, PencilSimple, Plus, Receipt, ShareNetwork, Trash, User, Wallet, WhatsappLogo } from "@phosphor-icons/react";
import { Autocomplete, NumberInput, SegmentedControl, Select, TextInput, Textarea } from "@mantine/core";
import { addDays, format, parseISO } from "date-fns";
import { formatLedgerDate, formatLedgerMonth, todayInput } from "../lib/dates";
import { useEffect, useMemo, useRef, useState } from "react";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { SlidingTabs } from "../components/SlidingTabs";
import { EmptyState } from "../components/EmptyState";
import { LedgerDatePickerInput as DatePickerInput } from "../components/LedgerDatePickerInput";
import { getCategory, LOAN_CATEGORY_ID, spendingCategoriesFor } from "../lib/categories";
import { formatMoney, majorToMinor } from "../lib/currency";
import { buildDebtPlan, isPlannableDebt, type PayoffStrategy } from "../lib/debt-planner";
import { buildDueReminderMessage, reminderShareLinks, type ReminderLanguage } from "../lib/due-reminder-message";
import { dueCategoryForKind, dueDateLabel, dueDirection, dueKindForTab, dueOpeningMovementsByDue, duePaid, duePaymentHistory, dueRemaining, isDebtKind, latestDuePayment, shortDueDate } from "../lib/dues";
import { onlinePaymentAccounts, paymentAccountLabel } from "../lib/payment-accounts";
import { discardReceipt, uploadReceipt } from "../lib/receipts";
import { personSuggestions } from "../lib/split-bill";
import { newClientRequestId } from "../lib/transaction-defaults";
import type { DueSettlementOptions } from "../context/LedgerContext";
import type { CalendarSystem, CurrencyCode, CustomCategory, DueDraft, DueItem, DueKind, DuePayment, LedgerTransaction, PaymentAccount, ReceiptUpload } from "../types";
import { FormError } from "../components/FormError";

type DuesTab = "upcoming" | "lent" | "borrowed" | "settled";
type AccountOption = { value: string; label: string };
const today = () => todayInput();
const dueDefault = () => format(addDays(parseISO(today()), 7), "yyyy-MM-dd");
const reminderDefault = () => format(addDays(parseISO(today()), 6), "yyyy-MM-dd");
const bsHint = (value: string | null | undefined, system: CalendarSystem) => system === "BS" && value ? formatLedgerDate(value, "BS") : undefined;
const emptyCopy: Record<DuesTab, { title: string; message: string; action?: string }> = {
  upcoming: { title: "No bills or income waiting", message: "Add a bill you need to pay or money you expect, and the bell reminds you on time.", action: "Add a bill or income" },
  lent: { title: "Nobody owes you money right now", message: "Log money you lend to friends or family, or split a bill, and track every repayment here.", action: "Add money you lent" },
  borrowed: { title: "You don't owe anyone", message: "Log money you borrow to see what is left to repay and plan paying it off.", action: "Add money you borrowed" },
  settled: { title: "Nothing settled yet", message: "Paid bills and fully repaid loans move here, with their repayment history." },
};
const REMINDER_LANGUAGE_KEY = "dues.reminderLanguage";
const readReminderLanguage = (): ReminderLanguage => { try { return window.localStorage.getItem(REMINDER_LANGUAGE_KEY) === "ne" ? "ne" : "en"; } catch { return "en"; } };
const strategyLabels: Record<PayoffStrategy, string> = { snowball: "Snowball — smallest balance first", avalanche: "Avalanche — highest rate first", dueDate: "Due date — earliest first" };
const labels: Record<DueKind, { title: string; amount: string }> = {
  payment: { title: "Payment name", amount: "Amount to pay" }, receivable: { title: "Expected income", amount: "Amount to receive" },
  lent: { title: "What was it for?", amount: "Amount lent" }, borrowed: { title: "What was it for?", amount: "Amount borrowed" },
};

function DueKindToggle({ value, disabled, onChange }: { value: DueKind; disabled: boolean; onChange: (value: string) => void }) {
  return <div className="due-kind-control"><SlidingTabs<DueKind> label="Due type" value={value} disabled={disabled} onChange={onChange} options={[
    { id: "payment", label: "Pay" }, { id: "receivable", label: "Receive" },
    { id: "lent", label: "Lent" }, { id: "borrowed", label: "Borrowed" },
  ]} /></div>;
}

interface Props {
  currency: CurrencyCode; items: DueItem[]; customCategories: CustomCategory[];
  /** The ledger, to find each loan's opening movement and where each repayment landed. */
  transactions: LedgerTransaction[];
  /** Your own accounts; money lent, borrowed or repaid can only move through them. */
  paymentAccounts: PaymentAccount[];
  calendarSystem: CalendarSystem;
  onSave: (draft: DueDraft, id?: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
  onRecordPayment: (id: string, amount: string, occurredOn: string, note: string, addToLedger: boolean, options?: DueSettlementOptions) => Promise<void>;
  onComplete: (id: string, addToLedger: boolean, options?: DueSettlementOptions & { amount?: string; occurredOn?: string }) => Promise<void>;
  onUndoPayment: (paymentId: string) => Promise<void>;
  onSplitBill?: () => void;
  focusedId?: string | null;
  focusedAction?: "repay" | null;
}

export function DuesPage({ currency, items, customCategories, transactions, paymentAccounts, calendarSystem, onSave, onDelete, onRecordPayment, onComplete, onUndoPayment, onSplitBill, focusedId, focusedAction }: Props) {
  const [tab, setTab] = useState<DuesTab>("upcoming");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DueItem | null>(null);
  const [newKind, setNewKind] = useState<DueKind>("payment");
  const accountOptions = useMemo<AccountOption[]>(() => [{ value: "cash", label: "Cash" }, ...onlinePaymentAccounts(paymentAccounts).map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))], [paymentAccounts]);
  const openings = useMemo(() => dueOpeningMovementsByDue(transactions), [transactions]);
  const transactionsById = useMemo(() => new Map(transactions.map((transaction) => [transaction.id, transaction])), [transactions]);
  const people = useMemo(() => personSuggestions(items), [items]);
  const addDue = () => { setEditing(null); setNewKind(dueKindForTab(tab)); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditing(null); };
  const filtered = useMemo(() => items.filter((item) => tab === "settled" ? item.status === "completed" : item.status === "open" && (tab === "upcoming" ? item.kind === "payment" || item.kind === "receivable" : item.kind === tab)), [items, tab]);
  const openSummary = useMemo(() => {
    let openCount = 0;
    let toReceive = 0;
    let toPay = 0;
    for (const item of items) {
      if (item.status !== "open") continue;
      openCount += 1;
      const remaining = dueRemaining(item);
      if (item.kind === "receivable" || item.kind === "lent") toReceive += remaining;
      else if (item.kind === "payment" || item.kind === "borrowed") toPay += remaining;
    }
    return { openCount, toReceive, toPay };
  }, [items]);
  const focusedItem = items.find((item) => item.id === focusedId);
  // Each link (a bell tap, a search hit) moves to its due once. After that the tabs and scroll are the user's again,
  // so settling the due, switching tabs or a ledger refresh never pulls the page back to it.
  const focusRequest = focusedItem ? `${focusedItem.id}:${focusedAction ?? ""}` : null;
  const handledFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusedItem || !focusRequest) { handledFocus.current = null; return; }
    if (handledFocus.current === focusRequest) return;
    const nextTab: DuesTab = focusedItem.status === "completed"
      ? "settled"
      : focusedItem.kind === "lent" || focusedItem.kind === "borrowed"
        ? focusedItem.kind
        : "upcoming";
    if (tab !== nextTab) {
      setTab(nextTab);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      handledFocus.current = focusRequest;
      const node = document.getElementById(`due-${focusedItem.id}`);
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
      node?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedItem, focusRequest, tab]);
  return <div className="page dues-page">
    <header className="page-header"><div><span className="eyebrow">Promises your money needs to keep</span><h1>Dues</h1><p>Remember upcoming payments and keep track of money between people.</p></div><button className="primary-button" onClick={() => showForm && !editing && newKind === dueKindForTab(tab) ? closeForm() : addDue()}><Plus size={18} />Add due</button></header>
    <section className="dues-summary"><div><span>Open items</span><strong>{openSummary.openCount}</strong></div><div><span>To receive</span><strong className="income">{formatMoney(openSummary.toReceive, currency)}</strong></div><div><span>To pay</span><strong className="expense">{formatMoney(openSummary.toPay, currency)}</strong></div></section>
    <div className="section-tabs-slot dues-tabs"><SlidingTabs<DuesTab> label="Due sections" value={tab} onChange={setTab} options={[
      { id: "upcoming", label: "Upcoming" }, { id: "lent", label: "Lent" }, { id: "borrowed", label: "Borrowed" }, { id: "settled", label: "Settled" },
    ]} /></div>
    <div className={showForm ? "dues-layout form-open" : "dues-layout"}>
      {showForm && <DueForm key={editing?.id ?? `new-${newKind}`} item={editing} initialKind={newKind} currency={currency} customCategories={customCategories} calendarSystem={calendarSystem} accountOptions={accountOptions} opening={editing ? openings.get(editing.id) : undefined} people={people} onSave={async (draft) => { await onSave(draft, editing?.id); closeForm(); }} onCancel={closeForm} />}
      <section className="dues-content">
        {tab === "borrowed" && items.some(isPlannableDebt) && <DebtPayoffPlan items={items} currency={currency} calendarSystem={calendarSystem} />}
        {tab === "lent" && onSplitBill && filtered.length > 0 && <div className="dues-tab-actions"><p>Paid for friends? Split it and each person gets a Lent due.</p><button type="button" className="secondary-button small" onClick={onSplitBill}><Receipt size={16} />Split a bill</button></div>}
        <div className="dues-list">{filtered.map((item) => <DueCard key={item.id} item={item} currency={currency} customCategories={customCategories} calendarSystem={calendarSystem} accountOptions={accountOptions} opening={openings.get(item.id)} transactionsById={transactionsById} focused={item.id === focusedId} startRepayment={item.id === focusedId && focusedAction === "repay"} onEdit={() => { setEditing(item); setShowForm(true); }} onDelete={onDelete} onRecordPayment={onRecordPayment} onComplete={onComplete} onUndoPayment={onUndoPayment} />)}</div>
        {!filtered.length && <EmptyState title={emptyCopy[tab].title} message={emptyCopy[tab].message} action={emptyCopy[tab].action ? <div className="dues-empty-actions"><button type="button" className="text-button" onClick={addDue}><Plus size={15} />{emptyCopy[tab].action}</button>{tab === "lent" && onSplitBill && <button type="button" className="text-button" onClick={onSplitBill}><Receipt size={15} />Split a bill</button>}</div> : undefined} />}
      </section>
    </div>
  </div>;
}

/** A starting budget that always produces a real plan: a tenth of the balance, never less than the interest it has to outrun. */
function suggestedBudgetMinor(debts: readonly DueItem[]) {
  const remaining = debts.reduce((sum, item) => sum + dueRemaining(item), 0);
  const interest = debts.reduce((sum, item) => sum + Math.round(dueRemaining(item) * Math.max(0, item.annualRatePercent ?? 0) / 1200), 0);
  return Math.max(100, Math.ceil(Math.max(remaining / 10, interest * 1.25) / 100) * 100);
}

function DebtPayoffPlan({ items, currency, calendarSystem }: { items: DueItem[]; currency: CurrencyCode; calendarSystem: CalendarSystem }) {
  const debts = useMemo(() => items.filter(isPlannableDebt), [items]);
  const monthLabel = (date: string) => calendarSystem === "BS" ? formatLedgerMonth(parseISO(date), "BS") : format(parseISO(date), "MMM yyyy");
  const hasInterest = debts.some((item) => (item.annualRatePercent ?? 0) > 0);
  const [strategy, setStrategy] = useState<PayoffStrategy>("snowball");
  const [budget, setBudget] = useState<string | number>(() => suggestedBudgetMinor(debts) / 100);
  // With every rate blank, avalanche is a meaningless tie — it is hidden, so never plan with it either.
  const activeStrategy = strategy === "avalanche" && !hasInterest ? "snowball" : strategy;
  const budgetMinor = Math.max(0, Math.round(Number(budget || 0) * 100));
  const plan = useMemo(() => buildDebtPlan(debts, budgetMinor, activeStrategy, today()), [debts, budgetMinor, activeStrategy]);
  const strategies = (["snowball", "avalanche", "dueDate"] as PayoffStrategy[]).filter((value) => value !== "avalanche" || hasInterest);
  return <section className="payoff-plan">
    <div className="section-heading"><div><span className="section-label">Payoff plan</span><h2>Get debt free</h2></div><strong><span className="payoff-money">{formatMoney(plan.totalRemainingMinor, currency)}</span> owed</strong></div>
    <div className="payoff-plan-controls">
      <Select label="Order" value={activeStrategy} onChange={(value) => value && setStrategy(value as PayoffStrategy)} data={strategies.map((value) => ({ value, label: strategyLabels[value] }))} allowDeselect={false} />
      <NumberInput label="Monthly budget" leftSection={currency} leftSectionWidth={58} value={budget} onChange={setBudget} min={0} decimalScale={2} thousandSeparator="," description="Everything you can put towards these debts each month." />
    </div>
    {plan.impossible
      ? <p className="payoff-plan-warning"><HandCoins size={17} weight="duotone" />Your budget does not cover the interest these debts accrue, so the balance never falls. You need more than <span className="payoff-money">{formatMoney(plan.minimumMonthlyMinor, currency)}</span> a month before a payoff date exists.</p>
      : <div className="payoff-plan-headline"><div><span>Debt free</span><strong>{plan.debtFreeOn ? monthLabel(plan.debtFreeOn) : "—"}</strong><small>{plan.monthsToDebtFree} {plan.monthsToDebtFree === 1 ? "month" : "months"} from today</small></div><div><span>Interest you pay</span><strong className="payoff-money">{formatMoney(plan.totalInterestMinor, currency)}</strong><small>{hasInterest ? <><span className="payoff-money">{formatMoney(plan.minimumMonthlyMinor, currency)}</span> accruing this month</> : "None of these debts charge interest"}</small></div></div>}
    <ol className="payoff-plan-list">{plan.entries.map((entry) => <li key={entry.item.id} className="payoff-plan-row">
      <span className="payoff-plan-order">{entry.order + 1}</span>
      <div className="payoff-plan-row-main"><strong>{entry.item.title}</strong><small>{[entry.item.person, entry.item.annualRatePercent ? `${entry.item.annualRatePercent}% a year` : "No interest"].filter(Boolean).join(" · ")}</small></div>
      <div className="payoff-plan-row-figures"><strong className="payoff-money">{formatMoney(entry.remainingMinor, currency)}</strong><small>{entry.projectedClearedOn ? `Cleared ${monthLabel(entry.projectedClearedOn)}` : "Never at this budget"}</small></div>
    </li>)}</ol>
  </section>;
}

function DueForm({ item, initialKind, currency, customCategories, calendarSystem, accountOptions, opening, people, onSave, onCancel }: { item: DueItem | null; initialKind: DueKind; currency: CurrencyCode; customCategories: CustomCategory[]; calendarSystem: CalendarSystem; accountOptions: AccountOption[]; opening?: LedgerTransaction; people: string[]; onSave: (draft: DueDraft) => Promise<void>; onCancel: () => void }) {
  const [kind, setKind] = useState<DueKind>(item?.kind ?? initialKind); const [title, setTitle] = useState(item?.title ?? ""); const [person, setPerson] = useState(item?.person ?? ""); const [amount, setAmount] = useState<string | number>(item ? item.amountMinor / 100 : "");
  const [category, setCategory] = useState(() => item?.category ?? dueCategoryForKind(initialKind, "other", customCategories)); const [occurredOn, setOccurredOn] = useState(item?.occurredOn ?? today()); const [dueOn, setDueOn] = useState(item?.dueOn ?? dueDefault()); const [remindOn, setRemindOn] = useState(item ? item.remindOn ?? "" : reminderDefault()); const [note, setNote] = useState(item?.note ?? ""); const [annualRate, setAnnualRate] = useState<string | number>(item?.annualRatePercent ?? ""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  // Where lent money left from or borrowed money arrived in. An edited loan without a recorded movement starts at "none" so saving never records it twice.
  const initialMovement = item ? opening ? movementAccountOf(opening) : "none" : "cash";
  const [movement, setMovement] = useState(initialMovement);
  const [receipt, setReceipt] = useState<ReceiptUpload | undefined>();
  const [receiptUploading, setReceiptUploading] = useState(false);
  const debt = isDebtKind(kind);
  const categories = spendingCategoriesFor(dueDirection(kind), customCategories);
  const movementOptions = [...accountOptions, ...(accountOptions.some((option) => option.value === initialMovement) || initialMovement === "none" ? [] : [{ value: initialMovement, label: "Current account" }]), { value: "none", label: "Don't record a movement" }];
  const changeKind = (value: string) => { const next = value as DueKind; setKind(next); setCategory((current) => dueCategoryForKind(next, current, customCategories)); };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (receiptUploading) return; setSaving(true); try { setError(null); await onSave({ kind, title, person, amount: String(amount), category: debt ? LOAN_CATEGORY_ID : category, occurredOn: debt ? occurredOn : "", dueOn, remindOn, note, annualRatePercent: String(annualRate ?? ""), receipt, movement: debt && (!item || movement !== initialMovement) ? movement : undefined }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save this due."); } finally { setSaving(false); } };
  const cancel = () => { if (receiptUploading) return; if (receipt) void discardReceipt(receipt); onCancel(); };
  return <aside className="due-form-panel"><div className="section-heading"><div><span className="section-label">{item ? "Update reminder" : "New reminder"}</span><h2>{item ? "Edit due" : "Add a due"}</h2></div></div><form className="stack-form" onSubmit={submit} aria-busy={saving || receiptUploading}>
    <DueKindToggle value={kind} onChange={changeKind} disabled={Boolean(item?.payments.length)} />
    <TextInput label={labels[kind].title} value={title} onChange={(event) => setTitle(event.currentTarget.value)} required maxLength={100} />
    {debt && <Autocomplete label="Person" leftSection={<User size={15} />} value={person} onChange={setPerson} data={people} limit={6} required maxLength={80} />}
    <NumberInput label={labels[kind].amount} leftSection={currency} leftSectionWidth={58} value={amount} onChange={setAmount} min={0.01} decimalScale={2} thousandSeparator="," required />
    {debt
      ? <TextInput label="Ledger category" leftSection={<LockSimple size={15} aria-hidden />} value={getCategory(LOAN_CATEGORY_ID).label} readOnly description="Loans move your balances but never count as income or spending." />
      : <Select label="Ledger category" value={category} onChange={(value) => value && setCategory(value)} data={categories.map((item) => ({ value: item.id, label: item.label }))} allowDeselect={false} searchable />}
    {debt && <DatePickerInput label="Date money changed hands" description={bsHint(occurredOn, calendarSystem)} value={occurredOn} onChange={(value) => value && setOccurredOn(value)} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />}
    {debt && <Select label={kind === "lent" ? "Money left from" : "Money arrived in"} value={movement} onChange={(value) => value && setMovement(value)} data={movementOptions} allowDeselect={false} description={movement === "none" ? "Pick this when the money is already in your ledger, for example from a split bill." : kind === "lent" ? "Recorded as a loan on that date, never as spending." : "Recorded as a loan on that date, never as income."} />}
    <DatePickerInput label="Due date" description={bsHint(dueOn, calendarSystem)} value={dueOn} onChange={(value) => value && setDueOn(value)} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />
    <DatePickerInput label="Remind me on" description={bsHint(remindOn, calendarSystem) ?? "The bell will show this item from this date."} value={remindOn || null} onChange={(value) => setRemindOn(value ?? "")} valueFormat="MMM D, YYYY" firstDayOfWeek={0} maxDate={dueOn || undefined} clearable />
    {debt && <NumberInput label="Interest rate" value={annualRate} onChange={setAnnualRate} min={0} max={200} decimalScale={2} suffix="% a year" description="Leave blank when no interest is charged. Used to order your payoff plan." />}
    <Textarea label="Note" value={note} onChange={(event) => setNote(event.currentTarget.value)} maxLength={300} autosize minRows={2} />
    <div className="receipt-field" aria-busy={receiptUploading}><label className={receiptUploading ? "uploading" : undefined}>{receiptUploading ? <ButtonSpinner /> : <Paperclip size={17} />}<span>{receiptUploading ? "Uploading receipt…" : receipt?.name ?? "Attach receipt or document"}</span><input type="file" disabled={receiptUploading} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={async (event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return; setError(null); setReceiptUploading(true); try { const value = await uploadReceipt(file); if (receipt) void discardReceipt(receipt); setReceipt(value); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not attach this file."); } finally { setReceiptUploading(false); } }} /></label>{receipt && <button type="button" className="text-button danger-text" disabled={receiptUploading} onClick={() => { void discardReceipt(receipt); setReceipt(undefined); }}>Remove</button>}</div>
    <p className="field-hint">Maximum file size: 3 MB.</p>
    <FormError message={error} />
    <button className="primary-button" disabled={saving || receiptUploading || !title.trim() || !amount || !dueOn}>{saving ? <><ButtonSpinner />Saving…</> : receiptUploading ? <><ButtonSpinner />Uploading receipt…</> : "Save due"}</button><button type="button" className="secondary-button" onClick={cancel} disabled={saving || receiptUploading}>Cancel</button>
  </form></aside>;
}

// The picker value for where a movement went: Cash for cash entries and anything booked to Cash in hand, which the pickers offer as Cash.
const movementAccountOf = (transaction: LedgerTransaction) => transaction.paymentAccountId && transaction.paymentAccount?.type !== "cash" ? transaction.paymentAccountId : "cash";
const accountLabelOf = (transaction: LedgerTransaction) => transaction.paymentAccount ? paymentAccountLabel(transaction.paymentAccount) : transaction.paymentAccountId ? "Removed account" : "Cash";

function DueCard({ item, currency, customCategories, calendarSystem, accountOptions, opening, transactionsById, focused, startRepayment, onEdit, onDelete, onRecordPayment, onComplete, onUndoPayment }: { item: DueItem; currency: CurrencyCode; customCategories: CustomCategory[]; calendarSystem: CalendarSystem; accountOptions: AccountOption[]; opening?: LedgerTransaction; transactionsById: Map<string, LedgerTransaction>; focused: boolean; startRepayment: boolean; onEdit: () => void; onDelete: (id: string) => Promise<void>; onRecordPayment: Props["onRecordPayment"]; onComplete: Props["onComplete"]; onUndoPayment: Props["onUndoPayment"] }) {
  const [panel, setPanel] = useState<"settle" | "remind" | null>(startRepayment && item.status === "open" ? "settle" : null); const [showHistory, setShowHistory] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  // A bell tap while this card is already on screen asks for the confirm step too, once per tap (an Undo that reopens the due does not).
  const repayAsked = useRef(startRepayment);
  useEffect(() => { if (startRepayment && !repayAsked.current && item.status === "open") setPanel("settle"); repayAsked.current = startRepayment; }, [startRepayment, item.status]);
  const isDebt = isDebtKind(item.kind); const remaining = dueRemaining(item); const paid = duePaid(item); const overdue = item.status === "open" && item.dueOn < today();
  const canRemind = item.status === "open" && (item.kind === "lent" || item.kind === "receivable") && remaining > 0;
  const history = duePaymentHistory(item); const latest = latestDuePayment(item);
  const via = (payment: DuePayment) => { if (!payment.transactionId) return "Not in ledger"; const transaction = transactionsById.get(payment.transactionId); return transaction ? accountLabelOf(transaction) : "Removed from ledger"; };
  const togglePanel = (next: "settle" | "remind") => { setError(null); setPanel((current) => current === next ? null : next); };
  const completeOnly = async () => { setBusy(true); try { setError(null); await onComplete(item.id, false); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not complete this item."); } finally { setBusy(false); } };
  // Deleting a loan also removes the loan movements it wrote (the lend/borrow and loan repayments), so balances move back; say so first.
  const removesEntries = isDebt && (Boolean(opening) || item.payments.some((payment) => payment.transactionId && transactionsById.get(payment.transactionId)?.category === LOAN_CATEGORY_ID));
  const remove = async () => { if (!window.confirm(`Delete “${item.title}” and its repayment history?${removesEntries ? " Its loan entries in the ledger are removed too, so account balances change back." : ""}`)) return; setBusy(true); try { setError(null); await onDelete(item.id); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete this item."); } finally { setBusy(false); } };
  const undo = async (payment: DuePayment) => {
    if (!window.confirm(`Undo the ${isDebt ? "repayment" : "payment"} recorded on ${formatLedgerDate(payment.occurredOn, calendarSystem)}?${payment.transactionId ? " Its ledger entry is removed too." : ""}${item.status === "completed" ? " This due opens again." : ""}`)) return;
    setBusy(true); try { setError(null); await onUndoPayment(payment.id); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not undo this repayment."); } finally { setBusy(false); }
  };
  return <article id={`due-${item.id}`} tabIndex={-1} className={`due-card ${item.status} ${overdue ? "overdue" : ""} ${focused ? "focused" : ""}`}>
    <div className={`due-card-icon ${item.kind}`}>{isDebt ? <HandCoins size={23} weight="duotone" /> : <CalendarBlank size={23} weight="duotone" />}</div>
    <div className="due-card-main"><div className="due-card-heading"><div><span>{item.kind === "receivable" ? "To receive" : item.kind === "payment" ? "To pay" : item.kind}</span><h2>{item.title}</h2>{item.person && <small><User size={12} />{item.person}</small>}</div><div><strong>{formatMoney(item.status === "completed" ? item.amountMinor : remaining, currency)}</strong><small>{item.status === "completed" ? `Settled ${item.completedOn ? formatLedgerDate(item.completedOn, calendarSystem) : ""}` : dueDateLabel(item.dueOn, parseISO(today()), calendarSystem)}</small></div></div>
      <div className="due-meta">{isDebt ? <>{item.occurredOn && <span><CalendarBlank size={14} />{item.kind === "lent" ? "Lent" : "Borrowed"} {shortDueDate(item.occurredOn, calendarSystem)}</span>}{opening && <span><Wallet size={14} />{item.kind === "lent" ? "From" : "Into"} {accountLabelOf(opening)}</span>}</> : <span><Wallet size={14} />{getCategory(item.category, customCategories).label}</span>}{paid > 0 && item.status === "open" && <span><span className="amount">{formatMoney(paid, currency)}</span> repaid</span>}{item.remindOn && item.status === "open" && <span>Reminder {shortDueDate(item.remindOn, calendarSystem)}</span>}</div>
      {item.note && <p>{item.note}</p>}
      {item.receipt && <a className="receipt-link" href={`/api/receipts/${item.receipt.id}`} target="_blank" rel="noreferrer"><Paperclip size={14} />{item.receipt.name}<ArrowSquareOut size={13} /></a>}
      {item.status === "open" && <div className="due-actions"><button type="button" className="primary-button small" disabled={busy} aria-expanded={panel === "settle"} onClick={() => togglePanel("settle")}>{isDebt ? <HandCoins size={16} /> : <Check size={16} />}{isDebt ? "Record repayment" : item.kind === "payment" ? "Mark paid" : "Mark received"}</button>{!isDebt && <button type="button" className="secondary-button small" disabled={busy} onClick={() => void completeOnly()} title="Settle it without adding anything to the ledger">{busy && panel !== "settle" ? <ButtonSpinner /> : null}Complete only</button>}{canRemind && <button type="button" className="secondary-button small" disabled={busy} aria-expanded={panel === "remind"} onClick={() => togglePanel("remind")}><ChatCircleText size={16} />{item.person.trim() ? `Remind ${item.person.trim()}` : "Send a reminder"}</button>}<button type="button" className="icon-button" disabled={busy} onClick={onEdit} aria-label={`Edit ${item.title}`}><PencilSimple size={16} /></button><button type="button" className="icon-button danger" disabled={busy} onClick={() => void remove()} aria-label={`Delete ${item.title}`}><Trash size={16} /></button></div>}
      {panel === "settle" && item.status === "open" && <SettleForm item={item} currency={currency} calendarSystem={calendarSystem} accountOptions={accountOptions} defaultAccount={opening ? movementAccountOf(opening) : "cash"} onRecordPayment={onRecordPayment} onComplete={onComplete} onDone={() => setPanel(null)} />}
      {panel === "remind" && canRemind && <ReminderPanel item={item} currency={currency} calendarSystem={calendarSystem} />}
      {history.length > 0 && <div className="due-history">
        <button type="button" className="text-button due-history-toggle" aria-expanded={showHistory} onClick={() => setShowHistory((value) => !value)}><CaretDown size={14} aria-hidden />History · {history.length} {history.length === 1 ? "payment" : "payments"}</button>
        {showHistory && <ol className="due-history-list">{history.map((payment) => <li key={payment.id}><div><strong className="amount">{formatMoney(payment.amountMinor, currency)}</strong><small>{[formatLedgerDate(payment.occurredOn, calendarSystem), via(payment), payment.note.trim()].filter(Boolean).join(" · ")}</small></div>{payment.id === latest?.id && <button type="button" className="text-button due-history-undo" disabled={busy} aria-label={`Undo the ${isDebt ? "repayment" : "payment"} of ${formatLedgerDate(payment.occurredOn, calendarSystem)}`} onClick={() => void undo(payment)}><ArrowCounterClockwise size={14} />Undo</button>}</li>)}</ol>}
      </div>}
      <FormError message={error} />
    </div>
  </article>;
}

/** Records a repayment on a loan, or confirms a bill was paid or income received, with the real amount, date and account. */
function SettleForm({ item, currency, calendarSystem, accountOptions, defaultAccount, onRecordPayment, onComplete, onDone }: { item: DueItem; currency: CurrencyCode; calendarSystem: CalendarSystem; accountOptions: AccountOption[]; defaultAccount: string; onRecordPayment: Props["onRecordPayment"]; onComplete: Props["onComplete"]; onDone: () => void }) {
  const debt = isDebtKind(item.kind); const remaining = dueRemaining(item); const incoming = item.kind === "lent" || item.kind === "receivable";
  const [clientRequestId] = useState(newClientRequestId);
  const [amount, setAmount] = useState<string | number>(remaining / 100); const [date, setDate] = useState(today()); const [note, setNote] = useState("");
  const [account, setAccount] = useState(accountOptions.some((option) => option.value === defaultAccount) ? defaultAccount : "cash");
  const [addToLedger, setAddToLedger] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const amountMinor = majorToMinor(String(amount ?? ""));
  const newTotal = duePaid(item) + amountMinor;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    const options = { paymentAccountId: addToLedger && account !== "cash" ? account : null, clientRequestId };
    try {
      if (debt) await onRecordPayment(item.id, String(amount), date, note, addToLedger, options);
      else await onComplete(item.id, true, { ...options, amount: String(amount), occurredOn: date });
      onDone();
    } catch (caught) { setError(caught instanceof Error ? caught.message : debt ? "Could not record this repayment." : "Could not settle this item."); } finally { setBusy(false); }
  };
  return <form className="repayment-form due-settle-form" onSubmit={submit} aria-busy={busy}>
    <NumberInput label={debt ? "Amount" : item.kind === "payment" ? "Amount paid" : "Amount received"} leftSection={currency} leftSectionWidth={52} value={amount} onChange={setAmount} min={0.01} max={debt ? remaining / 100 : undefined} decimalScale={2} thousandSeparator="," required />
    <DatePickerInput label="Date" description={bsHint(date, calendarSystem)} value={date} onChange={(value) => value && setDate(value)} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />
    <Select label={incoming ? "Received via" : "Paid via"} value={account} onChange={(value) => value && setAccount(value)} data={accountOptions} allowDeselect={false} disabled={!addToLedger} />
    {debt && <TextInput label="Note" value={note} onChange={(event) => setNote(event.currentTarget.value)} placeholder="Optional" maxLength={240} />}
    {debt && <label className="ledger-checkbox"><input type="checkbox" checked={addToLedger} onChange={(event) => setAddToLedger(event.currentTarget.checked)} /><span>Add this movement to the ledger (a loan repayment, not {incoming ? "income" : "spending"})</span></label>}
    {!debt && amountMinor > 0 && amountMinor !== remaining && <p className="field-hint due-settle-hint">The total of this {item.kind === "payment" ? "bill" : "item"} changes to <span className="amount">{formatMoney(newTotal, currency)}</span>.</p>}
    <FormError message={error} />
    <div className="due-settle-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onDone}>Cancel</button><button className="primary-button" disabled={busy || amountMinor <= 0}>{busy ? <><ButtonSpinner />Saving…</> : debt ? "Record repayment" : item.kind === "payment" ? "Confirm paid" : "Confirm received"}</button></div>
  </form>;
}

/** A ready-to-send "you owe me" nudge: the phone's share sheet where there is one, otherwise chat-app links and copy. */
function ReminderPanel({ item, currency, calendarSystem }: { item: DueItem; currency: CurrencyCode; calendarSystem: CalendarSystem }) {
  const [language, setLanguage] = useState<ReminderLanguage>(readReminderLanguage);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const text = buildDueReminderMessage({ due: item, currency, calendarSystem, language, today: today() });
  const links = reminderShareLinks(text);
  const canShare = typeof navigator.share === "function";
  const person = item.person.trim();
  useEffect(() => { if (copied === "idle") return; const timer = window.setTimeout(() => setCopied("idle"), 2200); return () => window.clearTimeout(timer); }, [copied]);
  const changeLanguage = (value: string) => { const next: ReminderLanguage = value === "ne" ? "ne" : "en"; setLanguage(next); try { window.localStorage.setItem(REMINDER_LANGUAGE_KEY, next); } catch { /* storage blocked */ } };
  const share = async () => { try { await navigator.share({ text }); } catch { /* the share sheet was closed */ } };
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied("copied"); } catch { setCopied("failed"); } };
  return <div className="due-remind-panel">
    <div className="due-remind-heading"><span id={`remind-${item.id}`}>Message{person ? ` to ${person}` : ""}</span><SegmentedControl size="xs" value={language} onChange={changeLanguage} data={[{ value: "en", label: "English" }, { value: "ne", label: "Nepali" }]} aria-label="Message language" /></div>
    <p className="due-remind-preview" tabIndex={0} aria-labelledby={`remind-${item.id}`}>{text}</p>
    <div className="due-remind-actions">
      {canShare ? <button type="button" className="primary-button small" onClick={() => void share()}><ShareNetwork size={16} />Share</button> : <>
        <a className="secondary-button small" href={links.whatsapp} target="_blank" rel="noreferrer"><WhatsappLogo size={16} />WhatsApp</a>
        <a className="secondary-button small" href={links.viber}><ChatCircleText size={16} />Viber</a>
        <a className="secondary-button small" href={links.sms}><ChatText size={16} />SMS</a>
      </>}
      <button type="button" className="secondary-button small" onClick={() => void copy()}>{copied === "copied" ? <Check size={16} /> : <Copy size={16} />}{copied === "copied" ? "Copied" : copied === "failed" ? "Could not copy" : "Copy"}</button>
    </div>
  </div>;
}
