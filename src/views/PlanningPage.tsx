import { CalendarDots, Check, Flag, PencilSimple, Plus, Repeat, Trash, WarningCircle } from "@phosphor-icons/react";
import { NumberInput, Select, TextInput } from "@mantine/core";
import { eachDayOfInterval, endOfMonth, format, getDay, isSameDay, isSameMonth, parseISO, startOfMonth } from "date-fns";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { CategoryIcon } from "../components/CategoryIcon";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { EmptyState } from "../components/EmptyState";
import { LedgerDatePickerInput as DatePickerInput } from "../components/LedgerDatePickerInput";
import { MonthPicker } from "../components/MonthPicker";
import { allCategoriesFor, getCategory } from "../lib/categories";
import { dailyCashFlow } from "../lib/calendar";
import { formatMoney } from "../lib/currency";
import { monthKey } from "../lib/dates";
import { calculateBudgetPacing } from "../lib/planning-insights";
import { recurrenceLabel } from "../lib/recurrence";
import type { Budget, CurrencyCode, CustomCategory, DueItem, LedgerTransaction, RecurrenceUnit, RecurringDraft, RecurringEntry, SavingsGoal, TransactionKind } from "../types";

type PlanTab = "budgets" | "goals" | "recurring" | "calendar";
const previewMinor = (value: string) => Math.round(Number(value.replace(/,/g, "")) * 100) || 0;

interface PlanningPageProps {
  month: Date; currency: CurrencyCode; transactions: LedgerTransaction[]; budgets: Budget[]; recurringEntries: RecurringEntry[]; dueItems: DueItem[]; goals: SavingsGoal[]; customCategories: CustomCategory[];
  onMonthChange: (date: Date) => void;
  onSaveBudget: (draft: { category: string; amount: string; monthKey: string }, id?: string) => Promise<void>;
  onDeleteBudget: (id: string) => Promise<void>;
  onSaveRecurring: (draft: RecurringDraft, id?: string) => Promise<void>;
  onDeleteRecurring: (id: string) => Promise<void>;
  onConfirmRecurring: (id: string) => Promise<void>;
  onSaveGoal: (draft: { name: string; target: string; saved: string; targetDate: string }, id?: string) => Promise<void>;
  onContribute: (id: string, amount: string) => Promise<void>;
  onDeleteGoal: (id: string) => Promise<void>;
}

export function PlanningPage(props: PlanningPageProps) {
  const [tab, setTab] = useState<PlanTab>("budgets");
  const tabs: { id: PlanTab; label: string; icon: typeof Flag }[] = [
    { id: "budgets", label: "Budgets", icon: Flag }, { id: "goals", label: "Goals", icon: Check },
    { id: "recurring", label: "Recurring", icon: Repeat }, { id: "calendar", label: "Calendar", icon: CalendarDots },
  ];
  return (
    <div className="page planning-page">
      <header className="page-header"><div><span className="eyebrow">Your money plan</span><h1>Plan</h1><p>Set gentle guardrails and prepare the entries that repeat.</p></div><MonthPicker month={props.month} onChange={props.onMonthChange} /></header>
      <nav className="section-tabs" aria-label="Planning sections">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon size={18} />{label}</button>)}</nav>
      {tab === "budgets" && <BudgetsSection {...props} />}
      {tab === "goals" && <GoalsSection {...props} />}
      {tab === "recurring" && <RecurringSection {...props} />}
      {tab === "calendar" && <CalendarSection {...props} />}
    </div>
  );
}

