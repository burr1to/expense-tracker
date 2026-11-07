import { ArrowsClockwise, Check, Confetti, DotsThree, PencilSimple, Plus, Sparkle, Trash, Wallet } from "@phosphor-icons/react";
import { Checkbox, Menu, NumberInput, Select, Switch } from "@mantine/core";
import { addDays, format, parseISO } from "date-fns";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ButtonSpinner } from "./ButtonSpinner";
import { CategoryTile } from "./ToneIcon";
import { FormError } from "./FormError";
import { useLedger } from "../context/LedgerContext";
import { minorToMajorInput } from "../lib/allocation-calculator";
import { ALL_SPENDING_CATEGORY, ALL_SPENDING_LABEL, budgetAllowanceText, buildBudgetCarryForward, isAllSpendingBudget, type BudgetCarryForward } from "../lib/budgets";
import { getCategory, spendingCategoriesFor } from "../lib/categories";
import { formatMoney, majorToMinor } from "../lib/currency";
import { formatLedgerMonth, monthKey, periodRange } from "../lib/dates";
import type { PeriodKey } from "../lib/period";
import { compareFestivalSpending, expensesBetween, festivalBounds, festivalLabel, festivalMonthLabel, festivalSeasonsFrom, parseFestivalPeriodKey, type UpcomingFestival } from "../lib/festivals";
import { averagingWindowLabel, calculateCategoryMonthlyAverages } from "../lib/financial-calculators";
import { transactionCountsTowardBudget } from "../lib/household";
import { calculateBudgetPacing, calculatePeriodBudgetPacing, calculateUnbudgetedSpending, type BudgetPacing } from "../lib/planning-insights";
import { useToday } from "../lib/use-today";
import { plainAmount } from "../lib/entry-labels";
import { categoryTone, type Tone } from "../lib/tones";
import type { Budget, CalendarSystem, CurrencyCode, CustomCategory, DueItem, LedgerTransaction, RecurringEntry } from "../types";

interface BudgetPlannerProps {
  /** The workspace month; a BS key saves budgets under `BS:YYYY-MM` and paces them over that month's days. */
  period: PeriodKey;
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

const ALL_TONE: Tone = { bg: "#dcebe1", ink: "#24503d", pale: "#bcd6c6" };
const FESTIVAL_TONE: Tone = { bg: "#fde5d4", ink: "#b4531f", pale: "#f6cdb0" };
const tileStyle = (tone: Tone, size = 42) => ({ "--tile-bg": tone.bg, "--tile-ink": tone.ink, "--tile-size": `${size}px` } as CSSProperties);

function budgetLook(category: string, customCategories: readonly CustomCategory[]): { label: string; tone: Tone; icon: ReactNode } {
  if (category === ALL_SPENDING_CATEGORY) return { label: ALL_SPENDING_LABEL, tone: ALL_TONE, icon: <span className="v2-tile" style={tileStyle(ALL_TONE)} aria-hidden="true"><Wallet size={22} weight="duotone" /></span> };
  const definition = getCategory(category, customCategories);
  return { label: definition.label, tone: categoryTone(category, customCategories), icon: <CategoryTile category={category} custom={customCategories} /> };
}

/** Edit and delete behind one ⋯ button; only the budget's owner gets it. */
function BudgetMenu({ label, busy, disabled, onEdit, onDelete, light = false }: { label: string; busy: boolean; disabled: boolean; onEdit: () => void; onDelete: () => void; light?: boolean }) {
  return <Menu position="bottom-end" shadow="md" withinPortal>
    <Menu.Target><button type="button" className={`v2-icon-btn is-quiet${light ? " is-light" : ""}`} disabled={busy} aria-label={`More actions for the ${label} budget`}>{busy ? <ButtonSpinner /> : <DotsThree size={20} weight="bold" />}</button></Menu.Target>
    <Menu.Dropdown>
      <Menu.Item leftSection={<PencilSimple size={16} />} disabled={disabled} onClick={onEdit}>Edit limit</Menu.Item>
      <Menu.Item color="red" leftSection={<Trash size={16} />} onClick={onDelete}>Delete</Menu.Item>
    </Menu.Dropdown>
  </Menu>;
}

/**
 * Plan → Budgets: one overall "All spending" limit as the green hero, category
 * limits as coloured rows, what no budget covers, last month's budgets to carry
 * forward on an empty month, and festival-season budgets. The form sits beside
 * the list on desktop and below it on a phone.
 */
export function BudgetPlanner({ period: month, calendarSystem, currency, transactions, budgets, recurringEntries, dueItems, customCategories, onSaveBudget, onDeleteBudget }: BudgetPlannerProps) {
  const { profile, saveBudgets } = useLedger();
  const searchParams = useSearchParams();
  const focusFestival = searchParams.get("festival");
  const today = useToday();
  const selectedKey = monthKey(month);
  const [category, setCategory] = useState("food"); const [amount, setAmount] = useState(""); const [sharedBudget, setSharedBudget] = useState(false); const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); const [preview, setPreview] = useState<{ category: string; amount: string } | null>(null); const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  // Editing belongs to the month it started in; switching months drops it.
  const editing = editingBudget && editingBudget.monthKey === selectedKey ? editingBudget : null;

