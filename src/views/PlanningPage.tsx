import { CalendarDots, Check, Flag, PauseCircle, PencilSimple, PlayCircle, Plus, Repeat, Sparkle, Trash } from "@phosphor-icons/react";
import { NumberInput, Select, TextInput } from "@mantine/core";
import { eachDayOfInterval, endOfMonth, format, getDay, isSameDay, isSameMonth, parseISO, startOfMonth } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { BudgetPlanner } from "../components/BudgetPlanner";
import { CategoryIcon } from "../components/CategoryIcon";
import { SlidingTabs } from "../components/SlidingTabs";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { EmptyState } from "../components/EmptyState";
import { LedgerDatePickerInput as DatePickerInput } from "../components/LedgerDatePickerInput";
import { MonthPicker } from "../components/MonthPicker";
import { RecurringConfirmSheet } from "../components/RecurringConfirmSheet";
import { useLedger } from "../context/LedgerContext";
import { allCategoriesFor, getCategory } from "../lib/categories";
import { dailyCashFlow } from "../lib/calendar";
import { formatMoney } from "../lib/currency";
import { formatLedgerDay, todayInput } from "../lib/dates";
import { recurrenceLabel } from "../lib/recurrence";
import { onlinePaymentAccounts, paymentAccountLabel } from "../lib/payment-accounts";
import { detectRecurringPatterns, type RecurringPatternSuggestion } from "../lib/transaction-intelligence";
import type { CalendarSystem, Budget, CurrencyCode, CustomCategory, DueItem, LedgerTransaction, PaymentAccount, RecurrenceUnit, RecurringDraft, RecurringEntry, SavingsGoal, TransactionKind } from "../types";
import { FormError } from "../components/FormError";

type PlanTab = "budgets" | "goals" | "recurring" | "calendar";
const previewMinor = (value: string) => Math.round(Number(value.replace(/,/g, "")) * 100) || 0;

interface PlanningPageProps {
  calendarSystem: CalendarSystem;
  month: Date; currency: CurrencyCode; transactions: LedgerTransaction[]; budgets: Budget[]; recurringEntries: RecurringEntry[]; dueItems: DueItem[]; goals: SavingsGoal[]; customCategories: CustomCategory[]; paymentAccounts: PaymentAccount[];
  onMonthChange: (date: Date) => void;
  onSaveBudget: (draft: { category: string; amount: string; monthKey: string; shared?: boolean }, id?: string) => Promise<void>;
  onDeleteBudget: (id: string) => Promise<void>;
  onSaveRecurring: (draft: RecurringDraft, id?: string) => Promise<void>;
  onDeleteRecurring: (id: string) => Promise<void>;
  onSaveGoal: (draft: { name: string; target: string; saved: string; targetDate: string }, id?: string) => Promise<void>;
  onContribute: (id: string, amount: string) => Promise<void>;
  onDeleteGoal: (id: string) => Promise<void>;
}

export function PlanningPage(props: PlanningPageProps) {
  const calendarSystem = props.calendarSystem;
  const [tab, setTab] = useState<PlanTab>("budgets");
  const tabs: { id: PlanTab; label: string; icon: typeof Flag }[] = [
    { id: "budgets", label: "Budgets", icon: Flag }, { id: "goals", label: "Goals", icon: Check },
    { id: "recurring", label: "Recurring", icon: Repeat }, { id: "calendar", label: "Calendar", icon: CalendarDots },
  ];
  return (
    <div className="page planning-page">
      <header className="page-header"><div><span className="eyebrow">Your money plan</span><h1>Plan</h1><p>Set gentle guardrails and prepare the entries that repeat.</p></div><MonthPicker calendarSystem={calendarSystem} month={props.month} onChange={props.onMonthChange} /></header>
      <div className="section-tabs-slot"><SlidingTabs label="Planning sections" value={tab} onChange={setTab} options={tabs.map(({ id, label, icon: Icon }) => ({ id, label, icon: <Icon size={16} /> }))} /></div>
      {tab === "budgets" && <BudgetsSection {...props} />}
      {tab === "goals" && <GoalsSection {...props} />}
      {tab === "recurring" && <RecurringSection {...props} />}
      {tab === "calendar" && <CalendarSection {...props} />}
    </div>
  );
}

