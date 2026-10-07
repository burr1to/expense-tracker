import { ArrowCounterClockwise, ChartPieSlice, CheckCircle, Calculator, CreditCard, HandCoins, MapTrifold, Plus, ShieldCheck, SlidersHorizontal, Target, Trash, WarningCircle } from "@phosphor-icons/react";
import { Checkbox, NumberInput, Select, Slider, TextInput } from "@mantine/core";
import { addMonths, format, parseISO } from "date-fns";
import { useContext, useRef, useState } from "react";
import { LedgerWorkspaceContext } from "../context/LedgerWorkspaceContext";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { LedgerDatePickerInput as DatePickerInput } from "../components/LedgerDatePickerInput";
import { calculateAllocationAmounts, minorToMajorInput } from "../lib/allocation-calculator";
import { averagingWindowLabel, calculateCategoryMonthlyAverages, calculateDebtPayoff, calculateEmergencyFund, calculateEqualSplit, calculateGoalPace, completedMonthsWindow } from "../lib/financial-calculators";
import { getCategory, spendingCategoriesFor } from "../lib/categories";
import { formatMoney, majorToMinor } from "../lib/currency";
import { monthKey, todayInput } from "../lib/dates";
import { transactionCountsTowardBudget } from "../lib/household";
import { simulateWhatIf } from "../lib/what-if";
import type { CurrencyCode, CustomCategory, LedgerTransaction, SavingsGoal } from "../types";
import { FormError } from "../components/FormError";

interface GoalDraft {
  name: string;
  target: string;
  saved: string;
  targetDate: string;
}

interface BudgetDraft {
  category: string;
  amount: string;
}

type CalculatorTool = "split" | "goal-pace" | "budgets" | "what-if" | "debt" | "trip" | "runway" | "bills";

interface CalculatorPageProps {
  currency: CurrencyCode;
  month: Date;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  goals?: SavingsGoal[];
  onSaveGoal: (draft: GoalDraft) => Promise<void>;
  /** Saves every chosen budget for one month in a single request. */
  onSaveBudgets: (monthKey: string, drafts: BudgetDraft[]) => Promise<void>;
}

interface CalculatorRow {
  id: string;
  name: string;
  percentage: string;
}

const DEFAULT_ROWS: CalculatorRow[] = [
  { id: "essentials", name: "Essentials", percentage: "50" },
  { id: "lifestyle", name: "Lifestyle", percentage: "30" },
  { id: "goals", name: "Goals", percentage: "20" },
];
const ROW_COLORS = ["#3f6653", "#8f4c49", "#80635b", "#557f69", "#a77662"];
const percentageValue = (value: string) => {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};
const toolItems: { id: CalculatorTool; label: string; description: string; icon: typeof Calculator }[] = [
  { id: "split", label: "Split amount", description: "Allocate by percentage", icon: Calculator },
  { id: "goal-pace", label: "Goal pace", description: "Find your monthly target", icon: Target },
  { id: "budgets", label: "Smart budgets", description: "Use your spending history", icon: ChartPieSlice },
  { id: "what-if", label: "What if", description: "Test a spending change", icon: SlidersHorizontal },
  { id: "debt", label: "Debt payoff", description: "Estimate time and interest", icon: CreditCard },
  { id: "trip", label: "Trip / event", description: "Plan a shared budget", icon: MapTrifold },
  { id: "runway", label: "Emergency fund", description: "Measure your runway", icon: ShieldCheck },
  { id: "bills", label: "Split a bill", description: "Divide a bill fairly", icon: HandCoins },
];

export function CalculatorPage({ currency, month, transactions, customCategories, goals = [], onSaveGoal, onSaveBudgets }: CalculatorPageProps) {
  const [tool, setTool] = useState<CalculatorTool>("split");
  return <div className="page calculator-page">
    <header className="page-header calculator-main-header">
      <div><span className="eyebrow">Decision tools for your money</span><h1>Calculator</h1><p>Turn an amount, a goal, or a bill into a clear next step.</p></div>
    </header>
    <nav className="calculator-tool-tabs" aria-label="Calculator tools">
      {toolItems.map(({ id, label, description, icon: Icon }) => <button type="button" key={id} className={tool === id ? "active" : ""} onClick={() => setTool(id)} aria-pressed={tool === id}><Icon size={17} /><span><strong>{label}</strong><small>{description}</small></span></button>)}
    </nav>
    {tool === "split" && <SplitCalculator currency={currency} onSaveGoal={onSaveGoal} />}
    {tool === "goal-pace" && <GoalPaceCalculator currency={currency} onSaveGoal={onSaveGoal} />}
    {tool === "budgets" && <SmartBudgetCalculator currency={currency} month={month} transactions={transactions} customCategories={customCategories} onSaveBudgets={onSaveBudgets} />}
    {tool === "what-if" && <WhatIfCalculator currency={currency} transactions={transactions} customCategories={customCategories} goals={goals} />}
    {tool === "debt" && <DebtCalculator currency={currency} />}
    {tool === "trip" && <TripCalculator currency={currency} onSaveGoal={onSaveGoal} />}
    {tool === "runway" && <EmergencyFundCalculator currency={currency} onSaveGoal={onSaveGoal} />}
    {tool === "bills" && <BillSplitCalculator currency={currency} />}
  </div>;
}

