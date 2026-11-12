import { ArrowCounterClockwise, ArrowDownLeft, ArrowSquareOut, ArrowUpRight, Bell, CalendarBlank, CaretDown, ChatCircleText, ChatText, Check, Copy, DotsThree, HandCoins, LinkSimple, LockSimple, Paperclip, PencilSimple, Plus, Receipt, ShareNetwork, Trash, User, Wallet, WhatsappLogo, X } from "@phosphor-icons/react";
import { Autocomplete, Menu, NumberInput, SegmentedControl, Select, TextInput, Textarea } from "@mantine/core";
import { addDays, format, parseISO } from "date-fns";
import { formatLedgerDate, formatLedgerMonth, todayInput } from "../lib/dates";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { plainAmount } from "../lib/entry-labels";
import { LedgerDatePickerInput as DatePickerInput } from "../components/LedgerDatePickerInput";
import { getCategory, LOAN_CATEGORY_ID, spendingCategoriesFor } from "../lib/categories";
import { formatMoney, majorToMinor } from "../lib/currency";
import { buildDebtPlan, isPlannableDebt, suggestedPayoffBudgetMinor, type PayoffStrategy } from "../lib/debt-planner";
import { buildDueReminderMessage, reminderShareLinks, type ReminderLanguage } from "../lib/due-reminder-message";
import { dueCategoryForKind, dueDateLabel, dueDirection, dueKindForTab, dueOpeningMovementsByDue, duePaid, duePaymentHistory, dueRemaining, isDebtKind, latestDuePayment, shortDueDate } from "../lib/dues";
import { onlinePaymentAccounts, paymentAccountLabel } from "../lib/payment-accounts";
import { discardReceipt, uploadReceipt } from "../lib/receipts";
import { personSuggestions } from "../lib/split-bill";
import { newClientRequestId } from "../lib/transaction-defaults";
import type { DueSettlementOptions } from "../context/LedgerContext";
import type { CalendarSystem, CurrencyCode, CustomCategory, DueDraft, DueItem, DueKind, DuePayment, LedgerTransaction, PaymentAccount, ReceiptUpload } from "../types";
import { FormError } from "../components/FormError";
import { LinkedEntryPicker } from "../components/LinkedEntryPicker";
import { linkMakesLoan, loanKindFor, openingLinkCandidates, settlementLinkCandidates, type LinkCandidate } from "../lib/due-links";

type DuesTab = "upcoming" | "lent" | "borrowed" | "settled";
type AccountOption = { value: string; label: string };
/** The picker value that points a due at an entry already in the ledger instead of writing one. */
const LINK = "link";
const tabLabels: Record<DuesTab, string> = { upcoming: "Upcoming", lent: "Lent", borrowed: "Borrowed", settled: "Settled" };
const KIND_TONES: Record<DueKind, { bg: string; ink: string }> = {
  payment: { bg: "#fde5d4", ink: "#b4531f" },
  receivable: { bg: "#d6f0df", ink: "#1f7a45" },
  lent: { bg: "#dfe6fb", ink: "#3446a8" },
  borrowed: { bg: "#ece2f8", ink: "#5c2d91" },
};
const kindTileStyle = (kind: DueKind, size = 42) => ({ "--tile-bg": KIND_TONES[kind].bg, "--tile-ink": KIND_TONES[kind].ink, "--tile-size": `${size}px` } as CSSProperties);
const LINK_OPTION: AccountOption = { value: LINK, label: "An entry already in my ledger" };
/** What a due's link reads from the ledger: the entries to offer and who you are, so only your own entries are offered. */
interface LinkContext { transactions: LedgerTransaction[]; dues: DueItem[]; ownerId?: string; customCategories: CustomCategory[] }
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
  const options: { id: DueKind; label: string }[] = [{ id: "payment", label: "I pay" }, { id: "receivable", label: "I receive" }, { id: "lent", label: "I lent" }, { id: "borrowed", label: "I borrowed" }];
  return <div className="v2-seg v2-due-kinds" role="radiogroup" aria-label="Due type">{options.map((option) => <button key={option.id} type="button" role="radio" aria-checked={value === option.id} className={value === option.id ? `active is-${option.id}` : undefined} disabled={disabled} onClick={() => onChange(option.id)}>{option.label}</button>)}</div>;
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
  /** You, so only your own entries are offered for linking. */
  ownerId?: string;
  /** An entry to start a Lent or Borrowed due from ("this is the money I lent"), opened once per link. */
  startFromTransactionId?: string | null;
}

