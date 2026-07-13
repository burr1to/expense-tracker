import { CalendarDots, Check, Flag, Plus, Repeat, Trash } from "@phosphor-icons/react";
import { eachDayOfInterval, endOfMonth, format, getDay, isSameDay, parseISO, startOfMonth } from "date-fns";
import { useMemo, useState, type CSSProperties } from "react";
import { CategoryIcon } from "../components/CategoryIcon";
import { EmptyState } from "../components/EmptyState";
import { MonthPicker } from "../components/MonthPicker";
import { allCategoriesFor, getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { isInMonth, monthKey } from "../lib/dates";
import type { Budget, CurrencyCode, CustomCategory, LedgerTransaction, RecurringEntry, SavingsGoal, TransactionKind } from "../types";

type PlanTab = "budgets" | "goals" | "recurring" | "calendar";

interface PlanningPageProps {
  month: Date; currency: CurrencyCode; transactions: LedgerTransaction[]; budgets: Budget[]; recurringEntries: RecurringEntry[]; goals: SavingsGoal[]; customCategories: CustomCategory[];
  onMonthChange: (date: Date) => void;
  onSaveBudget: (draft: { category: string; amount: string; monthKey: string }, id?: string) => Promise<void>;
  onDeleteBudget: (id: string) => Promise<void>;
  onSaveRecurring: (draft: { kind: TransactionKind; category: string; amount: string; note: string; tags: string; dayOfMonth: number }, id?: string) => Promise<void>;
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

function BudgetsSection({ month, currency, transactions, budgets, customCategories, onSaveBudget, onDeleteBudget }: PlanningPageProps) {
  const [category, setCategory] = useState("food"); const [amount, setAmount] = useState(""); const [error, setError] = useState<string | null>(null);
  const currentBudgets = budgets.filter((item) => item.monthKey === monthKey(month));
  const expenses = transactions.filter((item) => item.kind === "expense" && isInMonth(item.occurredOn, month));
  const save = async (event: React.FormEvent) => { event.preventDefault(); try { setError(null); await onSaveBudget({ category, amount, monthKey: monthKey(month) }); setAmount(""); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save budget."); } };
  return <section className="planner-layout">
    <article className="planner-form-panel"><span className="section-label">NEW MONTHLY LIMIT</span><h2>Add a category budget</h2><form onSubmit={save} className="stack-form"><label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{allCategoriesFor("expense", customCategories).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><label><span>Amount in {currency}</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="15000" required /></label>{error && <div className="form-error">{error}</div>}<button className="primary-button"><Plus size={17} />Save budget</button></form></article>
    <article className="planner-content"><div className="section-heading"><div><span className="section-label">{format(month, "MMMM").toUpperCase()} BUDGETS</span><h2>Category guardrails</h2></div></div>
      {currentBudgets.map((budget) => { const spent = expenses.filter((item) => item.category === budget.category).reduce((sum, item) => sum + item.amountMinor, 0); const percentage = Math.round((spent / budget.amountMinor) * 100); const definition = getCategory(budget.category, customCategories); return <div className="budget-row" key={budget.id}><div className="transaction-icon" style={{ "--category-color": definition.color } as CSSProperties}><CategoryIcon category={budget.category} /></div><div><div><strong>{definition.label}</strong><span>{formatMoney(spent, currency)} of {formatMoney(budget.amountMinor, currency)}</span></div><div className="bar-track"><span className={percentage > 100 ? "over" : ""} style={{ width: `${Math.min(100, percentage)}%`, backgroundColor: definition.color }} /></div><small className={percentage > 100 ? "negative" : ""}>{percentage}% used</small></div><button className="icon-button danger" onClick={() => void onDeleteBudget(budget.id)} aria-label={`Delete ${definition.label} budget`}><Trash size={17} /></button></div>; })}
      {!currentBudgets.length && <EmptyState title="No budgets for this month" message="Add a category limit to see spending progress here." />}
    </article>
  </section>;
}

function GoalsSection({ currency, goals, onSaveGoal, onContribute, onDeleteGoal }: PlanningPageProps) {
  const [name, setName] = useState(""); const [target, setTarget] = useState(""); const [targetDate, setTargetDate] = useState(""); const [contributions, setContributions] = useState<Record<string, string>>({}); const [error, setError] = useState<string | null>(null);
  const save = async (event: React.FormEvent) => { event.preventDefault(); try { setError(null); await onSaveGoal({ name, target, saved: "0", targetDate }); setName(""); setTarget(""); setTargetDate(""); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save goal."); } };
  return <section className="planner-layout"><article className="planner-form-panel"><span className="section-label">NEW SAVINGS GOAL</span><h2>Give savings a purpose</h2><form onSubmit={save} className="stack-form"><label><span>Goal name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Emergency fund" required /></label><label><span>Target in {currency}</span><input inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="300000" required /></label><label><span>Target date <small>optional</small></span><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>{error && <div className="form-error">{error}</div>}<button className="primary-button"><Plus size={17} />Create goal</button></form></article><article className="planner-content"><div className="section-heading"><div><span className="section-label">SAVINGS GOALS</span><h2>What you’re building toward</h2></div></div><div className="goal-grid">{goals.map((goal) => { const percent = Math.round((goal.savedMinor / goal.targetMinor) * 100); return <article className="goal-card" key={goal.id}><button className="icon-button danger goal-delete" onClick={() => void onDeleteGoal(goal.id)} aria-label={`Delete ${goal.name}`}><Trash size={16} /></button><span>{percent}% complete</span><h3>{goal.name}</h3><strong>{formatMoney(goal.savedMinor, currency)}</strong><small>of {formatMoney(goal.targetMinor, currency)}{goal.targetDate ? ` · by ${format(parseISO(goal.targetDate), "MMM yyyy")}` : ""}</small><div className="bar-track"><span style={{ width: `${Math.min(100, percent)}%` }} /></div><div className="contribution-row"><input inputMode="decimal" placeholder="Add amount" value={contributions[goal.id] ?? ""} onChange={(event) => setContributions((current) => ({ ...current, [goal.id]: event.target.value }))} /><button onClick={() => void onContribute(goal.id, contributions[goal.id] ?? "").then(() => setContributions((current) => ({ ...current, [goal.id]: "" })))}>Add</button></div></article>; })}</div>{!goals.length && <EmptyState title="No savings goals yet" />}</article></section>;
}

function RecurringSection({ currency, recurringEntries, customCategories, onSaveRecurring, onDeleteRecurring, onConfirmRecurring }: PlanningPageProps) {
  const [kind, setKind] = useState<TransactionKind>("expense"); const [category, setCategory] = useState("housing"); const [amount, setAmount] = useState(""); const [note, setNote] = useState(""); const [day, setDay] = useState(1); const [error, setError] = useState<string | null>(null);
  const save = async (event: React.FormEvent) => { event.preventDefault(); try { setError(null); await onSaveRecurring({ kind, category, amount, note, tags: "", dayOfMonth: day }); setAmount(""); setNote(""); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save recurring entry."); } };
  const today = format(new Date(), "yyyy-MM-dd");
  return <section className="planner-layout"><article className="planner-form-panel"><span className="section-label">REPEAT MONTHLY</span><h2>Prepare a regular entry</h2><form onSubmit={save} className="stack-form"><div className="kind-toggle"><button type="button" className={kind === "expense" ? "active" : ""} onClick={() => { setKind("expense"); setCategory("housing"); }}>Expense</button><button type="button" className={kind === "income" ? "active" : ""} onClick={() => { setKind("income"); setCategory("salary"); }}>Income</button></div><label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{allCategoriesFor(kind, customCategories).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><label><span>Amount in {currency}</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label><label><span>Note</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Monthly rent" /></label><label><span>Day of month</span><input type="number" min="1" max="28" value={day} onChange={(event) => setDay(Number(event.target.value))} /></label>{error && <div className="form-error">{error}</div>}<button className="primary-button"><Plus size={17} />Save recurring entry</button></form></article><article className="planner-content"><div className="section-heading"><div><span className="section-label">CONFIRM BEFORE LOGGING</span><h2>Recurring entries</h2></div></div><div className="recurring-list">{recurringEntries.map((entry) => { const ready = entry.nextDueOn <= today; return <article key={entry.id}><div className="transaction-icon"><CategoryIcon category={entry.category} /></div><div><strong>{entry.note || getCategory(entry.category, customCategories).label}</strong><span>{formatMoney(entry.amountMinor, currency)} · monthly on day {entry.dayOfMonth}</span><small>Next: {format(parseISO(entry.nextDueOn), "MMM d, yyyy")}</small></div><button className="secondary-button small" disabled={!ready} onClick={() => void onConfirmRecurring(entry.id)}>{ready ? <><Check size={15} />Confirm</> : "Scheduled"}</button><button className="icon-button danger" onClick={() => void onDeleteRecurring(entry.id)} aria-label={`Delete ${entry.note}`}><Trash size={16} /></button></article>; })}</div>{!recurringEntries.length && <EmptyState title="Nothing repeats yet" />}</article></section>;
}

function CalendarSection({ month, currency, transactions, onMonthChange }: PlanningPageProps) {
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) }); const firstOffset = getDay(days[0]);
  const totals = useMemo(() => new Map(days.map((day) => [format(day, "yyyy-MM-dd"), transactions.filter((item) => item.kind === "expense" && item.occurredOn === format(day, "yyyy-MM-dd")).reduce((sum, item) => sum + item.amountMinor, 0)])), [days, transactions]);
  const [selected, setSelected] = useState<Date>(new Date()); const selectedKey = format(selected, "yyyy-MM-dd"); const selectedEntries = transactions.filter((item) => item.occurredOn === selectedKey);
  return <section className="calendar-layout"><article className="calendar-panel"><div className="calendar-heading"><MonthPicker month={month} onChange={onMonthChange} /></div><div className="weekday-row">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{Array.from({ length: firstOffset }).map((_, index) => <span key={`blank-${index}`} />)}{days.map((day) => { const key = format(day, "yyyy-MM-dd"); const total = totals.get(key) ?? 0; return <button key={key} className={isSameDay(day, selected) ? "selected" : ""} onClick={() => setSelected(day)}><strong>{format(day, "d")}</strong>{total > 0 && <span>{formatMoney(total, currency, true)}</span>}</button>; })}</div></article><aside className="calendar-day"><span className="section-label">{format(selected, "EEEE, MMMM d")}</span><h2>{selectedEntries.length ? `${selectedEntries.length} entries` : "A clear day"}</h2>{selectedEntries.map((item) => <div key={item.id}><span>{item.note || getCategory(item.category).label}</span><strong className={item.kind}>{item.kind === "income" ? "+" : "−"}{formatMoney(item.amountMinor, currency)}</strong></div>)}{!selectedEntries.length && <p>No income or expenses logged.</p>}</aside></section>;
}