function BudgetsSection({ month, currency, transactions, budgets, recurringEntries, dueItems, customCategories, onSaveBudget, onDeleteBudget }: PlanningPageProps) {
  const [category, setCategory] = useState("food"); const [amount, setAmount] = useState(""); const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); const [preview, setPreview] = useState<{ category: string; amount: string } | null>(null); const [deletingId, setDeletingId] = useState<string | null>(null);
  const currentBudgets = budgets.filter((item) => item.monthKey === monthKey(month));
  const pacing = calculateBudgetPacing(currentBudgets, transactions, recurringEntries, dueItems, month);
  const alerts = pacing.filter((item) => item.tone !== "healthy");
  const save = async (event: React.FormEvent) => { event.preventDefault(); if (saving) return; const draft = { category, amount }; setSaving(true); setPreview(draft); try { setError(null); await onSaveBudget({ ...draft, monthKey: monthKey(month) }); setAmount(""); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save budget."); } finally { setSaving(false); setPreview(null); } };
  const remove = async (id: string) => { if (deletingId) return; setDeletingId(id); try { setError(null); await onDeleteBudget(id); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete budget."); } finally { setDeletingId(null); } };
  const previewDefinition = preview ? getCategory(preview.category, customCategories) : null;
  return <section className="planner-layout">
    <article className="planner-form-panel" id="add-budget"><span className="section-label">New monthly limit</span><h2>Add a category budget</h2><form onSubmit={save} className="stack-form" aria-busy={saving}><Select label="Category" value={category} onChange={(value) => value && setCategory(value)} disabled={saving} data={allCategoriesFor("expense", customCategories).map((item) => ({ value: item.id, label: item.label }))} searchable allowDeselect={false} /><NumberInput label={`Amount in ${currency}`} value={amount} onChange={(value) => setAmount(String(value))} placeholder="15,000" required disabled={saving} min={0} thousandSeparator="," decimalScale={2} /><button className="primary-button" disabled={saving}>{saving ? <><ButtonSpinner />Saving budget…</> : <><Plus size={17} />Save budget</>}</button>{error && <div className="form-error" role="alert">{error}</div>}</form></article>
    <article className="planner-content"><div className="section-heading"><div><span className="section-label">{format(month, "MMMM")} budgets</span><h2>Category guardrails</h2></div></div>
      {alerts.length > 0 && <div className="budget-alert-list" role="status" aria-label="Budget alerts">{alerts.map((item) => {
        const definition = getCategory(item.budget.category, customCategories);
        return <div className={`budget-alert ${item.tone}`} key={item.budget.id}><WarningCircle size={17} weight="fill" /><span><strong>{definition.label}: {item.alertTitle}</strong><small>{item.alertDetail}</small></span></div>;
      })}</div>}
      {preview && previewDefinition && <div className="budget-row pending-preview" role="status"><div className="transaction-icon" style={{ "--category-color": previewDefinition.color } as CSSProperties}><CategoryIcon category={preview.category} icon={previewDefinition.icon} /></div><div><div><strong>{previewDefinition.label}</strong><span>{formatMoney(0, currency)} of {formatMoney(previewMinor(preview.amount), currency)}</span></div><div className="bar-track"><span style={{ width: "0%", backgroundColor: previewDefinition.color }} /></div><small className="pending-label"><ButtonSpinner />Adding budget…</small></div><span /></div>}
      {pacing.map((item) => {
        const budget = item.budget;
        const definition = getCategory(budget.category, customCategories);
        const deleting = deletingId === budget.id;
        const spentWidth = Math.min(100, item.spentPercentage);
        const upcomingWidth = Math.max(0, Math.min(100 - spentWidth, item.projectedPercentage - item.spentPercentage));
        return <div className={`budget-row pacing-${item.tone}`} key={budget.id} aria-busy={deleting}>
          <div className="transaction-icon" style={{ "--category-color": definition.color } as CSSProperties}><CategoryIcon category={budget.category} icon={definition.icon} /></div>
          <div className="budget-pacing-copy">
            <div><strong>{definition.label}</strong><span>{formatMoney(item.spentMinor, currency)} of {formatMoney(budget.amountMinor, currency)}</span></div>
            <div className="budget-progress" aria-label={`${item.spentPercentage}% spent${item.upcomingMinor ? `, ${item.projectedPercentage}% projected with upcoming expenses` : ""}`}>
              <span className="spent" style={{ width: `${spentWidth}%`, backgroundColor: definition.color }} />
              <span className="upcoming" style={{ width: `${upcomingWidth}%` }} />
            </div>
            <div className="budget-pacing-meta">
              <span>{item.spentPercentage}% spent</span>
              {item.upcomingMinor > 0 && <span>{formatMoney(item.upcomingMinor, currency)} upcoming · {item.projectedPercentage}% projected</span>}
              <span>{item.dailyAllowanceMinor > 0 ? `${formatMoney(item.dailyAllowanceMinor, currency)}/day available` : item.remainingMinor > 0 ? `${formatMoney(item.remainingMinor, currency)} remaining` : "No budget remaining"}</span>
            </div>
            <small className={`budget-status ${item.tone}`}>{deleting ? "Removing…" : item.alertTitle}</small>
          </div>
          <button className="icon-button danger" disabled={deleting} onClick={() => void remove(budget.id)} aria-label={`Delete ${definition.label} budget`}>{deleting ? <ButtonSpinner /> : <Trash size={17} />}</button>
        </div>;
      })}
      {!currentBudgets.length && !preview && <EmptyState title="No budgets for this month" message="Add a category limit to see spending progress here." />}
    </article>
  </section>;
}

function GoalsSection({ currency, goals, onSaveGoal, onContribute, onDeleteGoal }: PlanningPageProps) {
  const [name, setName] = useState(""); const [target, setTarget] = useState(""); const [targetDate, setTargetDate] = useState(""); const [contributions, setContributions] = useState<Record<string, string>>({}); const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); const [preview, setPreview] = useState<{ name: string; target: string; targetDate: string } | null>(null); const [pendingGoal, setPendingGoal] = useState<{ id: string; action: "contribute" | "delete" } | null>(null);
  const save = async (event: React.FormEvent) => { event.preventDefault(); if (saving) return; const draft = { name, target, targetDate }; setSaving(true); setPreview(draft); try { setError(null); await onSaveGoal({ ...draft, saved: "0" }); setName(""); setTarget(""); setTargetDate(""); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save goal."); } finally { setSaving(false); setPreview(null); } };
  const contribute = async (id: string) => { const amount = contributions[id] ?? ""; if (!amount || pendingGoal) return; setPendingGoal({ id, action: "contribute" }); try { setError(null); await onContribute(id, amount); setContributions((current) => ({ ...current, [id]: "" })); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not add contribution."); } finally { setPendingGoal(null); } };
  const remove = async (id: string) => { if (pendingGoal) return; setPendingGoal({ id, action: "delete" }); try { setError(null); await onDeleteGoal(id); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete goal."); } finally { setPendingGoal(null); } };
  return <section className="planner-layout"><article className="planner-form-panel"><span className="section-label">New savings goal</span><h2>Give savings a purpose</h2><form onSubmit={save} className="stack-form" aria-busy={saving}><TextInput label="Goal name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Emergency fund" required disabled={saving} /><NumberInput label={`Target in ${currency}`} value={target} onChange={(value) => setTarget(String(value))} placeholder="300,000" required disabled={saving} min={0} thousandSeparator="," decimalScale={2} /><DatePickerInput label="Target date" description="Optional" value={targetDate || null} onChange={(value) => setTargetDate(value ?? "")} disabled={saving} clearable valueFormat="MMM D, YYYY" firstDayOfWeek={0} /><button className="primary-button" disabled={saving}>{saving ? <><ButtonSpinner />Creating goal…</> : <><Plus size={17} />Create goal</>}</button>{error && <div className="form-error" role="alert">{error}</div>}</form></article><article className="planner-content"><div className="section-heading"><div><span className="section-label">Savings goals</span><h2>What you’re building toward</h2></div></div><div className="goal-grid">{preview && <article className="goal-card pending-preview" role="status"><span className="pending-label"><ButtonSpinner />Creating…</span><h3>{preview.name}</h3><strong>{formatMoney(0, currency)}</strong><small>of {formatMoney(previewMinor(preview.target), currency)}{preview.targetDate ? ` · by ${format(parseISO(preview.targetDate), "MMM yyyy")}` : ""}</small><div className="bar-track"><span style={{ width: "0%" }} /></div></article>}{goals.map((goal) => { const percent = Math.round((goal.savedMinor / goal.targetMinor) * 100); const contributing = pendingGoal?.id === goal.id && pendingGoal.action === "contribute"; const deleting = pendingGoal?.id === goal.id && pendingGoal.action === "delete"; return <article className="goal-card" key={goal.id} aria-busy={contributing || deleting}><button className="icon-button danger goal-delete" disabled={deleting} onClick={() => void remove(goal.id)} aria-label={`Delete ${goal.name}`}>{deleting ? <ButtonSpinner /> : <Trash size={16} />}</button><span>{deleting ? "Removing…" : `${percent}% complete`}</span><h3>{goal.name}</h3><strong>{formatMoney(goal.savedMinor, currency)}</strong><small>of {formatMoney(goal.targetMinor, currency)}{goal.targetDate ? ` · by ${format(parseISO(goal.targetDate), "MMM yyyy")}` : ""}</small><div className="bar-track"><span style={{ width: `${Math.min(100, percent)}%` }} /></div><div className="contribution-row"><NumberInput aria-label={`Contribution to ${goal.name}`} placeholder="Add amount" value={contributions[goal.id] ?? ""} min={0} thousandSeparator="," decimalScale={2} disabled={contributing || deleting || percent >= 100} onChange={(value) => setContributions((current) => ({ ...current, [goal.id]: String(value) }))} /><button disabled={contributing || deleting || percent >= 100 || !(contributions[goal.id] ?? "")} onClick={() => void contribute(goal.id)}>{contributing ? <><ButtonSpinner />Adding…</> : percent >= 100 ? "Done" : "Add"}</button></div><div className="goal-contributions"><div className="goal-contributions-heading"><strong>Contribution history</strong><span>{goal.contributions.length}</span></div>{goal.contributions.length ? <div className="goal-contribution-list">{goal.contributions.map((contribution) => <div className="goal-contribution" key={contribution.id}><time dateTime={contribution.createdAt}>{contribution.isOpeningBalance ? "Opening balance · " : ""}{format(parseISO(contribution.createdAt), "MMM d, yyyy · h:mm a")}</time><strong className="amount">+{formatMoney(contribution.amountMinor, currency)}</strong></div>)}</div> : <p>No contributions yet.</p>}</div></article>; })}</div>{!goals.length && !preview && <EmptyState title="No savings goals yet" />}</article></section>;
}

function RecurringKindToggle({ value, disabled, onChange }: { value: TransactionKind; disabled: boolean; onChange: (value: TransactionKind) => void }) {
  return <div className="recurring-kind-control" role="radiogroup" aria-label="Recurring entry type">
    {(["expense", "income"] as const).map((option) => <button key={option} type="button" role="radio" aria-checked={value === option} className={value === option ? "active" : ""} disabled={disabled} onClick={() => onChange(option)}>{option === "expense" ? "Expense" : "Income"}</button>)}
  </div>;
}

function RecurringSection({ currency, recurringEntries, customCategories, onSaveRecurring, onDeleteRecurring, onConfirmRecurring }: PlanningPageProps) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [category, setCategory] = useState("housing");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [schedule, setSchedule] = useState("month:1");
  const [startOn, setStartOn] = useState(today);
  const [editing, setEditing] = useState<RecurringEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); const [pendingEntry, setPendingEntry] = useState<{ id: string; action: "confirm" | "delete" } | null>(null);
  const resetForm = () => {
    setAmount("");
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
      await onSaveRecurring({ kind, category, amount, note, tags: "", recurrenceUnit, recurrenceInterval: Number(interval), startOn }, editing?.id);
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
    setNote(entry.note);
    setSchedule(`${entry.recurrenceUnit}:${entry.recurrenceInterval}`);
    setStartOn(entry.anchorDate);
    setError(null);
  };
  const runEntryAction = async (id: string, action: "confirm" | "delete") => { if (pendingEntry) return; setPendingEntry({ id, action }); try { setError(null); await (action === "confirm" ? onConfirmRecurring(id) : onDeleteRecurring(id)); } catch (caught) { setError(caught instanceof Error ? caught.message : `Could not ${action} recurring entry.`); } finally { setPendingEntry(null); } };
  const scheduleOptions = [
    { value: "day:1", label: "Daily" },
    { value: "week:1", label: "Weekly" },
    { value: "week:2", label: "Every 2 weeks" },
    { value: "month:1", label: "Monthly" },
    { value: "month:3", label: "Every 3 months" },
    { value: "year:1", label: "Yearly" },
  ];
  return <section className="planner-layout">
    <article className="planner-form-panel">
      <span className="section-label">{editing ? "Update schedule" : "Schedule a regular entry"}</span>
      <h2>{editing ? "Edit recurring entry" : "Prepare what repeats"}</h2>
      <form onSubmit={save} className="stack-form" aria-busy={saving}>
        <RecurringKindToggle value={kind} disabled={saving} onChange={(next) => { setKind(next); setCategory(next === "expense" ? "housing" : "salary"); }} />
        <Select label="Category" value={category} disabled={saving} onChange={(value) => value && setCategory(value)} data={allCategoriesFor(kind, customCategories).map((item) => ({ value: item.id, label: item.label }))} searchable allowDeselect={false} />
        <NumberInput label={`Amount in ${currency}`} value={amount} disabled={saving} onChange={(value) => setAmount(String(value))} required min={0} thousandSeparator="," decimalScale={2} />
        <TextInput label="Note" value={note} disabled={saving} onChange={(event) => setNote(event.target.value)} placeholder={kind === "expense" ? "Rent, subscription, or bill" : "Salary or regular income"} />
        <Select label="Repeats" value={schedule} disabled={saving} onChange={(value) => value && setSchedule(value)} data={scheduleOptions} allowDeselect={false} />
        <DatePickerInput label="First due date" description="The schedule advances from this date" value={startOn} onChange={(value) => setStartOn(value ?? "")} disabled={saving} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />
        <button className="primary-button" disabled={saving || !startOn}>{saving ? <><ButtonSpinner />Saving schedule…</> : <><Plus size={17} />{editing ? "Update schedule" : "Save recurring entry"}</>}</button>
        {editing && <button type="button" className="secondary-button" disabled={saving} onClick={resetForm}>Cancel editing</button>}
        {error && <div className="form-error" role="alert">{error}</div>}
      </form>
    </article>
    <article className="planner-content">
      <div className="section-heading"><div><span className="section-label">Confirm before logging</span><h2>Recurring entries</h2></div></div>
      <div className="recurring-list">{recurringEntries.map((entry) => {
        const ready = entry.nextDueOn <= today;
        const confirming = pendingEntry?.id === entry.id && pendingEntry.action === "confirm";
        const deleting = pendingEntry?.id === entry.id && pendingEntry.action === "delete";
        const definition = getCategory(entry.category, customCategories);
        return <article key={entry.id} aria-busy={confirming || deleting}>
          <div className="transaction-icon"><CategoryIcon category={entry.category} icon={definition.icon} /></div>
          <div>
            <strong>{entry.note || getCategory(entry.category, customCategories).label}</strong>
            <span>{formatMoney(entry.amountMinor, currency)} · {recurrenceLabel(entry)}</span>
            <small>{deleting ? "Removing…" : `Next: ${format(parseISO(entry.nextDueOn), "MMM d, yyyy")}`}</small>
          </div>
          <button className="secondary-button small" disabled={!ready || confirming || deleting} onClick={() => void runEntryAction(entry.id, "confirm")}>{confirming ? <><ButtonSpinner />Confirming…</> : ready ? <><Check size={15} />Confirm</> : "Scheduled"}</button>
          <button className="icon-button" disabled={confirming || deleting || saving} onClick={() => edit(entry)} aria-label={`Edit ${entry.note || "recurring entry"}`}><PencilSimple size={16} /></button>
          <button className="icon-button danger" disabled={confirming || deleting} onClick={() => void runEntryAction(entry.id, "delete")} aria-label={`Delete ${entry.note || "recurring entry"}`}>{deleting ? <ButtonSpinner /> : <Trash size={16} />}</button>
        </article>;
      })}</div>
      {!recurringEntries.length && <EmptyState title="Nothing repeats yet" />}
    </article>
  </section>;
}

function CalendarSection({ month, currency, transactions, onMonthChange }: PlanningPageProps) {
  const days = useMemo(() => eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) }), [month]);
  const firstOffset = getDay(days[0]);
  const totals = useMemo(() => dailyCashFlow(transactions), [transactions]);
  const [selected, setSelected] = useState<Date>(() => isSameMonth(new Date(), month) ? new Date() : startOfMonth(month));
  useEffect(() => { setSelected((current) => isSameMonth(current, month) ? current : startOfMonth(month)); }, [month]);
  const selectedKey = format(selected, "yyyy-MM-dd"); const selectedEntries = transactions.filter((item) => item.occurredOn === selectedKey); const selectedTotal = totals.get(selectedKey);
  const netAmount = (value: number) => `${currency} ${value < 0 ? "−" : ""}${formatMoney(Math.abs(value), currency, true).replace(currency, "").trim()}`;
  return <section className="calendar-layout"><article className="calendar-panel"><div className="calendar-heading"><MonthPicker month={month} onChange={onMonthChange} /></div><div className="weekday-row">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{Array.from({ length: firstOffset }).map((_, index) => <span key={`blank-${index}`} />)}{days.map((day) => {
    const key = format(day, "yyyy-MM-dd"); const total = totals.get(key);
    const netTone = !total ? "" : total.net > 0 ? "net-positive" : total.net < 0 ? "net-negative" : "net-balanced";
    const summary = total ? `Income ${formatMoney(total.income, currency)}, expenses ${formatMoney(total.expenses, currency)}, net ${total.net >= 0 ? "positive " : "negative "}${formatMoney(Math.abs(total.net), currency)}` : "No entries";
    return <button key={key} className={`${isSameDay(day, selected) ? "selected " : ""}${total ? `has-entries ${netTone}` : ""}`} onClick={() => setSelected(day)} aria-label={`${format(day, "MMMM d")}. ${summary}`}>
      <strong className="calendar-date">{format(day, "d")}</strong>
      {total && <span className="calendar-summary calendar-amount">{netAmount(total.net)}</span>}
    </button>;
  })}</div></article><aside className="calendar-day" aria-live="polite"><span className="section-label">{format(selected, "EEEE, MMMM d")}</span><h2>{selectedEntries.length ? `${selectedEntries.length} ${selectedEntries.length === 1 ? "entry" : "entries"}` : "A clear day"}</h2>{selectedTotal && <div className="calendar-day-summary"><span><small>Income</small><strong className="income calendar-amount">{formatMoney(selectedTotal.income, currency)}</strong></span><span><small>Expenses</small><strong className="expense calendar-amount">{formatMoney(selectedTotal.expenses, currency)}</strong></span><span><small>Net</small><strong className={`calendar-amount ${selectedTotal.net < 0 ? "expense" : selectedTotal.net > 0 ? "income" : ""}`}>{netAmount(selectedTotal.net)}</strong></span></div>}<div className="calendar-entry-list">{selectedEntries.map((item) => <div key={item.id}><span>{item.note || getCategory(item.category).label}</span><strong className={item.kind}>{item.kind === "income" ? "+" : "−"}{formatMoney(item.amountMinor, currency)}</strong></div>)}</div>{!selectedEntries.length && <p>No income or expenses logged.</p>}</aside></section>;
}