export function DuesPage({ currency, items, customCategories, transactions, paymentAccounts, calendarSystem, onSave, onDelete, onRecordPayment, onComplete, onUndoPayment, onSplitBill, focusedId, focusedAction, ownerId, startFromTransactionId }: Props) {
  const [tab, setTab] = useState<DuesTab>("upcoming");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DueItem | null>(null);
  const [newKind, setNewKind] = useState<DueKind>("payment");
  const [fromTransaction, setFromTransaction] = useState<LedgerTransaction | null>(null);
  const linkContext = useMemo<LinkContext>(() => ({ transactions, dues: items, ownerId, customCategories }), [transactions, items, ownerId, customCategories]);
  const accountOptions = useMemo<AccountOption[]>(() => [{ value: "cash", label: "Cash" }, ...onlinePaymentAccounts(paymentAccounts).map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))], [paymentAccounts]);
  const openings = useMemo(() => dueOpeningMovementsByDue(transactions), [transactions]);
  const transactionsById = useMemo(() => new Map(transactions.map((transaction) => [transaction.id, transaction])), [transactions]);
  const people = useMemo(() => personSuggestions(items), [items]);
  const addDue = () => { setEditing(null); setFromTransaction(null); setNewKind(dueKindForTab(tab)); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditing(null); setFromTransaction(null); };
  // "Mark as lent" on a ledger entry opens a new loan already linked to it, once per link, on the loan's own tab.
  const handledStart = useRef<string | null>(null);
  useEffect(() => {
    if (!startFromTransactionId || handledStart.current === startFromTransactionId) return;
    const transaction = transactionsById.get(startFromTransactionId);
    if (!transaction) return;
    handledStart.current = startFromTransactionId;
    const kind = loanKindFor(transaction);
    setTab(kind); setEditing(null); setNewKind(kind); setFromTransaction(transaction); setShowForm(true);
  }, [startFromTransactionId, transactionsById]);
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
  const tabCount = (value: DuesTab) => items.filter((item) => value === "settled" ? item.status === "completed" : item.status === "open" && (value === "upcoming" ? !isDebtKind(item.kind) : item.kind === value)).length;
  const toggleForm = () => showForm && !editing && newKind === dueKindForTab(tab) ? closeForm() : addDue();
  return <div className="v2-page v2-dues">
    <header className="v2-page-head">
      <div><span className="v2-eyebrow">Promises your money keeps</span><h1>Dues</h1></div>
      <div className="v2-head-actions"><button type="button" className="v2-button is-primary is-compact" aria-expanded={showForm} onClick={toggleForm}><Plus size={17} weight="bold" /><span>Add due</span></button></div>
    </header>
    <section className="v2-hero v2-dues-hero" aria-label="Open dues">
      <span className="v2-hero-label">{openSummary.openCount ? `${openSummary.openCount} open ${openSummary.openCount === 1 ? "item" : "items"}` : "All square"}</span>
      <div className="v2-dues-hero-pair">
        <span><small><ArrowDownLeft size={14} weight="bold" />Coming to you</small><strong className="amount">{formatMoney(openSummary.toReceive, currency)}</strong></span>
        <span><small><ArrowUpRight size={14} weight="bold" />You owe</small><strong className="amount">{formatMoney(openSummary.toPay, currency)}</strong></span>
      </div>
      <span className="v2-hero-pill">{openSummary.toReceive === openSummary.toPay ? "Hisab barabar. Even." : openSummary.toReceive > openSummary.toPay ? `${formatMoney(openSummary.toReceive - openSummary.toPay, currency)} more coming in than going out` : `${formatMoney(openSummary.toPay - openSummary.toReceive, currency)} more going out than coming in`}</span>
    </section>
    <div className="v2-seg v2-dues-tabs" role="tablist" aria-label="Due sections">
      {(["upcoming", "lent", "borrowed", "settled"] as DuesTab[]).map((value) => { const count = tabCount(value); return <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "active" : undefined} onClick={() => setTab(value)}><span>{tabLabels[value]}</span>{count > 0 && value !== "settled" && <span className="v2-dues-count">{count}</span>}</button>; })}
    </div>
    <div className={`v2-plan-grid v2-dues-grid${showForm ? " has-form" : ""}`}>
      <div className="v2-plan-main">
        {tab === "borrowed" && items.some(isPlannableDebt) && <DebtPayoffPlan items={items} currency={currency} calendarSystem={calendarSystem} />}
        {tab === "lent" && onSplitBill && filtered.length > 0 && <div className="v2-dues-split"><span className="v2-tile" style={kindTileStyle("lent", 38)} aria-hidden="true"><Receipt size={20} weight="duotone" /></span><p>Paid for friends? Split it and each person gets a Lent due.</p><button type="button" className="v2-button is-small" onClick={onSplitBill}>Split a bill</button></div>}
        {filtered.length > 0 && <div className="v2-dues-list">{filtered.map((item) => <DueCard key={item.id} item={item} currency={currency} customCategories={customCategories} calendarSystem={calendarSystem} accountOptions={accountOptions} opening={openings.get(item.id)} transactionsById={transactionsById} linkContext={linkContext} focused={item.id === focusedId} startRepayment={item.id === focusedId && focusedAction === "repay"} onEdit={() => { setEditing(item); setShowForm(true); }} onDelete={onDelete} onRecordPayment={onRecordPayment} onComplete={onComplete} onUndoPayment={onUndoPayment} />)}</div>}
        {!filtered.length && <section className="v2-card v2-dues-empty"><span className="v2-tile" style={kindTileStyle(tab === "settled" ? "receivable" : dueKindForTab(tab), 48)} aria-hidden="true">{tab === "lent" || tab === "borrowed" ? <HandCoins size={26} weight="duotone" /> : tab === "settled" ? <Check size={26} weight="bold" /> : <CalendarBlank size={26} weight="duotone" />}</span><strong>{emptyCopy[tab].title}</strong><p>{emptyCopy[tab].message}</p>{emptyCopy[tab].action && <div className="v2-form-actions"><button type="button" className="v2-button is-primary" onClick={addDue}><Plus size={16} weight="bold" />{emptyCopy[tab].action}</button>{tab === "lent" && onSplitBill && <button type="button" className="v2-button" onClick={onSplitBill}><Receipt size={16} />Split a bill</button>}</div>}</section>}
      </div>
      {showForm && <aside className="v2-plan-side"><DueForm key={editing?.id ?? `new-${newKind}-${fromTransaction?.id ?? ""}`} item={editing} initialKind={newKind} fromTransaction={fromTransaction} linkContext={linkContext} currency={currency} customCategories={customCategories} calendarSystem={calendarSystem} accountOptions={accountOptions} opening={editing ? openings.get(editing.id) : undefined} people={people} onSave={async (draft) => { await onSave(draft, editing?.id); closeForm(); }} onCancel={closeForm} /></aside>}
    </div>
  </div>;
}