  const currentBudgets = useMemo(() => budgets.filter((item) => item.monthKey === selectedKey), [budgets, selectedKey]);
  // Paced against Kathmandu's today, so days left and the daily allowance roll over at midnight there.
  const pacing = useMemo(() => calculateBudgetPacing(currentBudgets, transactions, recurringEntries, dueItems, month, parseISO(today)), [currentBudgets, dueItems, month, recurringEntries, today, transactions]);
  const totalPacing = pacing.filter((item) => isAllSpendingBudget(item.budget));
  const categoryPacing = pacing.filter((item) => !isAllSpendingBudget(item.budget));
  const unbudgeted = useMemo(() => calculateUnbudgetedSpending(currentBudgets, transactions, month), [currentBudgets, month, transactions]);
  const carryForward = useMemo(() => profile.id ? buildBudgetCarryForward(budgets, transactions, selectedKey, profile.id, today) : null, [budgets, profile.id, selectedKey, today, transactions]);
  const ownSpending = useMemo(() => transactions.filter((item) => transactionCountsTowardBudget(item, { userId: profile.id, shared: false })), [profile.id, transactions]);
  const averages = useMemo(() => calculateCategoryMonthlyAverages(ownSpending, 3, today), [ownSpending, today]);
  const averageTotalMinor = averages.reduce((sum, item) => sum + item.averageMinor, 0);
  const monthName = formatLedgerMonth(month, calendarSystem);

  const focusForm = () => { const form = document.getElementById("add-budget"); form?.scrollIntoView({ behavior: "smooth", block: "start" }); // Focusing the limit also scrolls it into view where smooth scrolling is cut short.
    window.setTimeout(() => form?.querySelector<HTMLInputElement>(".mantine-NumberInput-input")?.focus(), 350); };
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
  const menuFor = (budget: Budget, label: string, light = false) => budget.userId === profile.id
    ? <BudgetMenu label={label} light={light} busy={deletingId === budget.id} disabled={saving} onEdit={() => edit(budget)} onDelete={() => void remove(budget.id)} />
    : null;