function ToolHeading({ step, title, description }: { step: string; title: string; description: string }) {
  return <div className="calculator-tool-heading"><span className="section-label">{step}</span><h2>{title}</h2><p>{description}</p></div>;
}

function ToolMessage({ error, success }: { error: string | null; success: string | null }) {
  return <><FormError message={error} />{success && <div className="form-success" role="status"><CheckCircle size={17} />{success}</div>}</>;
}

function SplitCalculator({ currency, onSaveGoal }: { currency: CurrencyCode; onSaveGoal: CalculatorPageProps["onSaveGoal"] }) {
  const [total, setTotal] = useState("");
  const [rows, setRows] = useState<CalculatorRow[]>(DEFAULT_ROWS);
  const [goalName, setGoalName] = useState("My allocation");
  const [targetDate, setTargetDate] = useState("");
  const [creationMode, setCreationMode] = useState<"single" | "rows" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const nextRowId = useRef(1);
  const totalMinor = majorToMinor(total);
  const percentages = rows.map((row) => percentageValue(row.percentage));
  const amounts = calculateAllocationAmounts(totalMinor, percentages);
  const percentageTotal = Math.round(percentages.reduce((sum, percentage) => sum + percentage, 0) * 100) / 100;
  const allocatedMinor = amounts.reduce((sum, amount) => sum + amount, 0);
  const remainderMinor = totalMinor - allocatedMinor;
  const activeRows = rows.map((row, index) => ({ ...row, percentageValue: percentages[index] ?? 0, amountMinor: amounts[index] ?? 0 })).filter((row) => row.percentageValue > 0 && row.amountMinor > 0);
  const unnamedRows = activeRows.filter((row) => !row.name.trim());
  const percentagesOver = percentageTotal > 100;
  const canCreateSingleGoal = totalMinor > 0 && !percentagesOver && !creationMode;
  const canCreateRowGoals = activeRows.length > 0 && !unnamedRows.length && !percentagesOver && !creationMode;
  const updateRow = (id: string, changes: Partial<CalculatorRow>) => { setRows((current) => current.map((row) => row.id === id ? { ...row, ...changes } : row)); setSuccess(null); };
  const addRow = () => { setRows((current) => [...current, { id: `row-${nextRowId.current++}`, name: "", percentage: "0" }]); setSuccess(null); };
  const removeRow = (id: string) => { if (rows.length === 1) return; setRows((current) => current.filter((row) => row.id !== id)); setSuccess(null); };
  const createGoals = async (mode: "single" | "rows") => {
    if (mode === "single" && !canCreateSingleGoal) return;
    if (mode === "rows" && !canCreateRowGoals) return;
    const drafts: GoalDraft[] = mode === "single" ? [{ name: goalName.trim() || "My allocation", target: minorToMajorInput(totalMinor), saved: "0", targetDate }] : activeRows.map((row) => ({ name: row.name.trim(), target: minorToMajorInput(row.amountMinor), saved: "0", targetDate }));
    let createdCount = 0;
    setCreationMode(mode); setError(null); setSuccess(null);
    try {
      for (const draft of drafts) { await onSaveGoal(draft); createdCount += 1; }
      setSuccess(mode === "single" ? `Created “${drafts[0].name}” as a savings goal. Open Plans to see it.` : `Created ${createdCount} savings goals from your split.`);
    } catch (caught) {
      setError(createdCount ? `Created ${createdCount} goal${createdCount === 1 ? "" : "s"}, but the next one could not be saved. ${caught instanceof Error ? caught.message : "Please try again."}` : caught instanceof Error ? caught.message : "Could not create the goal.");
    } finally { setCreationMode(null); }
  };
  return <section className="calculator-layout">
    <article className="calculator-editor">
      <ToolHeading step="1. Start with an amount" title="How much are you planning?" description="Every row updates instantly as you change the total or percentage." />
      <NumberInput label={`Amount in ${currency}`} value={total} onChange={(value) => { setTotal(String(value)); setSuccess(null); }} placeholder="100,000" min={0} thousandSeparator="," decimalScale={2} className="calculator-total-input" />
      <div className="calculator-section-heading calculator-split-heading"><div><span className="section-label">2. Set the split</span><h2>Give every rupee a job</h2></div><button type="button" className="secondary-button small" onClick={addRow}><Plus size={15} />Add row</button></div>
      <div className="calculator-row-list">{rows.map((row, index) => <div className="calculator-row" key={row.id}>
        <span className="calculator-row-number">{String(index + 1).padStart(2, "0")}</span>
        <TextInput aria-label={`Row ${index + 1} name`} value={row.name} onChange={(event) => updateRow(row.id, { name: event.currentTarget.value })} placeholder="e.g. Rent" />
        <NumberInput aria-label={`${row.name || `Row ${index + 1}`} percentage`} value={row.percentage} onChange={(value) => updateRow(row.id, { percentage: String(value) })} min={0} max={100} decimalScale={2} rightSection={<span className="calculator-percent-suffix">%</span>} />
        <div className="calculator-row-result"><strong className="calculator-row-amount">{formatMoney(amounts[index] ?? 0, currency)}</strong><small>{percentages[index] ?? 0}%</small></div>
        <button type="button" className="icon-button danger" disabled={rows.length === 1} onClick={() => removeRow(row.id)} aria-label={`Remove ${row.name || `row ${index + 1}`}`}><Trash size={16} /></button>
        <div className="calculator-row-track" aria-hidden="true"><span style={{ width: `${Math.min(100, percentages[index] ?? 0)}%`, backgroundColor: ROW_COLORS[index % ROW_COLORS.length] }} /></div>
      </div>)}</div>
      <div className={`calculator-allocation-note ${percentagesOver ? "is-over" : ""}`} role="status">{percentagesOver ? <WarningCircle size={18} /> : <Target size={18} />}<span>{percentagesOver ? `Your rows are ${percentageTotal - 100}% over the total. Reduce a percentage to continue.` : remainderMinor > 0 ? `${percentageTotal}% is assigned. ${formatMoney(remainderMinor, currency)} stays unassigned for now.` : "The split is balanced. Every part of this amount has a job."}</span></div>
    </article>
    <aside className="calculator-goal-panel"><span className="section-label">3. Make it actionable</span><h2>Turn the calculation into goals</h2><p>A goal is a plan only; creating one does not move money or record a contribution.</p><div className="stack-form">
      <TextInput label="Single goal name" value={goalName} onChange={(event) => setGoalName(event.currentTarget.value)} placeholder="My allocation" disabled={Boolean(creationMode)} />
      <DatePickerInput label="Target date" description="Optional — applies to every goal created here" value={targetDate || null} onChange={(value) => setTargetDate(value ?? "")} disabled={Boolean(creationMode)} clearable valueFormat="MMM D, YYYY" firstDayOfWeek={0} />
      <div className="calculator-goal-total"><span>One goal target</span><strong className="calculator-money">{formatMoney(totalMinor, currency)}</strong></div>
      <button type="button" className="primary-button" disabled={!canCreateSingleGoal} onClick={() => void createGoals("single")}>{creationMode === "single" ? <><ButtonSpinner />Creating goal…</> : <><Target size={17} />Create one goal</>}</button>
      <button type="button" className="secondary-button" disabled={!canCreateRowGoals} onClick={() => void createGoals("rows")}>{creationMode === "rows" ? <><ButtonSpinner />Creating goals…</> : <><CheckCircle size={17} />Create {activeRows.length || "row"} goal{activeRows.length === 1 ? "" : "s"}</>}</button>
    </div>{unnamedRows.length > 0 && !percentagesOver && <p className="calculator-helper-warning">Name every row with a percentage before creating one goal per row.</p>}<ToolMessage error={error} success={success} /></aside>
  </section>;
}