/** A starting budget that always produces a real plan: a tenth of the balance, never less than the interest it has to outrun. */
function DebtPayoffPlan({ items, currency, calendarSystem }: { items: DueItem[]; currency: CurrencyCode; calendarSystem: CalendarSystem }) {
  const debts = useMemo(() => items.filter(isPlannableDebt), [items]);
  const monthLabel = (date: string) => calendarSystem === "BS" ? formatLedgerMonth(parseISO(date), "BS") : format(parseISO(date), "MMM yyyy");
  const hasInterest = debts.some((item) => (item.annualRatePercent ?? 0) > 0);
  const [strategy, setStrategy] = useState<PayoffStrategy>("snowball");
  const [budget, setBudget] = useState<string | number>(() => suggestedPayoffBudgetMinor(debts) / 100);
  // With every rate blank, avalanche is a meaningless tie — it is hidden, so never plan with it either.
  const activeStrategy = strategy === "avalanche" && !hasInterest ? "snowball" : strategy;
  const budgetMinor = Math.max(0, Math.round(Number(budget || 0) * 100));
  const plan = useMemo(() => buildDebtPlan(debts, budgetMinor, activeStrategy, today()), [debts, budgetMinor, activeStrategy]);
  const strategies = (["snowball", "avalanche", "dueDate"] as PayoffStrategy[]).filter((value) => value !== "avalanche" || hasInterest);
  return <section className="v2-card v2-payoff" aria-labelledby="payoff-heading">
    <header className="v2-card-head"><h2 id="payoff-heading">Get debt free</h2><span className="v2-muted"><strong className="amount">{formatMoney(plan.totalRemainingMinor, currency)}</strong> owed</span></header>
    <div className="v2-form-pair v2-payoff-controls">
      <Select label="Pay off" value={activeStrategy} onChange={(value) => value && setStrategy(value as PayoffStrategy)} data={strategies.map((value) => ({ value, label: strategyLabels[value] }))} allowDeselect={false} />
      <NumberInput label="Each month" leftSection={currency} leftSectionWidth={58} value={budget} onChange={setBudget} min={0} decimalScale={2} thousandSeparator="," description="All you can put towards these debts." />
    </div>
    {plan.impossible
      ? <p className="v2-payoff-warning"><HandCoins size={17} weight="duotone" />That budget doesn’t cover the interest, so the balance never falls. You need more than <strong className="amount">{formatMoney(plan.minimumMonthlyMinor, currency)}</strong> a month for a payoff date.</p>
      : <div className="v2-payoff-headline"><span><small>Debt free by</small><strong>{plan.debtFreeOn ? monthLabel(plan.debtFreeOn) : "—"}</strong><small>{plan.monthsToDebtFree} {plan.monthsToDebtFree === 1 ? "month" : "months"} from today</small></span><span><small>Interest you pay</small><strong className="amount">{formatMoney(plan.totalInterestMinor, currency)}</strong><small>{hasInterest ? <><span className="amount">{formatMoney(plan.minimumMonthlyMinor, currency)}</span> accruing this month</> : "No interest on these"}</small></span></div>}
    <ol className="v2-rows v2-payoff-list">{plan.entries.map((entry) => <li key={entry.item.id} className="v2-row">
      <span className="v2-payoff-order">{entry.order + 1}</span>
      <span className="v2-row-main"><strong>{entry.item.title}</strong><small>{[entry.item.person, entry.item.annualRatePercent ? `${entry.item.annualRatePercent}% a year` : "No interest"].filter(Boolean).join(" · ")}</small></span>
      <span className="v2-row-end"><strong className="amount">{plainAmount(entry.remainingMinor)}</strong><small className="v2-muted">{entry.projectedClearedOn ? `Clear by ${monthLabel(entry.projectedClearedOn)}` : "Not at this budget"}</small></span>
    </li>)}</ol>
  </section>;
}