  const categoryOptions = [{ value: ALL_SPENDING_CATEGORY, label: `${ALL_SPENDING_LABEL} · one overall limit` }, ...spendingCategoriesFor("expense", customCategories).map((item) => ({ value: item.id, label: item.label }))];
  const previewLook = preview ? budgetLook(preview.category, customCategories) : null;
  // Saving a category you already budget would overwrite that budget (one per category per month), and a partner's custom category is not yours to budget.
  const myCategories = new Set(currentBudgets.filter((budget) => budget.userId === profile.id).map((budget) => budget.category));
  const topUnbudgeted = unbudgeted.categories.find((item) => !myCategories.has(item.category) && categoryOptions.some((option) => option.value === item.category));
  const topUnbudgetedLabel = topUnbudgeted ? getCategory(topUnbudgeted.category, customCategories).label : "";
  const suggestionFor = (categoryId: string, fallbackMinor: number) => roundUpMinor(averages.find((item) => item.category === categoryId)?.averageMinor ?? fallbackMinor, 10_000);
  const suggestedOverallMinor = roundUpMinor(averageTotalMinor, 100_000);
  const overall = totalPacing[0] ?? null;
  const categoryLimitMinor = categoryPacing.reduce((sum, item) => sum + item.budget.amountMinor, 0);
  const categorySpentMinor = categoryPacing.reduce((sum, item) => sum + item.spentMinor, 0);

  const hero = overall ? <BudgetHero item={overall} label={`Left to spend · ${monthName}`} currency={currency} allowance={budgetAllowanceText(overall, currency)} menu={menuFor(overall.budget, ALL_SPENDING_LABEL, true)} busy={deletingId === overall.budget.id} />
    : categoryPacing.length ? <section className="v2-hero v2-budget-hero" aria-label={`${monthName} budgets`}>
      <span className="v2-hero-label">Budgeted · {monthName}</span>
      <strong className="v2-hero-amount amount">{formatMoney(Math.max(0, categoryLimitMinor - categorySpentMinor), currency)} <small>left of {formatMoney(categoryLimitMinor, currency)}</small></strong>
      <p className="v2-budget-hero-copy">Across {categoryPacing.length} {categoryPacing.length === 1 ? "category" : "categories"}. Add one overall limit to see what is left per day across everything you spend.</p>
      <button type="button" className="v2-button is-on-green" disabled={saving} onClick={() => startBudget(ALL_SPENDING_CATEGORY, suggestedOverallMinor)}><Plus size={16} weight="bold" />Set an overall limit</button>
    </section>
    : !carryForward && !preview ? <section className="v2-hero v2-budget-hero" aria-label={`${monthName} budgets`}>
      <span className="v2-hero-label">{monthName}</span>
      <strong className="v2-budget-hero-title">No budgets yet</strong>
      <p className="v2-budget-hero-copy">Set one limit for all spending and see what you can spend per day. Or give a single category, like Food, its own limit.{suggestedOverallMinor > 0 ? ` You usually spend about ${formatMoney(roundUpMinor(averageTotalMinor, 10_000), currency)} a month.` : ""}</p>
      <button type="button" className="v2-button is-on-green" onClick={() => startBudget(ALL_SPENDING_CATEGORY, suggestedOverallMinor)}><Wallet size={17} weight="duotone" />Set an overall limit</button>
    </section> : null;

