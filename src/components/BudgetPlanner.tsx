import { ArrowsClockwise, Check, Confetti, PencilSimple, Plus, Trash, Wallet, WarningCircle } from "@phosphor-icons/react";
import { Checkbox, NumberInput, Select, Switch } from "@mantine/core";
import { addDays, format, parseISO } from "date-fns";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ButtonSpinner } from "./ButtonSpinner";
import { CategoryIcon } from "./CategoryIcon";
import { EmptyState } from "./EmptyState";
import { FormError } from "./FormError";
import { useLedger } from "../context/LedgerContext";
import { minorToMajorInput } from "../lib/allocation-calculator";
import { ALL_SPENDING_CATEGORY, ALL_SPENDING_LABEL, budgetAllowanceText, buildBudgetCarryForward, isAllSpendingBudget, type BudgetCarryForward } from "../lib/budgets";
import { getCategory, spendingCategoriesFor } from "../lib/categories";
import { formatMoney, majorToMinor } from "../lib/currency";
import { formatLedgerMonth, monthKey, todayInput } from "../lib/dates";
import { compareFestivalSpending, expensesBetween, festivalBounds, festivalLabel, festivalMonthLabel, festivalSeasonsFrom, parseFestivalPeriodKey, type UpcomingFestival } from "../lib/festivals";
import { averagingWindowLabel, calculateCategoryMonthlyAverages } from "../lib/financial-calculators";
import { transactionCountsTowardBudget } from "../lib/household";
import { calculateBudgetPacing, calculatePeriodBudgetPacing, calculateUnbudgetedSpending, type BudgetPacing } from "../lib/planning-insights";
import type { Budget, CalendarSystem, CurrencyCode, CustomCategory, DueItem, LedgerTransaction, RecurringEntry } from "../types";

interface BudgetPlannerProps {
  month: Date;
  calendarSystem: CalendarSystem;
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  budgets: Budget[];
  recurringEntries: RecurringEntry[];
  dueItems: DueItem[];
  customCategories: CustomCategory[];
  onSaveBudget: (draft: { category: string; amount: string; monthKey: string; shared?: boolean }, id?: string) => Promise<void>;
  onDeleteBudget: (id: string) => Promise<void>;
}

const previewMinor = (value: string) => Math.round(Number(value.replace(/,/g, "")) * 100) || 0;
/** Rounds a suggestion up to a friendly limit: the next NPR 100, or NPR 1,000 for an overall limit. */
const roundUpMinor = (minor: number, step: number) => Math.ceil(minor / step) * step;
const shortRange = (start: string, endExclusive: string) => { const last = addDays(parseISO(endExclusive), -1); return `${format(parseISO(start), "MMM d")} – ${format(last, "MMM d, yyyy")}`; };

function budgetLook(category: string, customCategories: readonly CustomCategory[]) {
  if (category === ALL_SPENDING_CATEGORY) return { label: ALL_SPENDING_LABEL, color: "var(--blue)", icon: <div className="transaction-icon budget-total-icon"><Wallet size={19} weight="duotone" /></div> };
  const definition = getCategory(category, customCategories);
  return { label: definition.label, color: definition.color, icon: <div className="transaction-icon" style={{ "--category-color": definition.color } as CSSProperties}><CategoryIcon category={category} icon={definition.icon} /></div> };
}

/**
 * Plan → Budgets: an overall "All spending" limit pinned on top, category
 * limits with edit and delete, what no budget covers, last month's budgets to
 * carry forward on an empty month, and festival-season budgets.
 */