function DueForm({ item, initialKind, fromTransaction, linkContext, currency, customCategories, calendarSystem, accountOptions, opening, people, onSave, onCancel }: { item: DueItem | null; initialKind: DueKind; fromTransaction?: LedgerTransaction | null; linkContext: LinkContext; currency: CurrencyCode; customCategories: CustomCategory[]; calendarSystem: CalendarSystem; accountOptions: AccountOption[]; opening?: LedgerTransaction; people: string[]; onSave: (draft: DueDraft) => Promise<void>; onCancel: () => void }) {
  const entryTitle = (transaction: LedgerTransaction) => transaction.note.trim() || getCategory(transaction.category, customCategories).label;
  const [kind, setKind] = useState<DueKind>(item?.kind ?? initialKind); const [title, setTitle] = useState(item?.title ?? (fromTransaction ? entryTitle(fromTransaction).slice(0, 100) : "")); const [person, setPerson] = useState(item?.person ?? ""); const [amount, setAmount] = useState<string | number>(item ? item.amountMinor / 100 : fromTransaction ? fromTransaction.amountMinor / 100 : "");
  const [category, setCategory] = useState(() => item?.category ?? dueCategoryForKind(initialKind, "other", customCategories)); const [occurredOn, setOccurredOn] = useState(item?.occurredOn ?? fromTransaction?.occurredOn ?? today()); const [dueOn, setDueOn] = useState(item?.dueOn ?? dueDefault()); const [remindOn, setRemindOn] = useState(item ? item.remindOn ?? "" : reminderDefault()); const [note, setNote] = useState(item?.note ?? ""); const [annualRate, setAnnualRate] = useState<string | number>(item?.annualRatePercent ?? ""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  // Where lent money left from or borrowed money arrived in, or the entry already in the ledger that it was.
  // An edited loan without a recorded movement starts at "none" so saving never records it twice.
  const initialMovement = item ? item.linkedTransactionId ? LINK : opening ? movementAccountOf(opening) : "none" : fromTransaction ? LINK : "cash";
  const [movement, setMovement] = useState(initialMovement);
  const [linkId, setLinkId] = useState<string | null>(item?.linkedTransactionId ?? fromTransaction?.id ?? null);
  const [receipt, setReceipt] = useState<ReceiptUpload | undefined>();
  const [receiptUploading, setReceiptUploading] = useState(false);
  const debt = isDebtKind(kind);
  const categories = spendingCategoriesFor(dueDirection(kind), customCategories);
  const movementOptions = [...accountOptions, ...(accountOptions.some((option) => option.value === initialMovement) || initialMovement === "none" || initialMovement === LINK ? [] : [{ value: initialMovement, label: "Current account" }]), LINK_OPTION, { value: "none", label: "Don't record a movement" }];
  const linking = debt && movement === LINK;
  const candidates = useMemo(() => openingLinkCandidates({ kind, transactions: linkContext.transactions, dues: linkContext.dues, dueId: item?.id, userId: linkContext.ownerId, nearDate: occurredOn }), [kind, linkContext, item?.id, occurredOn]);
  const linked = linking ? candidates.find((candidate) => candidate.transaction.id === linkId) : undefined;
  const changeKind = (value: string) => { const next = value as DueKind; setKind(next); setCategory((current) => dueCategoryForKind(next, current, customCategories)); if (next !== kind) setLinkId(null); };
  // Picking the entry fills in what it already knows: how much (what is left of it), when, and what for.
  const pickEntry = (candidate: LinkCandidate<LedgerTransaction> | null) => {
    setLinkId(candidate?.transaction.id ?? null);
    if (!candidate) return;
    setOccurredOn(candidate.transaction.occurredOn);
    if (!item) setAmount(candidate.availableMinor / 100);
    if (!title.trim()) setTitle(entryTitle(candidate.transaction).slice(0, 100));
  };
  const linkChanged = linking && linkId !== (item?.linkedTransactionId ?? null);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (receiptUploading || (linking && !linkId)) return; setSaving(true); try { setError(null); await onSave({ kind, title, person, amount: String(amount), category: debt ? LOAN_CATEGORY_ID : category, occurredOn: debt ? occurredOn : "", dueOn, remindOn, note, annualRatePercent: String(annualRate ?? ""), receipt, movement: debt && (!item || movement !== initialMovement || linkChanged) ? movement : undefined, linkTransactionId: linking ? linkId ?? undefined : undefined }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save this due."); } finally { setSaving(false); } };
  const cancel = () => { if (receiptUploading) return; if (receipt) void discardReceipt(receipt); onCancel(); };
  return <section className={`v2-card v2-plan-form v2-due-form${item ? " is-editing" : ""}`} aria-labelledby="due-form-heading"><header className="v2-card-head"><h2 id="due-form-heading">{item ? "Edit due" : "Add a due"}</h2><button type="button" className="v2-icon-btn is-quiet" onClick={cancel} disabled={saving || receiptUploading} aria-label="Close the form"><X size={18} weight="bold" /></button></header><form className="v2-form" onSubmit={submit} aria-busy={saving || receiptUploading}>
    <DueKindToggle value={kind} onChange={changeKind} disabled={Boolean(item?.payments.length)} />
    <TextInput label={labels[kind].title} value={title} onChange={(event) => setTitle(event.currentTarget.value)} required maxLength={100} />
    {debt && <Autocomplete label="Person" leftSection={<User size={15} />} value={person} onChange={setPerson} data={people} limit={6} required maxLength={80} />}
    <NumberInput label={labels[kind].amount} leftSection={currency} leftSectionWidth={58} value={amount} onChange={setAmount} min={0.01} decimalScale={2} thousandSeparator="," required />
    {debt
      ? <TextInput label="Ledger category" leftSection={<LockSimple size={15} aria-hidden />} value={getCategory(LOAN_CATEGORY_ID).label} readOnly description="Loans move your balances but never count as income or spending." />
      : <Select label="Ledger category" value={category} onChange={(value) => value && setCategory(value)} data={categories.map((item) => ({ value: item.id, label: item.label }))} allowDeselect={false} searchable />}
    {debt && <DatePickerInput label="Date money changed hands" description={bsHint(occurredOn, calendarSystem)} value={occurredOn} onChange={(value) => value && setOccurredOn(value)} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />}
    {debt && <Select label={kind === "lent" ? "Money left from" : "Money arrived in"} value={movement} onChange={(value) => value && setMovement(value)} data={movementOptions} allowDeselect={false} description={movement === "none" ? "Nothing is added to your ledger, for example when a split bill already recorded it." : linking ? "Point this loan at the entry you already recorded, so it is never counted twice." : kind === "lent" ? "Recorded as a loan on that date, never as spending." : "Recorded as a loan on that date, never as income."} />}
    {linking && <LinkedEntryPicker label={kind === "lent" ? "The money you lent" : "The money you borrowed"} description={<OpeningLinkHint kind={kind} candidate={linked} amountMinor={majorToMinor(String(amount ?? ""))} currency={currency} customCategories={customCategories} />} candidates={candidates} value={linkId} onChange={pickEntry} currency={currency} calendarSystem={calendarSystem} customCategories={customCategories} />}
    <DatePickerInput label="Due date" description={bsHint(dueOn, calendarSystem)} value={dueOn} onChange={(value) => value && setDueOn(value)} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />
    <DatePickerInput label="Remind me on" description={bsHint(remindOn, calendarSystem) ?? "The bell will show this item from this date."} value={remindOn || null} onChange={(value) => setRemindOn(value ?? "")} valueFormat="MMM D, YYYY" firstDayOfWeek={0} maxDate={dueOn || undefined} clearable />
    {debt && <NumberInput label="Interest rate" value={annualRate} onChange={setAnnualRate} min={0} max={200} decimalScale={2} suffix="% a year" description="Leave blank when no interest is charged. Used to order your payoff plan." />}
    <Textarea label="Note" value={note} onChange={(event) => setNote(event.currentTarget.value)} maxLength={300} autosize minRows={2} />
    <div className="receipt-field v2-due-receipt" aria-busy={receiptUploading}><label className={receiptUploading ? "uploading" : undefined}>{receiptUploading ? <ButtonSpinner /> : <Paperclip size={17} />}<span>{receiptUploading ? "Uploading receipt…" : receipt?.name ?? "Attach receipt or document"}</span><input type="file" disabled={receiptUploading} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={async (event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return; setError(null); setReceiptUploading(true); try { const value = await uploadReceipt(file); if (receipt) void discardReceipt(receipt); setReceipt(value); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not attach this file."); } finally { setReceiptUploading(false); } }} /></label>{receipt && <button type="button" className="text-button danger-text" disabled={receiptUploading} onClick={() => { void discardReceipt(receipt); setReceipt(undefined); }}>Remove</button>}</div>
    <p className="v2-muted v2-due-file-hint">Photo or PDF, up to 3 MB.</p>
    <FormError message={error} />
    <div className="v2-form-actions"><button type="button" className="v2-button" onClick={cancel} disabled={saving || receiptUploading}>Cancel</button><button className="v2-button is-primary" disabled={saving || receiptUploading || !title.trim() || !amount || !dueOn || (linking && !linkId)}>{saving ? <><ButtonSpinner />Saving…</> : receiptUploading ? <><ButtonSpinner />Uploading receipt…</> : <><Check size={16} weight="bold" />{item ? "Update due" : "Save due"}</>}</button></div>
  </form></section>;
}

/** What linking does to the chosen entry: a whole entry becomes the loan; part of one keeps its category for the rest. */
function OpeningLinkHint({ kind, candidate, amountMinor, currency, customCategories }: { kind: DueKind; candidate?: LinkCandidate<LedgerTransaction>; amountMinor: number; currency: CurrencyCode; customCategories: CustomCategory[] }) {
  if (!candidate) return <>{kind === "lent" ? "Money that went out" : "Money that came in"}, nearest the loan's date first.</>;
  const { transaction, availableMinor } = candidate;
  if (amountMinor > availableMinor) return <span className="danger-text">Only <span className="amount">{formatMoney(availableMinor, currency)}</span> of this entry is left once its other dues are counted.</span>;
  if (linkMakesLoan(kind, amountMinor, transaction)) return <>The whole entry becomes this loan, so it stops counting as {kind === "lent" ? "spending" : "income"}. Unlinking gives its category back.</>;
  if (transaction.category === LOAN_CATEGORY_ID) return <>This entry is already a loan movement.</>;
  return <>Only part of this entry is the loan, so it stays as {getCategory(transaction.category, customCategories).label}.</>;
}

// The picker value for where a movement went: Cash for cash entries and anything booked to Cash in hand, which the pickers offer as Cash.
const movementAccountOf = (transaction: LedgerTransaction) => transaction.paymentAccountId && transaction.paymentAccount?.type !== "cash" ? transaction.paymentAccountId : "cash";
const accountLabelOf = (transaction: LedgerTransaction) => transaction.paymentAccount ? paymentAccountLabel(transaction.paymentAccount) : transaction.paymentAccountId ? "Removed account" : "Cash";

function DueCard({ item, currency, customCategories, calendarSystem, accountOptions, opening, transactionsById, linkContext, focused, startRepayment, onEdit, onDelete, onRecordPayment, onComplete, onUndoPayment }: { item: DueItem; currency: CurrencyCode; customCategories: CustomCategory[]; calendarSystem: CalendarSystem; accountOptions: AccountOption[]; opening?: LedgerTransaction; transactionsById: Map<string, LedgerTransaction>; linkContext: LinkContext; focused: boolean; startRepayment: boolean; onEdit: () => void; onDelete: (id: string) => Promise<void>; onRecordPayment: Props["onRecordPayment"]; onComplete: Props["onComplete"]; onUndoPayment: Props["onUndoPayment"] }) {
  const [panel, setPanel] = useState<"settle" | "remind" | null>(startRepayment && item.status === "open" ? "settle" : null); const [showHistory, setShowHistory] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  // A bell tap while this card is already on screen asks for the confirm step too, once per tap (an Undo that reopens the due does not).
  const repayAsked = useRef(startRepayment);
  useEffect(() => { if (startRepayment && !repayAsked.current && item.status === "open") setPanel("settle"); repayAsked.current = startRepayment; }, [startRepayment, item.status]);
  const isDebt = isDebtKind(item.kind); const remaining = dueRemaining(item); const paid = duePaid(item); const overdue = item.status === "open" && item.dueOn < today();
  const canRemind = item.status === "open" && (item.kind === "lent" || item.kind === "receivable") && remaining > 0;
  const history = duePaymentHistory(item); const latest = latestDuePayment(item);
  const entryTitle = (transaction: LedgerTransaction) => transaction.note.trim() || getCategory(transaction.category, customCategories).label;
  const via = (payment: DuePayment) => { if (!payment.transactionId) return "Not in ledger"; const transaction = transactionsById.get(payment.transactionId); return transaction ? payment.linked ? `Linked · ${entryTitle(transaction)}` : accountLabelOf(transaction) : "Removed from ledger"; };
  // The entry already in the ledger that this loan points at, standing in for a movement the due wrote itself.
  const linkedEntry = item.linkedTransactionId ? transactionsById.get(item.linkedTransactionId) : undefined;
  const moneyEntry = opening ?? linkedEntry;
  const keepsLinked = Boolean(item.linkedTransactionId) || item.payments.some((payment) => payment.linked);
  const togglePanel = (next: "settle" | "remind") => { setError(null); setPanel((current) => current === next ? null : next); };
  const completeOnly = async () => { setBusy(true); try { setError(null); await onComplete(item.id, false); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not complete this item."); } finally { setBusy(false); } };
  // Deleting a loan also removes the loan movements it wrote (the lend/borrow and loan repayments), so balances move back; say so first.
  const removesEntries = isDebt && (Boolean(opening) || item.payments.some((payment) => !payment.linked && payment.transactionId && transactionsById.get(payment.transactionId)?.category === LOAN_CATEGORY_ID));
  const remove = async () => { if (!window.confirm(`Delete “${item.title}” and its repayment history?${removesEntries ? " Its loan entries in the ledger are removed too, so account balances change back." : ""}${keepsLinked ? " Entries you linked stay in your ledger, with their categories back." : ""}`)) return; setBusy(true); try { setError(null); await onDelete(item.id); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete this item."); } finally { setBusy(false); } };
  const undo = async (payment: DuePayment) => {
    if (!window.confirm(`Undo the ${isDebt ? "repayment" : "payment"} recorded on ${formatLedgerDate(payment.occurredOn, calendarSystem)}?${payment.linked ? " The linked entry stays in your ledger." : payment.transactionId ? " Its ledger entry is removed too." : ""}${item.status === "completed" ? " This due opens again." : ""}`)) return;
    setBusy(true); try { setError(null); await onUndoPayment(payment.id); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not undo this repayment."); } finally { setBusy(false); }
  };
  const kindLabel = item.kind === "receivable" ? "To receive" : item.kind === "payment" ? "To pay" : item.kind === "lent" ? "Lent" : "Borrowed";
  return <article id={`due-${item.id}`} tabIndex={-1} className={`v2-card v2-due is-${item.kind} is-${item.status}${overdue ? " is-overdue" : ""}${focused ? " is-focused" : ""}`}>
    <div className="v2-due-top">
      <span className="v2-tile" style={kindTileStyle(item.kind)} aria-hidden="true">{isDebt ? <HandCoins size={22} weight="duotone" /> : item.kind === "payment" ? <ArrowUpRight size={22} weight="bold" /> : <ArrowDownLeft size={22} weight="bold" />}</span>
      <div className="v2-row-main"><small className="v2-due-kind">{kindLabel}{item.person ? <> · <User size={11} weight="bold" />{item.person}</> : null}</small><strong>{item.title}</strong></div>
      <span className="v2-row-end"><strong className="amount">{plainAmount(item.status === "completed" ? item.amountMinor : remaining)}</strong><small className={overdue ? "is-overdue" : "v2-muted"}>{item.status === "completed" ? `Settled ${item.completedOn ? formatLedgerDate(item.completedOn, calendarSystem) : ""}` : dueDateLabel(item.dueOn, parseISO(today()), calendarSystem)}</small></span>
      {item.status === "open" ? <Menu position="bottom-end" shadow="md" withinPortal>
        <Menu.Target><button type="button" className="v2-icon-btn is-quiet" disabled={busy} aria-label={`More actions for ${item.title}`}><DotsThree size={20} weight="bold" /></button></Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<PencilSimple size={16} />} onClick={onEdit}>Edit</Menu.Item>
          {!isDebt && <Menu.Item leftSection={<Check size={16} />} onClick={() => void completeOnly()}>Complete without a ledger entry</Menu.Item>}
          <Menu.Item color="red" leftSection={<Trash size={16} />} onClick={() => void remove()}>Delete</Menu.Item>
        </Menu.Dropdown>
      </Menu> : <span />}
    </div>
    {isDebt && item.status === "open" && paid > 0 && <div className="v2-due-progress"><span className="v2-progress"><span style={{ width: `${Math.min(100, Math.round((paid / Math.max(1, item.amountMinor)) * 100))}%` }} /></span><small><span className="amount">{plainAmount(paid)}</span> of <span className="amount">{plainAmount(item.amountMinor)}</span> repaid</small></div>}
    <div className="v2-due-meta">{isDebt ? <>{item.occurredOn && <span><CalendarBlank size={13} />{item.kind === "lent" ? "Lent" : "Borrowed"} {shortDueDate(item.occurredOn, calendarSystem)}</span>}{moneyEntry && <span><Wallet size={13} />{item.kind === "lent" ? "From" : "Into"} {accountLabelOf(moneyEntry)}</span>}{linkedEntry ? <span title="Linked to an entry already in your ledger"><LinkSimple size={13} />{entryTitle(linkedEntry)}</span> : item.linkedTransactionId ? <span><LinkSimple size={13} />Linked entry removed</span> : null}</> : <span><Wallet size={13} />{getCategory(item.category, customCategories).label}</span>}{!isDebt && paid > 0 && item.status === "open" && <span><span className="amount">{plainAmount(paid)}</span> paid</span>}{item.remindOn && item.status === "open" && <span><Bell size={13} />Reminder {shortDueDate(item.remindOn, calendarSystem)}</span>}{item.receipt && <a href={`/api/receipts/${item.receipt.id}`} target="_blank" rel="noreferrer"><Paperclip size={13} />{item.receipt.name}<ArrowSquareOut size={12} /></a>}</div>
    {item.note && <p className="v2-due-note">{item.note}</p>}
    {item.status === "open" && <div className="v2-due-actions"><button type="button" className="v2-button is-primary is-small" disabled={busy} aria-expanded={panel === "settle"} onClick={() => togglePanel("settle")}>{busy && panel !== "settle" ? <ButtonSpinner /> : isDebt ? <HandCoins size={15} /> : <Check size={15} weight="bold" />}{isDebt ? "Record repayment" : item.kind === "payment" ? "Mark paid" : "Mark received"}</button>{canRemind && <button type="button" className="v2-button is-small" disabled={busy} aria-expanded={panel === "remind"} onClick={() => togglePanel("remind")}><ChatCircleText size={15} />{item.person.trim() ? `Remind ${item.person.trim()}` : "Send a reminder"}</button>}</div>}
    {panel === "settle" && item.status === "open" && <SettleForm item={item} currency={currency} calendarSystem={calendarSystem} accountOptions={accountOptions} linkContext={linkContext} defaultAccount={moneyEntry ? movementAccountOf(moneyEntry) : "cash"} onRecordPayment={onRecordPayment} onComplete={onComplete} onDone={() => setPanel(null)} />}
    {panel === "remind" && canRemind && <ReminderPanel item={item} currency={currency} calendarSystem={calendarSystem} />}
    {history.length > 0 && <div className="v2-due-history">
      <button type="button" className="v2-due-history-toggle" aria-expanded={showHistory} onClick={() => setShowHistory((value) => !value)}><CaretDown size={13} weight="bold" aria-hidden />History <span>{history.length}</span></button>
      {showHistory && <ol>{history.map((payment) => <li key={payment.id}><div><strong className="amount">{plainAmount(payment.amountMinor)}</strong><small>{[formatLedgerDate(payment.occurredOn, calendarSystem), via(payment), payment.note.trim()].filter(Boolean).join(" · ")}</small></div>{payment.id === latest?.id && <button type="button" className="v2-link" disabled={busy} aria-label={`Undo the ${isDebt ? "repayment" : "payment"} of ${formatLedgerDate(payment.occurredOn, calendarSystem)}`} onClick={() => void undo(payment)}><ArrowCounterClockwise size={13} />Undo</button>}</li>)}</ol>}
    </div>}
    <FormError message={error} />
  </article>;
}

/** Records a repayment on a loan, or confirms a bill was paid or income received, with the real amount, date and account. */
function SettleForm({ item, currency, calendarSystem, accountOptions, linkContext, defaultAccount, onRecordPayment, onComplete, onDone }: { item: DueItem; currency: CurrencyCode; calendarSystem: CalendarSystem; accountOptions: AccountOption[]; linkContext: LinkContext; defaultAccount: string; onRecordPayment: Props["onRecordPayment"]; onComplete: Props["onComplete"]; onDone: () => void }) {
  const debt = isDebtKind(item.kind); const remaining = dueRemaining(item); const incoming = item.kind === "lent" || item.kind === "receivable";
  const [clientRequestId] = useState(newClientRequestId);
  const [amount, setAmount] = useState<string | number>(remaining / 100); const [date, setDate] = useState(today()); const [note, setNote] = useState("");
  const [account, setAccount] = useState(accountOptions.some((option) => option.value === defaultAccount) ? defaultAccount : "cash");
  const [addToLedger, setAddToLedger] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const amountMinor = majorToMinor(String(amount ?? ""));
  const newTotal = duePaid(item) + amountMinor;
  // Settling with an entry already in the ledger (the repayment you recorded, the bill you paid) instead of writing another.
  const linking = account === LINK;
  const [linkId, setLinkId] = useState<string | null>(null);
  const candidates = useMemo(() => linking ? settlementLinkCandidates({ kind: item.kind, transactions: linkContext.transactions, dues: linkContext.dues, userId: linkContext.ownerId, nearDate: date }) : [], [linking, item.kind, linkContext, date]);
  const linked = candidates.find((candidate) => candidate.transaction.id === linkId)?.transaction;
  const pickEntry = (candidate: LinkCandidate<LedgerTransaction> | null) => {
    setLinkId(candidate?.transaction.id ?? null);
    if (!candidate) return;
    setDate(candidate.transaction.occurredOn);
    setAmount((debt ? Math.min(candidate.transaction.amountMinor, remaining) : candidate.transaction.amountMinor) / 100);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || (linking && !linkId)) return;
    setBusy(true); setError(null);
    const options = linking ? { paymentAccountId: null, clientRequestId, linkTransactionId: linkId ?? undefined } : { paymentAccountId: addToLedger && account !== "cash" ? account : null, clientRequestId };
    try {
      if (debt) await onRecordPayment(item.id, String(amount), date, note, addToLedger, options);
      else await onComplete(item.id, true, { ...options, amount: String(amount), occurredOn: date });
      onDone();
    } catch (caught) { setError(caught instanceof Error ? caught.message : debt ? "Could not record this repayment." : "Could not settle this item."); } finally { setBusy(false); }
  };
  return <form className="v2-form v2-due-settle" onSubmit={submit} aria-busy={busy}>
    <NumberInput label={debt ? "Amount" : item.kind === "payment" ? "Amount paid" : "Amount received"} leftSection={currency} leftSectionWidth={52} value={amount} onChange={setAmount} min={0.01} max={debt ? remaining / 100 : undefined} decimalScale={2} thousandSeparator="," required />
    <DatePickerInput label="Date" description={bsHint(date, calendarSystem)} value={date} onChange={(value) => value && setDate(value)} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />
    <Select label={incoming ? "Received via" : "Paid via"} value={account} onChange={(value) => value && setAccount(value)} data={[...accountOptions, LINK_OPTION]} allowDeselect={false} disabled={!addToLedger} />
    {linking && <LinkedEntryPicker label={debt ? "The repayment you recorded" : item.kind === "payment" ? "The payment you recorded" : "The money you recorded"} description={linked ? debt && linkMakesLoan(item.kind, amountMinor, linked) ? `The whole entry becomes this loan's repayment, so it stops counting as ${incoming ? "income" : "spending"}.` : debt ? "Only part of this entry repays the loan, so it keeps its category." : "The entry keeps its category; nothing new is added to your ledger." : incoming ? "Money that came in, nearest this date first." : "Money that went out, nearest this date first."} candidates={candidates} value={linkId} onChange={pickEntry} currency={currency} calendarSystem={calendarSystem} customCategories={linkContext.customCategories} />}
    {debt && <TextInput label="Note" value={note} onChange={(event) => setNote(event.currentTarget.value)} placeholder="Optional" maxLength={240} />}
    {debt && !linking && <label className="v2-check"><input type="checkbox" checked={addToLedger} onChange={(event) => setAddToLedger(event.currentTarget.checked)} /><span>Add this movement to the ledger (a loan repayment, not {incoming ? "income" : "spending"})</span></label>}
    {!debt && amountMinor > 0 && amountMinor !== remaining && <p className="v2-muted">The total of this {item.kind === "payment" ? "bill" : "item"} changes to <span className="amount">{formatMoney(newTotal, currency)}</span>.</p>}
    <FormError message={error} />
    <div className="v2-form-actions"><button type="button" className="v2-button" disabled={busy} onClick={onDone}>Cancel</button><button className="v2-button is-primary" disabled={busy || amountMinor <= 0 || (linking && !linkId)}>{busy ? <><ButtonSpinner />Saving…</> : debt ? "Record repayment" : item.kind === "payment" ? "Confirm paid" : "Confirm received"}</button></div>
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
  return <div className="v2-due-remind">
    <div className="v2-due-remind-head"><span id={`remind-${item.id}`}>Message{person ? ` to ${person}` : ""}</span><SegmentedControl size="xs" value={language} onChange={changeLanguage} data={[{ value: "en", label: "English" }, { value: "ne", label: "Nepali" }]} aria-label="Message language" /></div>
    <p className="v2-due-remind-text" tabIndex={0} aria-labelledby={`remind-${item.id}`}>{text}</p>
    <div className="v2-due-remind-actions">
      {canShare ? <button type="button" className="v2-button is-primary is-small" onClick={() => void share()}><ShareNetwork size={16} />Share</button> : <>
        <a className="v2-button is-small" href={links.whatsapp} target="_blank" rel="noreferrer"><WhatsappLogo size={16} />WhatsApp</a>
        <a className="v2-button is-small" href={links.viber}><ChatCircleText size={16} />Viber</a>
        <a className="v2-button is-small" href={links.sms}><ChatText size={16} />SMS</a>
      </>}
      <button type="button" className="v2-button is-small" onClick={() => void copy()}>{copied === "copied" ? <Check size={16} /> : <Copy size={16} />}{copied === "copied" ? "Copied" : copied === "failed" ? "Could not copy" : "Copy"}</button>
    </div>
  </div>;
}