  return <div className="v2-plan-grid">
    <div className="v2-plan-main">
      {carryForward && <BudgetCarryForwardCard key={`${selectedKey}:${carryForward.previousMonthKey}`} plan={carryForward} month={month} calendarSystem={calendarSystem} currency={currency} customCategories={customCategories} onSave={(drafts) => saveBudgets(selectedKey, drafts)} />}
      {hero}
      {(categoryPacing.length > 0 || preview) && <section className="v2-card" aria-labelledby="budget-categories-heading">
        <header className="v2-card-head"><h2 id="budget-categories-heading">By category</h2><button type="button" className="v2-link is-plain" disabled={saving} onClick={() => startBudget(topUnbudgeted?.category ?? "food", topUnbudgeted ? suggestionFor(topUnbudgeted.category, topUnbudgeted.totalMinor) : 0)}><Plus size={14} weight="bold" />Add</button></header>
        <ul className="v2-rows">
          {preview && previewLook && <li className="v2-budget-row is-pending" role="status">{previewLook.icon}<div className="v2-row-main"><strong>{previewLook.label}</strong><small><ButtonSpinner />Adding budget…</small><span className="v2-progress" /></div><span className="v2-row-end"><strong className="amount">{formatMoney(previewMinor(preview.amount), currency)}</strong></span><span /></li>}
          {categoryPacing.map((item) => { const look = budgetLook(item.budget.category, customCategories); return <li key={item.budget.id}><BudgetRow item={item} label={look.label} tone={look.tone} icon={look.icon} currency={currency} busy={deletingId === item.budget.id} menu={menuFor(item.budget, look.label)} /></li>; })}
        </ul>
        {categoryPacing.length > 0 && unbudgeted.totalMinor > 0 && <div className="v2-budget-loose">
          <div><strong>Not in a budget: <span className="amount">{formatMoney(unbudgeted.totalMinor, currency)}</span></strong><small>{unbudgeted.categories.slice(0, 3).map((item, index) => <span key={item.category}>{index ? " · " : ""}{getCategory(item.category, customCategories).label} <span className="amount">{formatMoney(item.totalMinor, currency)}</span></span>)}{unbudgeted.categories.length > 3 ? ` · +${unbudgeted.categories.length - 3} more` : ""}</small></div>
          {topUnbudgeted && <button type="button" className="v2-button" disabled={saving} onClick={() => startBudget(topUnbudgeted.category, suggestionFor(topUnbudgeted.category, topUnbudgeted.totalMinor))}><Plus size={15} weight="bold" />Budget {topUnbudgetedLabel}</button>}
        </div>}
      </section>}
      <FestivalBudgets focusFestival={focusFestival} today={today} month={month} currency={currency} transactions={transactions} ownSpending={ownSpending} budgets={budgets} recurringEntries={recurringEntries} dueItems={dueItems} viewerId={profile.id} deletingId={deletingId} onSaveBudget={onSaveBudget} onDelete={remove} />
    </div>
    <aside className="v2-plan-side">
      <section className={`v2-card v2-plan-form${editing ? " is-editing" : ""}`} id="add-budget" aria-labelledby="add-budget-heading">
        <header className="v2-card-head"><h2 id="add-budget-heading">{editing ? `Edit ${budgetLook(editing.category, customCategories).label}` : "Add a budget"}</h2></header>
        <p className="v2-muted">{editing ? `Change the ${monthName} limit.` : `A monthly limit for ${monthName}. One per category.`}</p>
        <form onSubmit={save} className="v2-form" aria-busy={saving}>
          <Select label="Category" description={category === ALL_SPENDING_CATEGORY ? "Counts every expense this month, whatever its category." : undefined} value={category} onChange={(value) => value && setCategory(value)} disabled={saving} data={categoryOptions} searchable allowDeselect={false} />
          <NumberInput label={`Limit in ${currency}`} value={amount} onChange={(value) => setAmount(String(value))} placeholder={category === ALL_SPENDING_CATEGORY ? "40,000" : "15,000"} required disabled={saving} min={0} thousandSeparator="," decimalScale={2} />
          {(() => { const average = averages.find((item) => item.category === category)?.averageMinor ?? (category === ALL_SPENDING_CATEGORY ? averageTotalMinor : 0); return average > 0 && !editing ? <button type="button" className="v2-chip is-hint" disabled={saving} onClick={() => setAmount(minorToMajorInput(roundUpMinor(average, category === ALL_SPENDING_CATEGORY ? 100_000 : 10_000)))}><Sparkle size={15} weight="duotone" />You usually spend {formatMoney(average, currency)}. Use {formatMoney(roundUpMinor(average, category === ALL_SPENDING_CATEGORY ? 100_000 : 10_000), currency)}</button> : null; })()}
          {profile.household?.status === "active" && <Switch label="Ours" description="Counts entries marked Ours. Your private spending stays on a personal budget." checked={sharedBudget} onChange={(event) => setSharedBudget(event.currentTarget.checked)} disabled={saving} />}
          <div className="v2-form-actions">
            {editing && <button type="button" className="v2-button" disabled={saving} onClick={cancelEdit}>Cancel</button>}
            <button className="v2-button is-primary" disabled={saving}>{saving ? <><ButtonSpinner />Saving…</> : editing ? <><Check size={17} weight="bold" />Update budget</> : <><Plus size={17} weight="bold" />Save budget</>}</button>
          </div>
          <FormError message={error} />
        </form>
      </section>
    </aside>
  </div>;
}