function BudgetsSection({ month, calendarSystem, currency, transactions, budgets, recurringEntries, dueItems, customCategories, onSaveBudget, onDeleteBudget }: PlanningPageProps) {
  return <BudgetPlanner month={month} calendarSystem={calendarSystem} currency={currency} transactions={transactions} budgets={budgets} recurringEntries={recurringEntries} dueItems={dueItems} customCategories={customCategories} onSaveBudget={onSaveBudget} onDeleteBudget={onDeleteBudget} />;
}

function GoalsSection({ currency, goals, onSaveGoal, onContribute, onDeleteGoal }: PlanningPageProps) {
  const [name, setName] = useState(""); const [target, setTarget] = useState(""); const [targetDate, setTargetDate] = useState(""); const [contributions, setContributions] = useState<Record<string, string>>({}); const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); const [preview, setPreview] = useState<{ name: string; target: string; targetDate: string } | null>(null); const [pendingGoal, setPendingGoal] = useState<{ id: string; action: "contribute" | "delete" } | null>(null);
  const save = async (event: React.FormEvent) => { event.preventDefault(); if (saving) return; const draft = { name, target, targetDate }; setSaving(true); setPreview(draft); try { setError(null); await onSaveGoal({ ...draft, saved: "0" }); setName(""); setTarget(""); setTargetDate(""); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save goal."); } finally { setSaving(false); setPreview(null); } };
  const contribute = async (id: string) => { const amount = contributions[id] ?? ""; if (!amount || pendingGoal) return; setPendingGoal({ id, action: "contribute" }); try { setError(null); await onContribute(id, amount); setContributions((current) => ({ ...current, [id]: "" })); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not add contribution."); } finally { setPendingGoal(null); } };
  const remove = async (id: string) => { if (pendingGoal) return; setPendingGoal({ id, action: "delete" }); try { setError(null); await onDeleteGoal(id); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete goal."); } finally { setPendingGoal(null); } };
  return <section className="planner-layout"><article className="planner-form-panel"><span className="section-label">New savings goal</span><h2>Give savings a purpose</h2><form onSubmit={save} className="stack-form" aria-busy={saving}><TextInput label="Goal name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Emergency fund" required disabled={saving} /><NumberInput label={`Target in ${currency}`} value={target} onChange={(value) => setTarget(String(value))} placeholder="300,000" required disabled={saving} min={0} thousandSeparator="," decimalScale={2} /><DatePickerInput label="Target date" description="Optional" value={targetDate || null} onChange={(value) => setTargetDate(value ?? "")} disabled={saving} clearable valueFormat="MMM D, YYYY" firstDayOfWeek={0} /><button className="primary-button" disabled={saving}>{saving ? <><ButtonSpinner />Creating goal…</> : <><Plus size={17} />Create goal</>}</button><FormError message={error} /></form></article><article className="planner-content"><div className="section-heading"><div><span className="section-label">Savings goals</span><h2>What you’re building toward</h2></div></div><div className="goal-grid">{preview && <article className="goal-card pending-preview" role="status"><span className="pending-label"><ButtonSpinner />Creating…</span><h3>{preview.name}</h3><strong>{formatMoney(0, currency)}</strong><small>of {formatMoney(previewMinor(preview.target), currency)}{preview.targetDate ? ` · by ${format(parseISO(preview.targetDate), "MMM yyyy")}` : ""}</small><div className="bar-track"><span style={{ width: "0%" }} /></div></article>}{goals.map((goal) => { const percent = Math.round((goal.savedMinor / goal.targetMinor) * 100); const contributing = pendingGoal?.id === goal.id && pendingGoal.action === "contribute"; const deleting = pendingGoal?.id === goal.id && pendingGoal.action === "delete"; return <article className="goal-card" key={goal.id} aria-busy={contributing || deleting}><button className="icon-button danger goal-delete" disabled={deleting} onClick={() => void remove(goal.id)} aria-label={`Delete ${goal.name}`}>{deleting ? <ButtonSpinner /> : <Trash size={16} />}</button><span>{deleting ? "Removing…" : `${percent}% complete`}</span><h3>{goal.name}</h3><strong>{formatMoney(goal.savedMinor, currency)}</strong><small>of {formatMoney(goal.targetMinor, currency)}{goal.targetDate ? ` · by ${format(parseISO(goal.targetDate), "MMM yyyy")}` : ""}</small><div className="bar-track"><span style={{ width: `${Math.min(100, percent)}%` }} /></div><div className="contribution-row"><NumberInput aria-label={`Contribution to ${goal.name}`} placeholder="Add amount" value={contributions[goal.id] ?? ""} min={0} thousandSeparator="," decimalScale={2} disabled={contributing || deleting || percent >= 100} onChange={(value) => setContributions((current) => ({ ...current, [goal.id]: String(value) }))} /><button disabled={contributing || deleting || percent >= 100 || !(contributions[goal.id] ?? "")} onClick={() => void contribute(goal.id)}>{contributing ? <><ButtonSpinner />Adding…</> : percent >= 100 ? "Done" : "Add"}</button></div><div className="goal-contributions"><div className="goal-contributions-heading"><strong>Contribution history</strong><span>{goal.contributions.length}</span></div>{goal.contributions.length ? <div className="goal-contribution-list">{goal.contributions.map((contribution) => <div className="goal-contribution" key={contribution.id}><time dateTime={contribution.createdAt}>{contribution.isOpeningBalance ? "Opening balance · " : ""}{format(parseISO(contribution.createdAt), "MMM d, yyyy · h:mm a")}</time><strong className="amount">+{formatMoney(contribution.amountMinor, currency)}</strong></div>)}</div> : <p>No contributions yet.</p>}</div></article>; })}</div>{!goals.length && !preview && <EmptyState title="No savings goals yet" />}</article></section>;
}

function RecurringKindToggle({ value, disabled, onChange }: { value: TransactionKind; disabled: boolean; onChange: (value: TransactionKind) => void }) {
  return <div className="recurring-kind-control"><SlidingTabs label="Recurring entry type" value={value} disabled={disabled} onChange={onChange} options={[{ id: "expense", label: "Expense" }, { id: "income", label: "Income" }]} /></div>;
}

function RecurringSection({ currency, transactions, recurringEntries, customCategories, paymentAccounts, onSaveRecurring, onDeleteRecurring }: PlanningPageProps) {
  const { setRecurringActive } = useLedger();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const today = todayInput();
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [category, setCategory] = useState("housing");
  const [amount, setAmount] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [note, setNote] = useState("");
  const [schedule, setSchedule] = useState("month:1");
  const [startOn, setStartOn] = useState(today);
  const [editing, setEditing] = useState<RecurringEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); const [pendingEntry, setPendingEntry] = useState<{ id: string; action: "toggle" | "delete" } | null>(null);
  const suggestions = useMemo(() => detectRecurringPatterns(transactions, recurringEntries), [recurringEntries, transactions]);
  // Cash in hand collects cash entries on its own, so a schedule paid from it is simply a cash schedule.
  const onlineAccounts = useMemo(() => onlinePaymentAccounts(paymentAccounts), [paymentAccounts]);
  // Only an account the picker offers is kept, so a suggestion from a partner's shared entry never links their account.
  const linkedAccountId = (accountId: string | null | undefined) => accountId && onlineAccounts.some((account) => account.id === accountId) ? accountId : "";
  const resetForm = () => {
    setAmount("");
    setPaymentAccountId("");
    setNote("");
    setSchedule("month:1");
    setStartOn(today);
    setEditing(null);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !startOn) return;
    const [recurrenceUnit, interval] = schedule.split(":") as [RecurrenceUnit, string];
    setSaving(true);
    try {
      setError(null);
      await onSaveRecurring({ kind, category, amount, paymentAccountId: paymentAccountId || null, note, tags: "", recurrenceUnit, recurrenceInterval: Number(interval), startOn }, editing?.id);
      resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save recurring entry.");
    } finally {
      setSaving(false);
    }
  };
  const edit = (entry: RecurringEntry) => {
    setEditing(entry);
    setKind(entry.kind);
    setCategory(entry.category);
    setAmount(String(entry.amountMinor / 100));
    setPaymentAccountId(linkedAccountId(entry.paymentAccountId));
    setNote(entry.note);
    setSchedule(`${entry.recurrenceUnit}:${entry.recurrenceInterval}`);
    setStartOn(entry.anchorDate);
    setError(null);
  };
  const useSuggestion = (suggestion: RecurringPatternSuggestion) => {
    setEditing(null);
    setKind(suggestion.kind);
    setCategory(suggestion.category);
    setAmount(String(suggestion.amountMinor / 100));
    setPaymentAccountId(linkedAccountId(suggestion.paymentAccountId));
    setNote(suggestion.note);
    setSchedule(`${suggestion.recurrenceUnit}:${suggestion.recurrenceInterval}`);
    setStartOn(suggestion.startOn);
    setError(null);
    document.getElementById("recurring-entry-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const runEntryAction = async (entry: RecurringEntry, action: "toggle" | "delete") => { if (pendingEntry) return; setPendingEntry({ id: entry.id, action }); try { setError(null); await (action === "toggle" ? setRecurringActive(entry.id, !entry.active) : onDeleteRecurring(entry.id)); } catch (caught) { setError(caught instanceof Error ? caught.message : `Could not ${action === "toggle" ? (entry.active ? "pause" : "resume") : "delete"} recurring entry.`); } finally { setPendingEntry(null); } };
  const scheduleOptions = [
    { value: "day:1", label: "Daily" },
    { value: "week:1", label: "Weekly" },
    { value: "week:2", label: "Every 2 weeks" },
    { value: "month:1", label: "Monthly" },
    { value: "month:3", label: "Every 3 months" },
    { value: "year:1", label: "Yearly" },
  ];
  return <section className="planner-layout">
    <article className="planner-form-panel" id="recurring-entry-form">
      <span className="section-label">{editing ? "Update schedule" : "Schedule a regular entry"}</span>
      <h2>{editing ? "Edit recurring entry" : "Prepare what repeats"}</h2>
      <form onSubmit={save} className="stack-form" aria-busy={saving}>
        <RecurringKindToggle value={kind} disabled={saving} onChange={(next) => { setKind(next); setCategory(next === "expense" ? "housing" : "salary"); }} />
        <Select label="Category" value={category} disabled={saving} onChange={(value) => value && setCategory(value)} data={allCategoriesFor(kind, customCategories).map((item) => ({ value: item.id, label: item.label }))} searchable allowDeselect={false} />
        <NumberInput label={`Amount in ${currency}`} value={amount} disabled={saving} onChange={(value) => setAmount(String(value))} required min={0} thousandSeparator="," decimalScale={2} />
        <Select label={kind === "expense" ? "Money from" : "Money to"} description={onlineAccounts.length ? "Leave blank for cash, or choose a tracked account." : "Optional — add a tracked account on Accounts to link this plan."} placeholder={onlineAccounts.length ? "Cash / choose an account" : "Cash / untracked"} value={paymentAccountId || null} disabled={saving} onChange={(value) => setPaymentAccountId(value ?? "")} data={onlineAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} searchable clearable />
        <TextInput label="Note" value={note} disabled={saving} onChange={(event) => setNote(event.target.value)} placeholder={kind === "expense" ? "Rent, subscription, or bill" : "Salary or regular income"} />
        <Select label="Repeats" value={schedule} disabled={saving} onChange={(value) => value && setSchedule(value)} data={scheduleOptions} allowDeselect={false} />
        <DatePickerInput label="First due date" description="The schedule advances from this date" value={startOn} onChange={(value) => setStartOn(value ?? "")} disabled={saving} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />
        <button className="primary-button" disabled={saving || !startOn}>{saving ? <><ButtonSpinner />Saving schedule…</> : <><Plus size={17} />{editing ? "Update schedule" : "Save recurring entry"}</>}</button>
        {editing && <button type="button" className="secondary-button" disabled={saving} onClick={resetForm}>Cancel editing</button>}
        <FormError message={error} />
      </form>
    </article>
    <article className="planner-content">
      {suggestions.length > 0 && <section className="recurring-suggestions" aria-labelledby="recurring-suggestions-heading"><div className="section-heading"><div><span className="section-label">Detected from your history</span><h2 id="recurring-suggestions-heading">Possible repeating entries</h2></div><Sparkle size={21} weight="duotone" /></div><div>{suggestions.map((suggestion) => <article key={suggestion.id}><span className="transaction-icon"><Sparkle size={17} /></span><div><strong>{suggestion.note || getCategory(suggestion.category, customCategories).label}</strong><small>{formatMoney(suggestion.amountMinor, currency)} · {suggestion.evidenceCount} matching entries · {Math.round(suggestion.confidence * 100)}% confidence</small><span>{suggestion.recurrenceInterval === 1 ? suggestion.recurrenceUnit[0].toUpperCase() + suggestion.recurrenceUnit.slice(1) + "ly" : `Every ${suggestion.recurrenceInterval} ${suggestion.recurrenceUnit}s`}</span></div><button type="button" className="secondary-button small" onClick={() => useSuggestion(suggestion)}>Review schedule</button></article>)}</div></section>}
      <div className="section-heading"><div><span className="section-label">Confirm before logging</span><h2>Recurring entries</h2></div></div>
      <div className="recurring-list">{recurringEntries.map((entry) => {
        const ready = entry.active && entry.nextDueOn <= today;
        const toggling = pendingEntry?.id === entry.id && pendingEntry.action === "toggle";
        const deleting = pendingEntry?.id === entry.id && pendingEntry.action === "delete";
        const busy = toggling || deleting;
        const definition = getCategory(entry.category, customCategories);
        const label = entry.note || definition.label;
        const account = entry.paymentAccountId ? paymentAccounts.find((item) => item.id === entry.paymentAccountId) : null;
        const accountText = `${entry.kind === "expense" ? "From" : "To"}: ${account ? paymentAccountLabel(account) : "Cash / untracked"}`;
        return <article key={entry.id} className={entry.active ? undefined : "paused"} aria-busy={busy}>
          <div className="transaction-icon"><CategoryIcon category={entry.category} icon={definition.icon} /></div>
          <div>
            <strong>{label}</strong>
            <span>{formatMoney(entry.amountMinor, currency)} · {recurrenceLabel(entry)}</span>
            <small>{accountText}</small>
            <small>{deleting ? "Removing…" : toggling ? (entry.active ? "Pausing…" : "Resuming…") : entry.active ? `Next: ${format(parseISO(entry.nextDueOn), "MMM d, yyyy")}` : "Paused · nothing will be due until you resume"}</small>
          </div>
          <button className="secondary-button small" disabled={!ready || busy} onClick={() => setReviewingId(entry.id)}>{ready ? <><Check size={15} />Confirm</> : entry.active ? "Scheduled" : "Paused"}</button>
          <button className="icon-button pause-toggle" disabled={busy || saving} onClick={() => void runEntryAction(entry, "toggle")} aria-label={`${entry.active ? "Pause" : "Resume"} ${label}`} title={entry.active ? "Pause" : "Resume"}>{toggling ? <ButtonSpinner /> : entry.active ? <PauseCircle size={16} /> : <PlayCircle size={16} />}</button>
          <button className="icon-button" disabled={busy || saving} onClick={() => edit(entry)} aria-label={`Edit ${entry.note || "recurring entry"}`}><PencilSimple size={16} /></button>
          <button className="icon-button danger" disabled={busy} onClick={() => void runEntryAction(entry, "delete")} aria-label={`Delete ${entry.note || "recurring entry"}`}>{deleting ? <ButtonSpinner /> : <Trash size={16} />}</button>
        </article>;
      })}</div>
      {!recurringEntries.length && <EmptyState title="Nothing repeats yet" />}
      <RecurringConfirmSheet entryId={reviewingId} onClose={() => setReviewingId(null)} />
    </article>
  </section>;
}

function CalendarSection({ month, currency, transactions, onMonthChange, calendarSystem }: PlanningPageProps) {
  const days = useMemo(() => eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) }), [month]);
  const firstOffset = getDay(days[0]);
  const totals = useMemo(() => dailyCashFlow(transactions), [transactions]);
  const [selected, setSelected] = useState<Date>(() => isSameMonth(new Date(), month) ? new Date() : startOfMonth(month));
  useEffect(() => { setSelected((current) => isSameMonth(current, month) ? current : startOfMonth(month)); }, [month]);
  const selectedKey = format(selected, "yyyy-MM-dd");
  const selectedEntries = useMemo(() => transactions.filter((item) => item.occurredOn === selectedKey), [selectedKey, transactions]);
  const selectedTotal = totals.get(selectedKey);
  const netAmount = (value: number) => `${currency} ${value < 0 ? "−" : ""}${formatMoney(Math.abs(value), currency, true).replace(currency, "").trim()}`;
  return <section className="calendar-layout"><article className="calendar-panel"><div className="calendar-heading"><MonthPicker calendarSystem={calendarSystem} month={month} onChange={onMonthChange} /></div><div className="weekday-row">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{Array.from({ length: firstOffset }).map((_, index) => <span key={`blank-${index}`} />)}{days.map((day) => {
    const key = format(day, "yyyy-MM-dd"); const total = totals.get(key);
    const netTone = !total ? "" : total.net > 0 ? "net-positive" : total.net < 0 ? "net-negative" : "net-balanced";
    const summary = total ? `Income ${formatMoney(total.income, currency)}, expenses ${formatMoney(total.expenses, currency)}, net ${total.net >= 0 ? "positive " : "negative "}${formatMoney(Math.abs(total.net), currency)}` : "No entries";
    return <button key={key} className={`${isSameDay(day, selected) ? "selected " : ""}${total ? `has-entries ${netTone}` : ""}`} onClick={() => setSelected(day)} aria-label={`${formatLedgerDay(day, calendarSystem, "date")}. ${summary}`}>
      <strong className="calendar-date">{format(day, "d")}</strong>
      {total && <span className="calendar-summary calendar-amount">{netAmount(total.net)}</span>}
    </button>;
  })}</div></article><aside className="calendar-day" aria-live="polite"><span className="section-label">{formatLedgerDay(selected, calendarSystem)}</span><h2>{selectedEntries.length ? `${selectedEntries.length} ${selectedEntries.length === 1 ? "entry" : "entries"}` : "A clear day"}</h2>{selectedTotal && <div className="calendar-day-summary"><span><small>Income</small><strong className="income calendar-amount">{formatMoney(selectedTotal.income, currency)}</strong></span><span><small>Expenses</small><strong className="expense calendar-amount">{formatMoney(selectedTotal.expenses, currency)}</strong></span><span><small>Net</small><strong className={`calendar-amount ${selectedTotal.net < 0 ? "expense" : selectedTotal.net > 0 ? "income" : ""}`}>{netAmount(selectedTotal.net)}</strong></span></div>}<div className="calendar-entry-list">{selectedEntries.map((item) => <div key={item.id}><span>{item.note || getCategory(item.category).label}</span><strong className={item.kind}>{item.kind === "income" ? "+" : "−"}{formatMoney(item.amountMinor, currency)}</strong></div>)}</div>{!selectedEntries.length && <p>No income or expenses logged.</p>}</aside></section>;
}