export function BudgetPlanner({ month, calendarSystem, currency, transactions, budgets, recurringEntries, dueItems, customCategories, onSaveBudget, onDeleteBudget }: BudgetPlannerProps) {
  const { profile, saveBudgets } = useLedger();
  const searchParams = useSearchParams();
  const focusFestival = searchParams.get("festival");
  const today = todayInput();
  const selectedKey = monthKey(month);
  const [category, setCategory] = useState("food"); const [amount, setAmount] = useState(""); const [sharedBudget, setSharedBudget] = useState(false); const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); const [preview, setPreview] = useState<{ category: string; amount: string } | null>(null); const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  // Editing belongs to the month it started in; switching months drops it.
  const editing = editingBudget && editingBudget.monthKey === selectedKey ? editingBudget : null;

  const currentBudgets = useMemo(() => budgets.filter((item) => item.monthKey === selectedKey), [budgets, selectedKey]);
  const pacing = useMemo(() => calculateBudgetPacing(currentBudgets, transactions, recurringEntries, dueItems, month), [currentBudgets, dueItems, month, recurringEntries, transactions]);
  const totalPacing = pacing.filter((item) => isAllSpendingBudget(item.budget));
  const categoryPacing = pacing.filter((item) => !isAllSpendingBudget(item.budget));
  const alerts = pacing.filter((item) => item.tone !== "healthy");
  const unbudgeted = useMemo(() => calculateUnbudgetedSpending(currentBudgets, transactions, month), [currentBudgets, month, transactions]);
  const carryForward = useMemo(() => profile.id ? buildBudgetCarryForward(budgets, transactions, selectedKey, profile.id, today) : null, [budgets, profile.id, selectedKey, today, transactions]);
  const ownSpending = useMemo(() => transactions.filter((item) => transactionCountsTowardBudget(item, { userId: profile.id, shared: false })), [profile.id, transactions]);
  const averages = useMemo(() => calculateCategoryMonthlyAverages(ownSpending, 3, today), [ownSpending, today]);
  const averageTotalMinor = averages.reduce((sum, item) => sum + item.averageMinor, 0);

  const focusForm = () => document.getElementById("add-budget")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const startBudget = (nextCategory: string, suggestedMinor = 0) => { setEditingBudget(null); setCategory(nextCategory); setAmount(suggestedMinor > 0 ? minorToMajorInput(suggestedMinor) : ""); setSharedBudget(false); setError(null); focusForm(); };
  const edit = (budget: Budget) => { setEditingBudget(budget); setCategory(budget.category); setAmount(minorToMajorInput(budget.amountMinor)); setSharedBudget(budget.shared ?? false); setError(null); focusForm(); };
  const cancelEdit = () => { setEditingBudget(null); setAmount(""); setSharedBudget(false); setError(null); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const draft = { category, amount };
    setSaving(true); if (!editing) setPreview(draft);
    try { setError(null); await onSaveBudget({ ...draft, monthKey: editing?.monthKey ?? selectedKey, shared: sharedBudget }, editing?.id); cancelEdit(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save budget."); }
    finally { setSaving(false); setPreview(null); }
  };
  const remove = async (id: string) => { if (deletingId) return; setDeletingId(id); try { setError(null); await onDeleteBudget(id); if (editingBudget?.id === id) cancelEdit(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete budget."); } finally { setDeletingId(null); } };
  const rowActions = (budget: Budget, label: string, onEdit: () => void) => budget.userId === profile.id ? <>
    <button type="button" className="icon-button" disabled={saving || deletingId === budget.id} onClick={onEdit} aria-label={`Edit ${label} budget`}><PencilSimple size={16} /></button>
    <button type="button" className="icon-button danger" disabled={deletingId === budget.id} onClick={() => void remove(budget.id)} aria-label={`Delete ${label} budget`}>{deletingId === budget.id ? <ButtonSpinner /> : <Trash size={16} />}</button>
  </> : null;

  const categoryOptions = [{ value: ALL_SPENDING_CATEGORY, label: `${ALL_SPENDING_LABEL} · one overall limit` }, ...spendingCategoriesFor("expense", customCategories).map((item) => ({ value: item.id, label: item.label }))];
  const previewLook = preview ? budgetLook(preview.category, customCategories) : null;
  // Saving a category you already budget would overwrite that budget (one per category per month), and a partner's custom category is not yours to budget.
  const myCategories = new Set(currentBudgets.filter((budget) => budget.userId === profile.id).map((budget) => budget.category));
  const topUnbudgeted = unbudgeted.categories.find((item) => !myCategories.has(item.category) && categoryOptions.some((option) => option.value === item.category));
  const topUnbudgetedLabel = topUnbudgeted ? getCategory(topUnbudgeted.category, customCategories).label : "";
  const suggestionFor = (categoryId: string, fallbackMinor: number) => roundUpMinor(averages.find((item) => item.category === categoryId)?.averageMinor ?? fallbackMinor, 10_000);

  return <section className="planner-layout">
    <article className="planner-form-panel" id="add-budget">
      <span className="section-label">{editing ? "Change a limit" : "New monthly limit"}</span>
      <h2>{editing ? `Edit ${budgetLook(editing.category, customCategories).label}` : "Add a budget"}</h2>
      <form onSubmit={save} className="stack-form" aria-busy={saving}>
        <Select label="Category" description={category === ALL_SPENDING_CATEGORY ? "Counts every expense this month, whatever its category." : undefined} value={category} onChange={(value) => value && setCategory(value)} disabled={saving} data={categoryOptions} searchable allowDeselect={false} />
        <NumberInput label={`Amount in ${currency}`} value={amount} onChange={(value) => setAmount(String(value))} placeholder={category === ALL_SPENDING_CATEGORY ? "40,000" : "15,000"} required disabled={saving} min={0} thousandSeparator="," decimalScale={2} />
        {profile.household?.status === "active" && <Switch label="Ours" description="Counts entries marked Ours. Your private spending stays on a personal budget." checked={sharedBudget} onChange={(event) => setSharedBudget(event.currentTarget.checked)} disabled={saving} />}
        <button className="primary-button" disabled={saving}>{saving ? <><ButtonSpinner />Saving budget…</> : editing ? <><Check size={17} />Update budget</> : <><Plus size={17} />Save budget</>}</button>
        {editing && <button type="button" className="secondary-button" disabled={saving} onClick={cancelEdit}>Cancel editing</button>}
        <FormError message={error} />
      </form>
    </article>
    <article className="planner-content">
      <div className="section-heading"><div><span className="section-label">{formatLedgerMonth(month, calendarSystem)} budgets</span><h2>Spending guardrails</h2></div></div>
      {carryForward && <BudgetCarryForwardCard key={`${selectedKey}:${carryForward.previousMonthKey}`} plan={carryForward} month={month} calendarSystem={calendarSystem} currency={currency} customCategories={customCategories} onSave={(drafts) => saveBudgets(selectedKey, drafts)} />}
      {alerts.length > 0 && <div className="budget-alert-list" role="status" aria-label="Budget alerts">{alerts.map((item) => <div className={`budget-alert ${item.tone}`} key={item.budget.id}><WarningCircle size={17} weight="fill" /><span><strong>{budgetLook(item.budget.category, customCategories).label}: {item.alertTitle}</strong><small>{item.alertDetail}</small></span></div>)}</div>}
      {totalPacing.map((item) => { const look = budgetLook(item.budget.category, customCategories); return <BudgetPacingRow key={item.budget.id} item={item} label={look.label} color={look.color} icon={look.icon} currency={currency} allowance={budgetAllowanceText(item, currency)} busy={deletingId === item.budget.id} className="all-spending" actions={rowActions(item.budget, look.label, () => edit(item.budget))} />; })}
      {!totalPacing.length && currentBudgets.length > 0 && <div className="budget-total-prompt"><Wallet size={20} weight="duotone" /><div><strong>{ALL_SPENDING_LABEL}</strong><small>Add one overall limit to see what is left per day across everything you spend.</small></div><button type="button" className="secondary-button small" disabled={saving} onClick={() => startBudget(ALL_SPENDING_CATEGORY, roundUpMinor(averageTotalMinor, 100_000))}><Plus size={15} />Set a limit</button></div>}
      {preview && previewLook && <div className="budget-row pending-preview" role="status">{previewLook.icon}<div><div><strong>{previewLook.label}</strong><span>{formatMoney(0, currency)} of {formatMoney(previewMinor(preview.amount), currency)}</span></div><div className="bar-track"><span style={{ width: "0%", backgroundColor: previewLook.color }} /></div><small className="pending-label"><ButtonSpinner />Adding budget…</small></div><span /></div>}
      {categoryPacing.map((item) => { const look = budgetLook(item.budget.category, customCategories); return <BudgetPacingRow key={item.budget.id} item={item} label={look.label} color={look.color} icon={look.icon} currency={currency} busy={deletingId === item.budget.id} actions={rowActions(item.budget, look.label, () => edit(item.budget))} />; })}
      {categoryPacing.length > 0 && unbudgeted.totalMinor > 0 && <div className="budget-unbudgeted">
        <div><strong>Unbudgeted spending: <span className="budget-money">{formatMoney(unbudgeted.totalMinor, currency)}</span></strong><small>{unbudgeted.categories.slice(0, 3).map((item, index) => <span key={item.category}>{index ? " · " : ""}{getCategory(item.category, customCategories).label} <span className="budget-money">{formatMoney(item.totalMinor, currency)}</span></span>)}{unbudgeted.categories.length > 3 ? ` · +${unbudgeted.categories.length - 3} more` : ""}</small></div>
        {topUnbudgeted && <button type="button" className="secondary-button small" disabled={saving} onClick={() => startBudget(topUnbudgeted.category, suggestionFor(topUnbudgeted.category, topUnbudgeted.totalMinor))}><Plus size={15} />Budget {topUnbudgetedLabel}</button>}
      </div>}
      {!currentBudgets.length && !preview && !carryForward && <EmptyState title="No budgets for this month" message="Set one overall limit for all spending, or a limit per category, to see progress and a daily allowance here." action={<button type="button" className="secondary-button small" onClick={() => startBudget(ALL_SPENDING_CATEGORY, roundUpMinor(averageTotalMinor, 100_000))}><Wallet size={16} />Set an overall limit</button>} />}
      <FestivalBudgets focusFestival={focusFestival} today={today} month={month} currency={currency} transactions={transactions} ownSpending={ownSpending} budgets={budgets} recurringEntries={recurringEntries} dueItems={dueItems} viewerId={profile.id} deletingId={deletingId} onSaveBudget={onSaveBudget} onDelete={remove} />
    </article>
  </section>;
}

function BudgetPacingRow({ item, label, color, icon, currency, allowance, busy, actions, className = "", detail }: { item: BudgetPacing; label: string; color: string; icon: ReactNode; currency: CurrencyCode; allowance?: string; busy: boolean; actions: ReactNode; className?: string; detail?: ReactNode }) {
  const spentWidth = Math.min(100, item.spentPercentage);
  const upcomingWidth = Math.max(0, Math.min(100 - spentWidth, item.projectedPercentage - item.spentPercentage));
  return <div className={`budget-row has-actions pacing-${item.tone} ${className}`} aria-busy={busy}>
    {icon}
    <div className="budget-pacing-copy">
      <div><strong>{label}{item.budget.shared ? <span className="ours-chip">Ours</span> : null}</strong><span>{formatMoney(item.spentMinor, currency)} of {formatMoney(item.budget.amountMinor, currency)}</span></div>
      {detail}
      <div className="budget-progress" aria-label={`${item.spentPercentage}% spent${item.upcomingMinor ? `, ${item.projectedPercentage}% projected with upcoming expenses` : ""}`}>
        <span className="spent" style={{ width: `${spentWidth}%`, backgroundColor: color }} />
        <span className="upcoming" style={{ width: `${upcomingWidth}%` }} />
      </div>
      <div className="budget-pacing-meta">
        {allowance ? <span className="budget-allowance">{allowance}</span> : null}
        <span>{item.spentPercentage}% spent</span>
        {item.upcomingMinor > 0 && <span>{formatMoney(item.upcomingMinor, currency)} upcoming · {item.projectedPercentage}% projected</span>}
        {!allowance && <span>{item.dailyAllowanceMinor > 0 ? `${formatMoney(item.dailyAllowanceMinor, currency)}/day available` : item.remainingMinor > 0 ? `${formatMoney(item.remainingMinor, currency)} remaining` : "No budget remaining"}</span>}
      </div>
      <small className={`budget-status ${item.tone}`}>{busy ? "Removing…" : item.alertTitle}</small>
    </div>
    <div className="budget-row-actions">{actions}</div>
  </div>;
}

interface CarryRow { category: string; shared: boolean; lastLimitMinor: number; lastActualMinor: number; averageMinor: number | null; include: boolean; amount: string }

/** "Start October with last month's 4 budgets": an editable checklist saved in one request. */
function BudgetCarryForwardCard({ plan, month, calendarSystem, currency, customCategories, onSave }: { plan: BudgetCarryForward; month: Date; calendarSystem: CalendarSystem; currency: CurrencyCode; customCategories: CustomCategory[]; onSave: (drafts: { category: string; amount: string; shared: boolean }[]) => Promise<void> }) {
  // Only the viewer's choices are state; limits, actuals and averages follow the ledger as it changes.
  const [choices, setChoices] = useState<Record<string, Partial<Pick<CarryRow, "include" | "amount">>>>({});
  const rows: CarryRow[] = plan.rows.map((row) => ({ ...row, include: choices[row.category]?.include ?? true, amount: choices[row.category]?.amount ?? minorToMajorInput(row.lastLimitMinor) }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = rows.filter((row) => row.include && majorToMinor(row.amount) > 0);
  const averageLabel = averagingWindowLabel(plan.averageWindow);
  const update = (category: string, changes: Partial<Pick<CarryRow, "include" | "amount">>) => { setChoices((current) => ({ ...current, [category]: { ...current[category], ...changes } })); setError(null); };
  const save = async () => {
    if (saving || !chosen.length) return;
    setSaving(true); setError(null);
    try { await onSave(chosen.map((row) => ({ category: row.category, amount: row.amount, shared: row.shared }))); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save these budgets."); }
    finally { setSaving(false); }
  };
  return <section className="budget-carry" aria-labelledby="budget-carry-heading" aria-busy={saving}>
    <div className="budget-carry-heading"><ArrowsClockwise size={20} weight="duotone" /><div><h3 id="budget-carry-heading">Start {formatLedgerMonth(month, calendarSystem)} with last month’s {plan.rows.length} {plan.rows.length === 1 ? "budget" : "budgets"}</h3><p>Untick what you don’t need and adjust any limit.{averageLabel ? ` Averages cover ${averageLabel}, complete months only — tap one to use it.` : ""}</p></div></div>
    <div className="budget-carry-list">{rows.map((row) => {
      const look = budgetLook(row.category, customCategories);
      return <div className={`budget-carry-row${row.include ? "" : " is-off"}`} key={row.category}>
        <Checkbox checked={row.include} onChange={(event) => update(row.category, { include: event.currentTarget.checked })} disabled={saving} aria-label={`Carry the ${look.label} budget forward`} />
        <div><strong>{look.label}{row.shared ? <span className="ours-chip">Ours</span> : null}</strong><small>Limit <span className="budget-money">{formatMoney(row.lastLimitMinor, currency)}</span> · spent <span className="budget-money">{formatMoney(row.lastActualMinor, currency)}</span>{row.averageMinor !== null && <> · avg <button type="button" className="budget-carry-average budget-money" disabled={!row.include || saving} onClick={() => update(row.category, { amount: minorToMajorInput(row.averageMinor ?? 0) })} title="Use the average">{formatMoney(row.averageMinor, currency)}</button></>}</small></div>
        <NumberInput aria-label={`${look.label} limit in ${currency}`} value={row.amount} onChange={(value) => update(row.category, { amount: String(value) })} min={0} thousandSeparator="," decimalScale={2} disabled={!row.include || saving} />
      </div>;
    })}</div>
    <div className="budget-carry-actions"><button type="button" className="primary-button" disabled={saving || !chosen.length} onClick={() => void save()}>{saving ? <><ButtonSpinner />Saving budgets…</> : <><Check size={17} />Start with {chosen.length} {chosen.length === 1 ? "budget" : "budgets"}</>}</button></div>
    <FormError message={error} />
  </section>;
}

interface FestivalBudgetsProps {
  focusFestival: string | null;
  today: string;
  month: Date;
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  ownSpending: LedgerTransaction[];
  budgets: Budget[];
  recurringEntries: RecurringEntry[];
  dueItems: DueItem[];
  viewerId: string;
  deletingId: string | null;
  onSaveBudget: BudgetPlannerProps["onSaveBudget"];
  onDelete: (id: string) => Promise<void>;
}

/** One overall limit for a whole festival season (FEST:<season>-<year>), prefilled with last year's actual. */
function FestivalBudgets({ focusFestival, today, month, currency, transactions, ownSpending, budgets, recurringEntries, dueItems, viewerId, deletingId, onSaveBudget, onDelete }: FestivalBudgetsProps) {
  const seasons = useMemo(() => { try { return festivalSeasonsFrom(today).slice(0, 3); } catch { return [] as UpcomingFestival[]; } }, [today]);
  const lastYear = useMemo(() => {
    const spentBetween = expensesBetween(ownSpending);
    return new Map(seasons.map((season) => { try { return [season.periodKey, compareFestivalSpending(season.festival, season.bsYear, spentBetween, today).previousSpentMinor ?? 0] as const; } catch { return [season.periodKey, 0] as const; } }));
  }, [ownSpending, seasons, today]);
  const [open, setOpen] = useState(Boolean(focusFestival));
  const [seasonKey, setSeasonKey] = useState(() => seasons.find((season) => season.periodKey === focusFestival)?.periodKey ?? seasons[0]?.periodKey ?? "");
  const [amountEdit, setAmountEdit] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (focusFestival) document.getElementById("festival-budgets")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [focusFestival]);

  const monthStart = format(month, "yyyy-MM-01");
  const nextMonthStart = format(new Date(month.getFullYear(), month.getMonth() + 1, 1), "yyyy-MM-dd");
  const rows = useMemo(() => budgets.flatMap((budget) => {
    const parsed = budget.monthKey.startsWith("FEST:") ? parseFestivalPeriodKey(budget.monthKey) : null;
    if (!parsed) return [];
    try {
      const bounds = festivalBounds(parsed.festival, parsed.bsYear);
      const overlapsMonth = bounds.start < nextMonthStart && bounds.endExclusive > monthStart;
      if (bounds.endExclusive <= today && !overlapsMonth) return [];
      return [{ budget, ...parsed, bounds, pacing: calculatePeriodBudgetPacing(budget, bounds, transactions, recurringEntries, dueItems, today) }];
    } catch { return []; }
  }).sort((a, b) => a.bounds.start.localeCompare(b.bounds.start)), [budgets, dueItems, monthStart, nextMonthStart, recurringEntries, today, transactions]);

  const season = seasons.find((item) => item.periodKey === seasonKey) ?? null;
  const existing = budgets.find((budget) => budget.userId === viewerId && budget.monthKey === seasonKey && isAllSpendingBudget(budget));
  const suggestedMinor = lastYear.get(seasonKey) ?? 0;
  const amount = amountEdit ?? (existing ? minorToMajorInput(existing.amountMinor) : suggestedMinor > 0 ? minorToMajorInput(roundUpMinor(suggestedMinor, 100_000)) : "");
  const openFor = (key: string, presetMinor?: number) => { setSeasonKey(key); setAmountEdit(presetMinor === undefined ? null : minorToMajorInput(presetMinor)); setError(null); setOpen(true); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !season) return;
    setSaving(true); setError(null);
    try { await onSaveBudget({ category: ALL_SPENDING_CATEGORY, amount, monthKey: season.periodKey, shared: false }); setOpen(false); setAmountEdit(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save the festival budget."); }
    finally { setSaving(false); }
  };
  if (!seasons.length && !rows.length) return null;

  return <section className="festival-budgets" id="festival-budgets" aria-labelledby="festival-budgets-heading">
    <div className="section-heading"><div><span className="section-label">Festival seasons</span><h2 id="festival-budgets-heading">Festival budgets</h2></div>{!open && seasons.length > 0 && <button type="button" className="secondary-button small" onClick={() => openFor(seasons[0].periodKey)}><Confetti size={16} />Festival budget</button>}</div>
    {open && season && <form className="festival-budget-form" onSubmit={save} aria-busy={saving}>
      <Select label="Season" value={seasonKey} onChange={(value) => { if (value) { setSeasonKey(value); setAmountEdit(null); } }} data={seasons.map((item) => ({ value: item.periodKey, label: `${festivalLabel(item.festival, item.bsYear)} · ${item.daysAway === 0 ? "on now" : `from ${format(parseISO(item.bounds.start), "MMM d")}`}` }))} allowDeselect={false} disabled={saving} />
      <NumberInput label={`Limit for the season in ${currency}`} description={suggestedMinor > 0 ? <>Last year’s season: <span className="budget-money">{formatMoney(suggestedMinor, currency)}</span></> : "Nothing logged for last year’s season yet."} value={amount} onChange={(value) => setAmountEdit(String(value))} min={0} thousandSeparator="," decimalScale={2} required disabled={saving} />
      <p className="festival-budget-hint">Tracks all your spending in {festivalMonthLabel(season.festival)}, {shortRange(season.bounds.start, season.bounds.endExclusive)}.{existing ? " Saving updates the budget you already set." : ""}</p>
      <div className="festival-budget-actions"><button className="primary-button" disabled={saving}>{saving ? <><ButtonSpinner />Saving…</> : <><Check size={17} />{existing ? "Update festival budget" : "Save festival budget"}</>}</button><button type="button" className="secondary-button" disabled={saving} onClick={() => { setOpen(false); setAmountEdit(null); setError(null); }}>Cancel</button></div>
      <FormError message={error} />
    </form>}
    {rows.map(({ budget, festival, bsYear, bounds, pacing }) => {
      const label = festivalLabel(festival, bsYear);
      return <BudgetPacingRow key={budget.id} item={pacing} label={label} color="var(--coral)" icon={<div className="transaction-icon budget-festival-icon"><Confetti size={19} weight="duotone" /></div>} currency={currency} allowance={today < bounds.start ? `Starts ${format(parseISO(bounds.start), "MMM d")}` : budgetAllowanceText(pacing, currency)} busy={deletingId === budget.id} className="festival" detail={<small className="budget-festival-window">All spending · {festivalMonthLabel(festival)} · {shortRange(bounds.start, bounds.endExclusive)}</small>} actions={budget.userId === viewerId ? <>
        <button type="button" className="icon-button" disabled={saving || deletingId === budget.id || !seasons.some((item) => item.periodKey === budget.monthKey)} onClick={() => { openFor(budget.monthKey, budget.amountMinor); document.getElementById("festival-budgets")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} aria-label={`Edit ${label} budget`}><PencilSimple size={16} /></button>
        <button type="button" className="icon-button danger" disabled={deletingId === budget.id} onClick={() => void onDelete(budget.id)} aria-label={`Delete ${label} budget`}>{deletingId === budget.id ? <ButtonSpinner /> : <Trash size={16} />}</button>
      </> : null} />;
    })}
    {!rows.length && !open && <p className="festival-budget-empty">Set one limit for a whole festival season. It tracks everything you spend from the season’s first day to its last, so Dashain shopping and Tihar gifts land in one place.</p>}
  </section>;
}