/** Spent, then upcoming bills, on one track; a tick marks how far through the period today is. */
function PacingTrack({ item, tone, light = false }: { item: BudgetPacing; tone: Tone; light?: boolean }) {
  const spentWidth = Math.min(100, item.spentPercentage);
  const upcomingWidth = Math.max(0, Math.min(100 - spentWidth, item.projectedPercentage - item.spentPercentage));
  const showToday = item.elapsedPercentage > 0 && item.elapsedPercentage < 100;
  return <span className={`v2-pace${light ? " is-light" : ""}`} role="img" aria-label={`${item.spentPercentage}% spent${item.upcomingMinor ? `, ${item.projectedPercentage}% with upcoming bills` : ""}${showToday ? `, ${item.elapsedPercentage}% of the period gone` : ""}`}>
    <span className="is-spent" style={{ width: `${spentWidth}%`, background: light ? undefined : item.tone === "over" ? "var(--v2-up)" : tone.ink }} />
    <span className="is-upcoming" style={{ width: `${upcomingWidth}%`, color: light ? undefined : tone.ink }} />
    {showToday && <i style={{ left: `${item.elapsedPercentage}%` }} />}
  </span>;
}

function BudgetHero({ item, label, currency, allowance, menu, busy }: { item: BudgetPacing; label: string; currency: CurrencyCode; allowance: string; menu: ReactNode; busy: boolean }) {
  const over = item.spentMinor > item.budget.amountMinor;
  return <section className={`v2-hero v2-budget-hero is-${item.tone}`} aria-label={label} aria-busy={busy}>
    <div className="v2-budget-hero-top"><span className="v2-hero-label">{label}{item.budget.shared ? <span className="v2-ours is-light">Ours</span> : null}</span>{menu}</div>
    <strong className="v2-hero-amount amount">{over ? `−${formatMoney(item.spentMinor - item.budget.amountMinor, currency)}` : formatMoney(Math.max(0, item.remainingMinor), currency)}</strong>
    <span className="v2-hero-pill">{busy ? "Removing…" : over ? "Over the limit" : allowance.replace(/^.*? left · /, "")}</span>
    <PacingTrack item={item} tone={ALL_TONE} light />
    <div className="v2-budget-hero-facts">
      <span><small>Spent</small><strong className="amount">{formatMoney(item.spentMinor, currency)}</strong></span>
      <span><small>Limit</small><strong className="amount">{formatMoney(item.budget.amountMinor, currency)}</strong></span>
      {item.upcomingMinor > 0 && <span><small>Bills coming</small><strong className="amount">{formatMoney(item.upcomingMinor, currency)}</strong></span>}
    </div>
  </section>;
}