function GoalPaceCalculator({ currency, onSaveGoal }: { currency: CurrencyCode; onSaveGoal: CalculatorPageProps["onSaveGoal"] }) {
  const [name, setName] = useState("Savings goal");
  const [target, setTarget] = useState("");
  const [saved, setSaved] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const targetMinor = majorToMinor(target);
  const savedMinor = Math.min(targetMinor, majorToMinor(saved));
  const pace = calculateGoalPace(targetMinor, savedMinor, targetDate);
  const ready = targetMinor > 0 && Boolean(targetDate) && !saving;
  const saveGoal = async () => {
    if (!ready) return;
    setSaving(true); setError(null); setSuccess(null);
    try { await onSaveGoal({ name: name.trim() || "Savings goal", target: minorToMajorInput(targetMinor), saved: minorToMajorInput(savedMinor), targetDate }); setSuccess("Goal created with your opening balance and target date."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create the goal."); }
    finally { setSaving(false); }
  };
  return <section className="calculator-tool-layout">
    <article className="calculator-tool-panel"><ToolHeading step="Goal pace" title="How much do I need to save?" description="Set a target date and get the monthly and weekly pace that closes the gap." /><div className="calculator-form-grid">
      <TextInput label="Goal name" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="New laptop" disabled={saving} />
      <NumberInput label={`Target in ${currency}`} value={target} onChange={(value) => setTarget(String(value))} placeholder="300,000" min={0} thousandSeparator="," decimalScale={2} disabled={saving} />
      <NumberInput label={`Already saved in ${currency}`} value={saved} onChange={(value) => setSaved(String(value))} placeholder="0" min={0} thousandSeparator="," decimalScale={2} disabled={saving} />
      <DatePickerInput label="Target date" value={targetDate || null} onChange={(value) => setTargetDate(value ?? "")} minDate={new Date()} clearable disabled={saving} valueFormat="MMM D, YYYY" firstDayOfWeek={0} />
    </div><div className="calculator-tool-actions"><button type="button" className="primary-button" disabled={!ready} onClick={() => void saveGoal()}>{saving ? <><ButtonSpinner />Creating goal…</> : <><Target size={17} />Create this goal</>}</button></div><ToolMessage error={error} success={success} /></article>
    <aside className="calculator-result-panel"><span className="section-label">Your pace</span><h2>{pace.isComplete ? "Already complete" : pace.isPastDue ? "Target date has passed" : targetDate ? `${pace.monthsRemaining} month${pace.monthsRemaining === 1 ? "" : "s"} to go` : "Choose a target date"}</h2><div className="calculator-stat-grid"><div className="calculator-stat"><span>Still needed</span><strong className="calculator-money">{formatMoney(pace.remainingMinor, currency)}</strong></div><div className="calculator-stat"><span>Monthly pace</span><strong className="calculator-money">{targetDate && !pace.isComplete ? formatMoney(pace.monthlyMinor, currency) : "—"}</strong></div><div className="calculator-stat"><span>Weekly pace</span><strong className="calculator-money">{targetDate && !pace.isComplete ? formatMoney(pace.weeklyMinor, currency) : "—"}</strong></div></div><p className="calculator-note">This is a planning estimate. Contributions still need to be added from Plans → Goals.</p></aside>
  </section>;
}

function SmartBudgetCalculator({ currency, month, transactions, customCategories, onSaveBudgets }: { currency: CurrencyCode; month: Date; transactions: LedgerTransaction[]; customCategories: CustomCategory[]; onSaveBudgets: CalculatorPageProps["onSaveBudgets"] }) {
  const [lookback, setLookback] = useState("3");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const today = todayInput();
  // Saved budgets are personal: they count only your own non-Ours entries, and the batch refuses a category you cannot budget (a partner's custom one, loans).
  const viewerId = useContext(LedgerWorkspaceContext)?.ledger.profile.id;
  const own = viewerId ? transactions.filter((item) => transactionCountsTowardBudget(item, { userId: viewerId, shared: false })) : transactions;
  const budgetable = new Set(spendingCategoriesFor("expense", customCategories).map((item) => item.id));
  const basis = completedMonthsWindow(own, Number(lookback), today);
  const basisLabel = averagingWindowLabel(basis);
  const rows = calculateCategoryMonthlyAverages(own, Number(lookback), today).filter((item) => budgetable.has(item.category)).map((item) => ({ ...item, label: getCategory(item.category, customCategories).label, amount: edits[item.category] ?? minorToMajorInput(item.averageMinor), included: !skipped.has(item.category) }));
  const chosen = rows.filter((row) => row.included && majorToMinor(row.amount) > 0);
  const change = () => { setSuccess(null); setError(null); };
  const toggle = (category: string, included: boolean) => { setSkipped((current) => { const next = new Set(current); if (included) next.delete(category); else next.add(category); return next; }); change(); };
  const saveBudgets = async () => {
    if (!chosen.length || saving) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      await onSaveBudgets(monthKey(month), chosen.map((row) => ({ category: row.category, amount: row.amount })));
      setSuccess(`Saved ${chosen.length} ${chosen.length === 1 ? "budget" : "budgets"} for ${format(month, "MMMM yyyy")}. See them in Plan → Budgets.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save budgets."); }
    finally { setSaving(false); }
  };
  return <section className="calculator-tool-layout">
    <article className="calculator-tool-panel"><ToolHeading step="Smart budgets" title="Let your history suggest a limit" description="Averages come from complete months only, so a half-finished month never drags a suggestion down. Untick or adjust any row before saving." /><Select label="Look back over" value={lookback} onChange={(value) => { if (value) { setLookback(value); setEdits({}); change(); } }} data={[{ value: "3", label: "3 months" }, { value: "6", label: "6 months" }, { value: "12", label: "12 months" }]} allowDeselect={false} disabled={saving} /><div className="calculator-tool-actions"><button type="button" className="primary-button" disabled={!chosen.length || saving} onClick={() => void saveBudgets()}>{saving ? <><ButtonSpinner />Saving budgets…</> : <><ChartPieSlice size={17} />Save {chosen.length || ""} {chosen.length === 1 ? "budget" : "budgets"} for {format(month, "MMMM")}</>}</button></div><ToolMessage error={error} success={success} /></article>
    <aside className="calculator-result-panel"><span className="section-label">Suggested budgets</span><h2>{rows.length ? `Based on ${basisLabel}` : "Not enough history yet"}</h2>{rows.length > 0 && basis.months < Number(lookback) && <p className="calculator-note smart-budget-basis">Only {basis.months} complete {basis.months === 1 ? "month" : "months"} of history so far, so each average covers {basis.months === 1 ? "that month" : "those months"}.</p>}{rows.length ? <div className="smart-budget-list">{rows.map((row) => <div className={`smart-budget-row${row.included ? "" : " is-off"}`} key={row.category}>
      <Checkbox checked={row.included} onChange={(event) => toggle(row.category, event.currentTarget.checked)} disabled={saving} aria-label={`Include ${row.label}`} />
      <div><strong>{row.label}</strong><small><span className="calculator-money">{formatMoney(row.averageMinor, currency)}</span> a month on average</small></div>
      <NumberInput aria-label={`${row.label} budget in ${currency}`} value={row.amount} onChange={(value) => { setEdits((current) => ({ ...current, [row.category]: String(value) })); change(); }} min={0} thousandSeparator="," decimalScale={2} disabled={!row.included || saving} />
    </div>)}</div> : <p className="calculator-empty">{basis.months === 0 && own.length ? "Suggestions start once your first full month of spending is logged." : "Add a few expense transactions and this tool will turn them into starting budgets."}</p>}<p className="calculator-note">Existing budgets for the same month and category are updated, not duplicated.</p></aside>
  </section>;
}

function WhatIfCalculator({ currency, transactions, customCategories, goals }: { currency: CurrencyCode; transactions: LedgerTransaction[]; customCategories: CustomCategory[]; goals: SavingsGoal[] }) {
  const [lookback, setLookback] = useState("3");
  const [changes, setChanges] = useState<Record<string, number>>({});
  const lookbackMonths = Number(lookback) || 3;
  const today = todayInput();
  const topCategories = calculateCategoryMonthlyAverages(transactions, lookbackMonths, today).slice(0, 5);
  const adjustments = topCategories.map((item) => ({ category: item.category, changePercent: changes[item.category] ?? 0 }));
  const result = simulateWhatIf(adjustments, transactions, goals, lookbackMonths, today);
  const basedOnLabel = averagingWindowLabel(result.basedOn);
  const touched = adjustments.some((adjustment) => adjustment.changePercent !== 0);
  const monthLabel = (value: string | null) => value ? format(parseISO(value), "MMM yyyy") : null;
  const shiftLabel = (monthsSaved: number | null) => !monthsSaved ? null : `${Math.abs(monthsSaved)} month${Math.abs(monthsSaved) === 1 ? "" : "s"} ${monthsSaved > 0 ? "earlier" : "later"}`;
  return <section className="calculator-tool-layout">
    <article className="calculator-tool-panel">
      <ToolHeading step="What if" title="Test a spending change before you make it" description="Move a slider to see what cutting or growing a category would do to your monthly net and your goal dates." />
      <Select label="Base it on" value={lookback} onChange={(value) => { if (value) setLookback(value); }} data={[{ value: "3", label: "Last 3 months" }, { value: "6", label: "Last 6 months" }, { value: "12", label: "Last 12 months" }]} allowDeselect={false} />
      {topCategories.length ? <div className="what-if-slider-list">{topCategories.map((item) => {
        const changePercent = changes[item.category] ?? 0;
        const label = getCategory(item.category, customCategories).label;
        const projectedMinor = Math.max(0, Math.round(item.averageMinor * (1 + changePercent / 100)));
        return <div className="what-if-slider" key={item.category}>
          <div className="what-if-slider-head"><strong>{label}</strong><span>{formatMoney(item.averageMinor, currency)} → <strong className="calculator-money">{formatMoney(projectedMinor, currency)}</strong> <small>{changePercent > 0 ? "+" : ""}{changePercent}%</small></span></div>
          <Slider value={changePercent} onChange={(value) => setChanges((current) => ({ ...current, [item.category]: value }))} min={-100} max={100} step={5} thumbLabel={`${label} change percentage`} label={(value) => `${value > 0 ? "+" : ""}${value}%`} marks={[{ value: -100 }, { value: 0 }, { value: 100 }]} />
        </div>;
      })}</div> : <p className="calculator-empty what-if-empty">No expense history in this period yet. Add a few expenses and your top categories will appear here as sliders.</p>}
      <div className="calculator-tool-actions"><button type="button" className="secondary-button" disabled={!touched} onClick={() => setChanges({})}><ArrowCounterClockwise size={16} />Reset sliders</button></div>
    </article>
    <aside className="calculator-result-panel">
      <span className="section-label">If nothing else changes{basedOnLabel ? ` · based on ${basedOnLabel}` : ""}</span>
      <h2 className="calculator-money">{result.deltaMinor > 0 ? "+" : ""}{formatMoney(result.deltaMinor, currency)}<small className="what-if-heading-unit"> / month</small></h2>
      <div className="calculator-stat-grid">
        <div className="calculator-stat"><span>Money freed</span><strong className="calculator-money">{result.deltaMinor > 0 ? "+" : ""}{formatMoney(result.deltaMinor, currency)}</strong></div>
        <div className="calculator-stat"><span>New monthly net</span><strong className="calculator-money">{formatMoney(result.scenarioMonthlyNetMinor, currency)}</strong></div>
        <div className="calculator-stat"><span>Was</span><strong className="calculator-money">{formatMoney(result.baselineMonthlyNetMinor, currency)}</strong></div>
      </div>
      <div className="what-if-goals">
        <span className="section-label">Goal dates</span>
        {goals.length ? <div className="calculator-data-list">{result.goals.map((projection) => <div className="calculator-data-row" key={projection.goal.id}>
          <div><strong>{projection.goal.name}</strong><small>{monthLabel(projection.baselineDate) ? `Now on track for ${monthLabel(projection.baselineDate)}` : "No date can be estimated at the current rate"}</small></div>
          <strong className="calculator-money">{monthLabel(projection.scenarioDate) ?? "—"}{shiftLabel(projection.monthsSaved) && <small> · {shiftLabel(projection.monthsSaved)}</small>}</strong>
        </div>)}</div> : <p className="calculator-empty">Create a savings goal in Plans to see how a spending change moves its date.</p>}
      </div>
      {result.warnings.map((warning) => <div className="calculator-warning" key={warning} role="status"><WarningCircle size={18} /><span>{warning}</span></div>)}
      <p className="calculator-note">This is an estimate built from your average income and spending over {basedOnLabel || "your complete months"}, not a forecast. The current month is left out until it ends. It assumes your income and every other category stay exactly as they were.</p>
    </aside>
  </section>;
}

function DebtCalculator({ currency }: { currency: CurrencyCode }) {
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("12");
  const [payment, setPayment] = useState("");
  const result = calculateDebtPayoff(majorToMinor(principal), Number(rate) || 0, majorToMinor(payment));
  const payoffDate = result.months ? format(addMonths(new Date(), result.months), "MMM yyyy") : "—";
  return <section className="calculator-tool-layout">
    <article className="calculator-tool-panel"><ToolHeading step="Debt payoff" title="What will this debt cost?" description="Estimate payoff time and interest from the balance, annual rate, and payment you can make each month." /><div className="calculator-form-grid"><NumberInput label={`Current balance in ${currency}`} value={principal} onChange={(value) => setPrincipal(String(value))} placeholder="100,000" min={0} thousandSeparator="," decimalScale={2} /><NumberInput label="Annual interest rate" value={rate} onChange={(value) => setRate(String(value))} placeholder="12" min={0} decimalScale={2} rightSection={<span className="calculator-percent-suffix">%</span>} /><NumberInput label={`Monthly payment in ${currency}`} value={payment} onChange={(value) => setPayment(String(value))} placeholder="10,000" min={0} thousandSeparator="," decimalScale={2} /></div>{result.impossible && <div className="calculator-warning"><WarningCircle size={18} /><span>This payment does not cover the first month’s interest. Increase the payment before relying on this estimate.</span></div>}</article>
    <aside className="calculator-result-panel"><span className="section-label">Estimated payoff</span><h2>{result.impossible ? "Payment is too low" : result.months ? `${result.months} month${result.months === 1 ? "" : "s"}` : "Enter your debt details"}</h2><div className="calculator-stat-grid"><div className="calculator-stat"><span>Total paid</span><strong className="calculator-money">{result.impossible ? "—" : formatMoney(result.totalPaidMinor, currency)}</strong></div><div className="calculator-stat"><span>Interest</span><strong className="calculator-money">{result.impossible ? "—" : formatMoney(result.interestMinor, currency)}</strong></div><div className="calculator-stat"><span>Payoff around</span><strong>{result.impossible ? "—" : payoffDate}</strong></div></div><p className="calculator-note">Estimate only: lender fees, changing rates, and payment timing can change the real result.</p></aside>
  </section>;
}

function TripCalculator({ currency, onSaveGoal }: { currency: CurrencyCode; onSaveGoal: CalculatorPageProps["onSaveGoal"] }) {
  const [name, setName] = useState("Trip budget");
  const [budget, setBudget] = useState("");
  const [people, setPeople] = useState("2");
  const [days, setDays] = useState("3");
  const [buffer, setBuffer] = useState("10");
  const [targetDate, setTargetDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const split = calculateEqualSplit(majorToMinor(budget), Number(people) || 1, Number(buffer) || 0);
  const daysValue = Math.max(1, Math.floor(Number(days) || 1));
  const perPersonMinor = split.sharesMinor[0] ?? 0;
  const perPersonPerDayMinor = Math.ceil(perPersonMinor / daysValue);
  const ready = split.totalMinor > 0 && !saving;
  const saveGoal = async () => {
    if (!ready) return;
    setSaving(true); setError(null); setSuccess(null);
    try { await onSaveGoal({ name: name.trim() || "Trip budget", target: minorToMajorInput(split.totalMinor), saved: "0", targetDate }); setSuccess("Trip budget created as a savings goal."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create the trip goal."); }
    finally { setSaving(false); }
  };
  return <section className="calculator-tool-layout">
    <article className="calculator-tool-panel"><ToolHeading step="Trip or event" title="Plan the whole experience" description="Add a buffer, see the per-person cost, and optionally turn the total into a goal." /><div className="calculator-form-grid"><TextInput label="Trip or event name" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="Pokhara weekend" disabled={saving} /><NumberInput label={`Base budget in ${currency}`} value={budget} onChange={(value) => setBudget(String(value))} placeholder="60,000" min={0} thousandSeparator="," decimalScale={2} disabled={saving} /><NumberInput label="People" value={people} onChange={(value) => setPeople(String(value))} min={1} step={1} decimalScale={0} disabled={saving} /><NumberInput label="Days" value={days} onChange={(value) => setDays(String(value))} min={1} step={1} decimalScale={0} disabled={saving} /><NumberInput label="Buffer" value={buffer} onChange={(value) => setBuffer(String(value))} min={0} max={100} decimalScale={2} rightSection={<span className="calculator-percent-suffix">%</span>} disabled={saving} /><DatePickerInput label="Target date" description="Optional" value={targetDate || null} onChange={(value) => setTargetDate(value ?? "")} clearable disabled={saving} valueFormat="MMM D, YYYY" firstDayOfWeek={0} /></div><div className="calculator-tool-actions"><button type="button" className="primary-button" disabled={!ready} onClick={() => void saveGoal()}>{saving ? <><ButtonSpinner />Creating goal…</> : <><MapTrifold size={17} />Create trip goal</>}</button></div><ToolMessage error={error} success={success} /></article>
    <aside className="calculator-result-panel"><span className="section-label">Trip snapshot</span><h2 className="calculator-money">{formatMoney(split.totalMinor, currency)}</h2><div className="calculator-stat-grid"><div className="calculator-stat"><span>Buffer</span><strong className="calculator-money">{formatMoney(split.tipMinor, currency)}</strong></div><div className="calculator-stat"><span>Per person</span><strong className="calculator-money">{formatMoney(perPersonMinor, currency)}</strong></div><div className="calculator-stat"><span>Per person / day</span><strong className="calculator-money">{formatMoney(perPersonPerDayMinor, currency)}</strong></div></div><p className="calculator-note">For category-by-category planning, use Split amount and name rows like travel, stay, food, and activities.</p></aside>
  </section>;
}

function EmergencyFundCalculator({ currency, onSaveGoal }: { currency: CurrencyCode; onSaveGoal: CalculatorPageProps["onSaveGoal"] }) {
  const [savings, setSavings] = useState("");
  const [essentials, setEssentials] = useState("");
  const [targetMonths, setTargetMonths] = useState("6");
  const [name, setName] = useState("Emergency fund");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const result = calculateEmergencyFund(majorToMinor(savings), majorToMinor(essentials), Number(targetMonths) || 1);
  const targetDate = format(addMonths(new Date(), Math.max(1, Math.floor(Number(targetMonths) || 1))), "yyyy-MM-dd");
  const ready = result.targetMinor > 0 && !saving;
  const saveGoal = async () => {
    if (!ready) return;
    setSaving(true); setError(null); setSuccess(null);
    try { await onSaveGoal({ name: name.trim() || "Emergency fund", target: minorToMajorInput(result.targetMinor), saved: minorToMajorInput(Math.min(result.targetMinor, majorToMinor(savings))), targetDate }); setSuccess("Emergency-fund goal created with a target date based on your runway plan."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create the emergency-fund goal."); }
    finally { setSaving(false); }
  };
  return <section className="calculator-tool-layout">
    <article className="calculator-tool-panel"><ToolHeading step="Emergency fund" title="How long could you breathe?" description="Measure how many months your current savings covers and what it takes to reach your safety target." /><div className="calculator-form-grid"><TextInput label="Goal name" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="Emergency fund" disabled={saving} /><NumberInput label={`Current emergency savings in ${currency}`} value={savings} onChange={(value) => setSavings(String(value))} placeholder="150,000" min={0} thousandSeparator="," decimalScale={2} disabled={saving} /><NumberInput label={`Essential monthly expenses in ${currency}`} value={essentials} onChange={(value) => setEssentials(String(value))} placeholder="50,000" min={0} thousandSeparator="," decimalScale={2} disabled={saving} /><NumberInput label="Target coverage" value={targetMonths} onChange={(value) => setTargetMonths(String(value))} min={1} step={1} decimalScale={0} rightSection={<span className="calculator-percent-suffix">months</span>} disabled={saving} /></div><div className="calculator-tool-actions"><button type="button" className="primary-button" disabled={!ready} onClick={() => void saveGoal()}>{saving ? <><ButtonSpinner />Creating goal…</> : <><ShieldCheck size={17} />Create emergency-fund goal</>}</button></div><ToolMessage error={error} success={success} /></article>
    <aside className="calculator-result-panel"><span className="section-label">Your runway</span><h2>{result.coveredMonths === null ? "Enter essential expenses" : `${result.coveredMonths.toFixed(1)} months covered`}</h2><div className="calculator-stat-grid"><div className="calculator-stat"><span>Target fund</span><strong className="calculator-money">{formatMoney(result.targetMinor, currency)}</strong></div><div className="calculator-stat"><span>Still needed</span><strong className="calculator-money">{formatMoney(result.shortfallMinor, currency)}</strong></div><div className="calculator-stat"><span>Monthly contribution</span><strong className="calculator-money">{formatMoney(result.monthlyContributionMinor, currency)}</strong></div></div><p className="calculator-note">The target date for the goal is set {targetMonths || "0"} months from today; you can change it later in Plans.</p></aside>
  </section>;
}

function BillSplitCalculator({ currency }: { currency: CurrencyCode }) {
  const workspace = useContext(LedgerWorkspaceContext);
  const [subtotal, setSubtotal] = useState("");
  const [tip, setTip] = useState("10");
  const [people, setPeople] = useState("2");
  const split = calculateEqualSplit(majorToMinor(subtotal), Number(people) || 1, Number(tip) || 0);
  const largerShare = split.sharesMinor[0] ?? 0;
  const smallerShare = split.sharesMinor[split.sharesMinor.length - 1] ?? 0;
  const largerShareCount = split.totalMinor % Math.max(1, Math.floor(Number(people) || 1));
  // The sheet counts me separately, so it gets one empty name per other person.
  const logSplit = () => workspace?.openSplitBill({ amount: minorToMajorInput(split.totalMinor), people: Array.from({ length: Math.max(1, split.sharesMinor.length - 1) }, () => "") });
  return <section className="calculator-tool-layout">
    <article className="calculator-tool-panel"><ToolHeading step="Shared bill" title="Split it fairly" description="Add a bill, tip, and people. The final rupee is assigned so the shares always add up." /><div className="calculator-form-grid"><NumberInput label={`Bill subtotal in ${currency}`} value={subtotal} onChange={(value) => setSubtotal(String(value))} placeholder="3,500" min={0} thousandSeparator="," decimalScale={2} /><NumberInput label="Tip or service charge" value={tip} onChange={(value) => setTip(String(value))} min={0} max={100} decimalScale={2} rightSection={<span className="calculator-percent-suffix">%</span>} /><NumberInput label="People" value={people} onChange={(value) => setPeople(String(value))} min={1} step={1} decimalScale={0} /></div>{workspace && <div className="calculator-tool-actions"><button type="button" className="primary-button" disabled={split.totalMinor <= 0} onClick={logSplit}><HandCoins size={17} />Log this split</button></div>}</article>
    <aside className="calculator-result-panel"><span className="section-label">Bill snapshot</span><h2 className="calculator-money">{formatMoney(split.totalMinor, currency)}</h2><div className="calculator-stat-grid"><div className="calculator-stat"><span>Tip / service</span><strong className="calculator-money">{formatMoney(split.tipMinor, currency)}</strong></div><div className="calculator-stat"><span>Even share</span><strong className="calculator-money">{formatMoney(smallerShare, currency)}</strong></div><div className="calculator-stat"><span>People paying one rupee more</span><strong>{largerShareCount ? `${largerShareCount} · ${formatMoney(largerShare, currency)}` : "Everyone equal"}</strong></div></div><p className="calculator-note">When the total cannot divide perfectly, only the first few shares carry the one-rupee rounding difference.</p></aside>
  </section>;
}