function BudgetRow({ item, label, tone, icon, currency, busy, menu, detail, allowance }: { item: BudgetPacing; label: string; tone: Tone; icon: ReactNode; currency: CurrencyCode; busy: boolean; menu: ReactNode; detail?: ReactNode; allowance?: string }) {
  const over = item.spentMinor > item.budget.amountMinor;
  const status = busy ? "Removing…" : item.tone === "healthy" ? (allowance ?? (item.dailyAllowanceMinor > 0 ? `${formatMoney(item.dailyAllowanceMinor, currency)}/day` : `${item.spentPercentage}% used`)) : item.alertTitle;
  return <div className={`v2-budget-row is-${item.tone}`} aria-busy={busy}>
    {icon}
    <div className="v2-row-main">
      <strong>{label}{item.budget.shared ? <span className="v2-ours">Ours</span> : null}</strong>
      {detail}
      <PacingTrack item={item} tone={tone} />
      <span className="v2-budget-meta">
        <small><span className="amount">{formatMoney(item.spentMinor, currency)}</span> of <span className="amount">{plainAmount(item.budget.amountMinor)}</span>{item.upcomingMinor > 0 ? <> · <span className="amount">{plainAmount(item.upcomingMinor)}</span> coming</> : null}</small>
        <small className={`v2-budget-status is-${item.tone}`} title={item.tone === "healthy" ? undefined : item.alertDetail}>{status}</small>
      </span>
    </div>
    <span className="v2-row-end">
      <strong className={`amount${over ? " is-over" : ""}`}>{over ? `−${plainAmount(item.spentMinor - item.budget.amountMinor)}` : plainAmount(Math.max(0, item.remainingMinor))}</strong>
      <small className={over ? "is-over" : undefined}>{over ? "over" : "left"}</small>
    </span>
    {menu ?? <span />}
  </div>;
}

interface CarryRow { category: string; shared: boolean; lastLimitMinor: number; lastActualMinor: number; averageMinor: number | null; include: boolean; amount: string }

/** "Start October with last month's 4 budgets": an editable checklist saved in one request. */
function BudgetCarryForwardCard({ plan, month, calendarSystem, currency, customCategories, onSave }: { plan: BudgetCarryForward; month: PeriodKey; calendarSystem: CalendarSystem; currency: CurrencyCode; customCategories: CustomCategory[]; onSave: (drafts: { category: string; amount: string; shared: boolean }[]) => Promise<void> }) {
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
  return <section className="v2-card v2-carry" aria-labelledby="budget-carry-heading" aria-busy={saving}>
    <div className="v2-carry-head"><span className="v2-tile" style={tileStyle({ bg: "#dfe6fb", ink: "#3446a8", pale: "" })} aria-hidden="true"><ArrowsClockwise size={22} weight="duotone" /></span><div><h2 id="budget-carry-heading">Start {formatLedgerMonth(month, calendarSystem)} with last month’s {plan.rows.length} {plan.rows.length === 1 ? "budget" : "budgets"}</h2><p>Untick what you don’t need and adjust any limit.{averageLabel ? ` Averages cover ${averageLabel}, complete months only — tap one to use it.` : ""}</p></div></div>
    <div className="v2-carry-list">{rows.map((row) => {
      const look = budgetLook(row.category, customCategories);
      return <div className={`v2-carry-row${row.include ? "" : " is-off"}`} key={row.category}>
        <Checkbox checked={row.include} onChange={(event) => update(row.category, { include: event.currentTarget.checked })} disabled={saving} aria-label={`Carry the ${look.label} budget forward`} />
        {look.icon}
        <div className="v2-row-main"><strong>{look.label}{row.shared ? <span className="v2-ours">Ours</span> : null}</strong><small>Limit <span className="amount">{formatMoney(row.lastLimitMinor, currency)}</span> · spent <span className="amount">{formatMoney(row.lastActualMinor, currency)}</span>{row.averageMinor !== null && <> · avg <button type="button" className="v2-link amount" disabled={!row.include || saving} onClick={() => update(row.category, { amount: minorToMajorInput(row.averageMinor ?? 0) })} title="Use the average">{formatMoney(row.averageMinor, currency)}</button></>}</small></div>
        <NumberInput aria-label={`${look.label} limit in ${currency}`} value={row.amount} onChange={(value) => update(row.category, { amount: String(value) })} min={0} thousandSeparator="," decimalScale={2} disabled={!row.include || saving} />
      </div>;
    })}</div>
    <div className="v2-form-actions"><button type="button" className="v2-button is-primary" disabled={saving || !chosen.length} onClick={() => void save()}>{saving ? <><ButtonSpinner />Saving budgets…</> : <><Check size={17} weight="bold" />Start with {chosen.length} {chosen.length === 1 ? "budget" : "budgets"}</>}</button></div>
    <FormError message={error} />
  </section>;
}

interface FestivalBudgetsProps {
  focusFestival: string | null;
  today: string;
  month: PeriodKey;
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

  const { start: monthStart, endExclusive: nextMonthStart } = periodRange(month);
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

  return <section className="v2-card v2-festival" id="festival-budgets" aria-labelledby="festival-budgets-heading">
    <header className="v2-card-head"><h2 id="festival-budgets-heading">Festival seasons</h2>{(!open || !season) && seasons.length > 0 && <button type="button" className="v2-link is-plain" onClick={() => openFor(seasons[0].periodKey)}><Plus size={14} weight="bold" />Add</button>}</header>
    {open && season && <form className="v2-form v2-festival-form" onSubmit={save} aria-busy={saving}>
      <Select label="Season" value={seasonKey} onChange={(value) => { if (value) { setSeasonKey(value); setAmountEdit(null); } }} data={seasons.map((item) => ({ value: item.periodKey, label: `${festivalLabel(item.festival, item.bsYear)} · ${item.daysAway === 0 ? "on now" : `from ${format(parseISO(item.bounds.start), "MMM d")}`}` }))} allowDeselect={false} disabled={saving} />
      <NumberInput label={`Limit for the season in ${currency}`} description={suggestedMinor > 0 ? <>Last year’s season: <span className="amount">{formatMoney(suggestedMinor, currency)}</span></> : "Nothing logged for last year’s season yet."} value={amount} onChange={(value) => setAmountEdit(String(value))} min={0} thousandSeparator="," decimalScale={2} required disabled={saving} />
      <p className="v2-muted">Tracks all your spending in {festivalMonthLabel(season.festival)}, {shortRange(season.bounds.start, season.bounds.endExclusive)}.{existing ? " Saving updates the budget you already set." : ""}</p>
      <div className="v2-form-actions"><button type="button" className="v2-button" disabled={saving} onClick={() => { setOpen(false); setAmountEdit(null); setError(null); }}>Cancel</button><button className="v2-button is-primary" disabled={saving}>{saving ? <><ButtonSpinner />Saving…</> : <><Check size={17} weight="bold" />{existing ? "Update" : "Save festival budget"}</>}</button></div>
      <FormError message={error} />
    </form>}
    {rows.length > 0 && <ul className="v2-rows">{rows.map(({ budget, festival, bsYear, bounds, pacing }) => {
      const label = festivalLabel(festival, bsYear);
      return <li key={budget.id}><BudgetRow item={pacing} label={label} tone={FESTIVAL_TONE} icon={<span className="v2-tile" style={tileStyle(FESTIVAL_TONE)} aria-hidden="true"><Confetti size={22} weight="duotone" /></span>} currency={currency} allowance={today < bounds.start ? `Starts ${format(parseISO(bounds.start), "MMM d")}` : undefined} busy={deletingId === budget.id} detail={<small>{festivalMonthLabel(festival)} · {shortRange(bounds.start, bounds.endExclusive)}</small>} menu={budget.userId === viewerId ? <BudgetMenu label={label} busy={deletingId === budget.id} disabled={saving || !seasons.some((item) => item.periodKey === budget.monthKey)} onEdit={() => { openFor(budget.monthKey, budget.amountMinor); document.getElementById("festival-budgets")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} onDelete={() => void onDelete(budget.id)} /> : null} /></li>;
    })}</ul>}
    {!rows.length && !open && <p className="v2-empty">Set one limit for a whole festival season. It tracks everything you spend from the season’s first day to its last, so Dashain shopping and Tihar gifts land in one place.</p>}
  </section>;
}
