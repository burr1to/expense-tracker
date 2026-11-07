import { CalendarDots, CaretLeft, CaretRight, Check, DotsThree, Flag, PauseCircle, PencilSimple, PiggyBank, PlayCircle, Plus, Repeat, Sparkle, Trash } from "@phosphor-icons/react";
import { Menu, NumberInput, Select, TextInput } from "@mantine/core";
import { differenceInCalendarMonths, format, getDay, parseISO } from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { BudgetPlanner } from "../components/BudgetPlanner";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { LedgerDatePickerInput as DatePickerInput } from "../components/LedgerDatePickerInput";
import { RecurringConfirmSheet } from "../components/RecurringConfirmSheet";
import { CategoryTile } from "../components/ToneIcon";
import { useLedger } from "../context/LedgerContext";
import { allCategoriesFor, getCategory } from "../lib/categories";
import { dailyCashFlow } from "../lib/calendar";
import { formatMoney } from "../lib/currency";
import { formatLedgerDate, formatLedgerDay, formatLedgerMonth, isInMonth, localDate, periodRange } from "../lib/dates";
import { plainAmount } from "../lib/entry-labels";
import { addDaysToIso, addMonthsToKey, calendarFor, parseMonthKey, type PeriodKey } from "../lib/period";
import { recurrenceLabel } from "../lib/recurrence";
import { onlinePaymentAccounts, paymentAccountLabel } from "../lib/payment-accounts";
import type { Tone } from "../lib/tones";
import { detectRecurringPatterns, type RecurringPatternSuggestion } from "../lib/transaction-intelligence";
import { useToday } from "../lib/use-today";
import type { CalendarSystem, Budget, CurrencyCode, CustomCategory, DueItem, LedgerTransaction, PaymentAccount, RecurrenceUnit, RecurringDraft, RecurringEntry, SavingsGoal, TransactionKind } from "../types";
import { FormError } from "../components/FormError";

type PlanTab = "budgets" | "goals" | "recurring" | "calendar";
const PLAN_TABS: { id: PlanTab; label: string; icon: typeof Flag; tone: Tone }[] = [
  { id: "budgets", label: "Budgets", icon: Flag, tone: { bg: "#d6f0df", ink: "#1f7a45", pale: "" } },
  { id: "goals", label: "Goals", icon: PiggyBank, tone: { bg: "#fbe0ec", ink: "#b0386a", pale: "" } },
  { id: "recurring", label: "Recurring", icon: Repeat, tone: { bg: "#dfe6fb", ink: "#3446a8", pale: "" } },
  { id: "calendar", label: "Calendar", icon: CalendarDots, tone: { bg: "#fdf0c4", ink: "#8a5a00", pale: "" } },
];
/** Goals take turns through these, so two goals side by side never share a colour. */
const GOAL_TONES: Tone[] = [
  { bg: "#fbe0ec", ink: "#b0386a", pale: "#f3c6da" },
  { bg: "#dfe6fb", ink: "#3446a8", pale: "#c6d1f3" },
  { bg: "#d8f1f3", ink: "#11707a", pale: "#b9e2e6" },
  { bg: "#fdf0c4", ink: "#8a5a00", pale: "#f3dd94" },
  { bg: "#ece2f8", ink: "#5c2d91", pale: "#dccbf0" },
];
const tileStyle = (tone: Tone, size = 42) => ({ "--tile-bg": tone.bg, "--tile-ink": tone.ink, "--tile-size": `${size}px` } as CSSProperties);
const previewMinor = (value: string) => Math.round(Number(value.replace(/,/g, "")) * 100) || 0;
const isPlanTab = (value: string | null): value is PlanTab => PLAN_TABS.some((tab) => tab.id === value);

interface PlanningPageProps {
  calendarSystem: CalendarSystem;
  period: PeriodKey; currency: CurrencyCode; transactions: LedgerTransaction[]; budgets: Budget[]; recurringEntries: RecurringEntry[]; dueItems: DueItem[]; goals: SavingsGoal[]; customCategories: CustomCategory[]; paymentAccounts: PaymentAccount[];
  onPeriodChange: (period: PeriodKey) => void;
  onSaveBudget: (draft: { category: string; amount: string; monthKey: string; shared?: boolean }, id?: string) => Promise<void>;
  onDeleteBudget: (id: string) => Promise<void>;
  onSaveRecurring: (draft: RecurringDraft, id?: string) => Promise<void>;
  onDeleteRecurring: (id: string) => Promise<void>;
  onSaveGoal: (draft: { name: string; target: string; saved: string; targetDate: string }, id?: string) => Promise<void>;
  onContribute: (id: string, amount: string) => Promise<void>;
  onDeleteGoal: (id: string) => Promise<void>;
}

export function PlanningPage(props: PlanningPageProps) {
  const { calendarSystem, period, onPeriodChange } = props;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const linkedTab = searchParams.get("tab");
  // A festival link lands on Budgets; `?tab=` deep-links any other section.
  const [tab, setTab] = useState<PlanTab>(isPlanTab(linkedTab) ? linkedTab : "budgets");
  useEffect(() => { if (isPlanTab(linkedTab)) setTab(linkedTab); }, [linkedTab]);
  const choose = (next: PlanTab) => {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("festival");
    if (next === "budgets") params.delete("tab"); else params.set("tab", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const step = (delta: number) => { try { onPeriodChange(addMonthsToKey(period, delta)); } catch { /* outside the supported range */ } };
  const dueNow = useDueRecurringCount(props.recurringEntries);
  // Goals are not tied to a month, so the month stepper only shows where it changes something.
  const monthMatters = tab !== "goals" && tab !== "recurring";

  return (
    <div className="v2-page v2-plan">
      <header className="v2-page-head">
        <div><span className={`v2-eyebrow${monthMatters ? " is-beside-stepper" : ""}`}>Your money plan</span><h1>Plan</h1></div>
        {monthMatters && <div className="v2-head-actions">
          <span className="v2-chip is-stepper"><button type="button" onClick={() => step(-1)} aria-label="Previous month"><CaretLeft size={15} weight="bold" /></button><strong>{formatLedgerMonth(period, calendarSystem)}</strong><button type="button" onClick={() => step(1)} aria-label="Next month"><CaretRight size={15} weight="bold" /></button></span>
        </div>}
      </header>
      <div className="v2-seg v2-plan-tabs" role="tablist" aria-label="Plan sections">
        {PLAN_TABS.map(({ id, label, icon: Icon, tone }) => (
          <button key={id} type="button" role="tab" id={`plan-tab-${id}`} aria-controls="plan-panel" aria-selected={tab === id} className={tab === id ? "active" : undefined} onClick={() => choose(id)}>
            <span className="v2-tile" style={tileStyle(tone, 28)} aria-hidden="true"><Icon size={16} weight="duotone" /></span>
            <span>{label}</span>
            {id === "recurring" && dueNow > 0 && <span className="v2-seg-count" aria-label={`${dueNow} due`}>{dueNow}</span>}
          </button>
        ))}
      </div>
      <div id="plan-panel" role="tabpanel" aria-labelledby={`plan-tab-${tab}`}>
        {tab === "budgets" && <BudgetPlanner period={props.period} calendarSystem={calendarSystem} currency={props.currency} transactions={props.transactions} budgets={props.budgets} recurringEntries={props.recurringEntries} dueItems={props.dueItems} customCategories={props.customCategories} onSaveBudget={props.onSaveBudget} onDeleteBudget={props.onDeleteBudget} />}
        {tab === "goals" && <GoalsSection {...props} />}
        {tab === "recurring" && <RecurringSection {...props} />}
        {tab === "calendar" && <CalendarSection {...props} />}
      </div>
    </div>
  );
}

function useDueRecurringCount(entries: readonly RecurringEntry[]) {
  const today = useToday();
  return entries.filter((entry) => entry.active && entry.nextDueOn <= today).length;
}

/** A ring that fills as the goal does, with the percentage inside. */
function GoalRing({ percent, tone }: { percent: number; tone: Tone }) {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(100, Math.max(0, percent));
  return <span className="v2-goal-ring" aria-hidden="true">
    <svg viewBox="0 0 56 56"><circle cx="28" cy="28" r={radius} fill="none" stroke={tone.bg} strokeWidth="7" /><circle cx="28" cy="28" r={radius} fill="none" stroke={tone.ink} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(filled / 100) * circumference} ${circumference}`} transform="rotate(-90 28 28)" /></svg>
    <strong style={{ color: tone.ink }}>{filled >= 100 ? <Check size={18} weight="bold" /> : `${Math.round(filled)}%`}</strong>
  </span>;
}

function GoalsSection({ calendarSystem, currency, goals, onSaveGoal, onContribute, onDeleteGoal }: PlanningPageProps) {
  const today = useToday();
  // BS mode names the target day in both calendars; AD keeps the short month.
  const targetLabel = (date: string) => calendarSystem === "BS" ? formatLedgerDate(date, "BS") : format(parseISO(date), "MMM yyyy");
  const [name, setName] = useState(""); const [target, setTarget] = useState(""); const [targetDate, setTargetDate] = useState(""); const [contributions, setContributions] = useState<Record<string, string>>({}); const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); const [preview, setPreview] = useState<{ name: string; target: string; targetDate: string } | null>(null); const [pendingGoal, setPendingGoal] = useState<{ id: string; action: "contribute" | "delete" } | null>(null);
  const save = async (event: React.FormEvent) => { event.preventDefault(); if (saving) return; const draft = { name, target, targetDate }; setSaving(true); setPreview(draft); try { setError(null); await onSaveGoal({ ...draft, saved: "0" }); setName(""); setTarget(""); setTargetDate(""); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save goal."); } finally { setSaving(false); setPreview(null); } };
  const contribute = async (id: string) => { const amount = contributions[id] ?? ""; if (!amount || pendingGoal) return; setPendingGoal({ id, action: "contribute" }); try { setError(null); await onContribute(id, amount); setContributions((current) => ({ ...current, [id]: "" })); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not add contribution."); } finally { setPendingGoal(null); } };
  const remove = async (id: string) => { if (pendingGoal) return; setPendingGoal({ id, action: "delete" }); try { setError(null); await onDeleteGoal(id); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete goal."); } finally { setPendingGoal(null); } };
  const savedMinor = goals.reduce((sum, goal) => sum + goal.savedMinor, 0);
  const targetMinor = goals.reduce((sum, goal) => sum + goal.targetMinor, 0);
  // What still has to go in each month to land on the target date; nothing when there is no date or it has passed.
  const monthlyNeed = (goal: SavingsGoal) => {
    if (!goal.targetDate || goal.savedMinor >= goal.targetMinor) return null;
    const months = differenceInCalendarMonths(parseISO(goal.targetDate), parseISO(today));
    return months > 0 ? Math.ceil((goal.targetMinor - goal.savedMinor) / months / 100) * 100 : null;
  };

  return <div className="v2-plan-grid">
    <div className="v2-plan-main">
      {goals.length > 0 && <section className="v2-hero v2-goals-hero" aria-label="Savings goals">
        <span className="v2-hero-label">Saved across {goals.length} {goals.length === 1 ? "goal" : "goals"}</span>
        <strong className="v2-hero-amount amount">{formatMoney(savedMinor, currency)} <small>of {formatMoney(targetMinor, currency)}</small></strong>
        <span className="v2-pace is-light" role="img" aria-label={`${targetMinor ? Math.round((savedMinor / targetMinor) * 100) : 0}% saved`}><span className="is-spent" style={{ width: `${targetMinor ? Math.min(100, (savedMinor / targetMinor) * 100) : 0}%` }} /></span>
      </section>}
      <FormError message={error} />
      {(goals.length > 0 || preview) ? <ul className="v2-goal-grid">
        {preview && <li className="v2-card v2-goal is-pending" role="status">
          <div className="v2-goal-top"><GoalRing percent={0} tone={GOAL_TONES[goals.length % GOAL_TONES.length]} /><div className="v2-row-main"><strong>{preview.name}</strong><small><ButtonSpinner />Creating…</small></div></div>
          <div className="v2-goal-money"><strong className="amount">{formatMoney(0, currency)}</strong><span>of {formatMoney(previewMinor(preview.target), currency)}</span></div>
        </li>}
        {goals.map((goal, index) => {
          const tone = GOAL_TONES[index % GOAL_TONES.length];
          const percent = goal.targetMinor ? Math.round((goal.savedMinor / goal.targetMinor) * 100) : 0;
          const done = percent >= 100;
          const contributing = pendingGoal?.id === goal.id && pendingGoal.action === "contribute";
          const deleting = pendingGoal?.id === goal.id && pendingGoal.action === "delete";
          const need = monthlyNeed(goal);
          return <li className={`v2-card v2-goal${done ? " is-done" : ""}`} key={goal.id} aria-busy={contributing || deleting}>
            <div className="v2-goal-top">
              <GoalRing percent={percent} tone={tone} />
              <div className="v2-row-main"><strong>{goal.name}</strong><small>{deleting ? "Removing…" : done ? "Reached. Nicely done." : goal.targetDate ? `By ${targetLabel(goal.targetDate)}` : "No target date"}</small></div>
              <Menu position="bottom-end" shadow="md" withinPortal>
                <Menu.Target><button type="button" className="v2-icon-btn is-quiet" disabled={deleting} aria-label={`More actions for ${goal.name}`}>{deleting ? <ButtonSpinner /> : <DotsThree size={20} weight="bold" />}</button></Menu.Target>
                <Menu.Dropdown><Menu.Item color="red" leftSection={<Trash size={16} />} onClick={() => void remove(goal.id)}>Delete goal</Menu.Item></Menu.Dropdown>
              </Menu>
            </div>
            <div className="v2-goal-money"><strong className="amount">{formatMoney(goal.savedMinor, currency)}</strong><span>of {formatMoney(goal.targetMinor, currency)}</span></div>
            {!done && <p className="v2-goal-need">{formatMoney(goal.targetMinor - goal.savedMinor, currency)} to go{need ? <> · about <strong className="amount">{formatMoney(need, currency)}</strong> a month</> : null}</p>}
            {!done && <form className="v2-goal-add" onSubmit={(event) => { event.preventDefault(); void contribute(goal.id); }}>
              <NumberInput aria-label={`Add money to ${goal.name}`} placeholder="Add amount" value={contributions[goal.id] ?? ""} min={0} thousandSeparator="," decimalScale={2} disabled={contributing || deleting} onChange={(value) => setContributions((current) => ({ ...current, [goal.id]: String(value) }))} />
              <button type="submit" className="v2-button" disabled={contributing || deleting || !(contributions[goal.id] ?? "")}>{contributing ? <><ButtonSpinner />Adding…</> : <><Plus size={15} weight="bold" />Add</>}</button>
            </form>}
            <details className="v2-goal-history">
              <summary>History <span>{goal.contributions.length}</span></summary>
              {goal.contributions.length ? <ul>{goal.contributions.map((contribution) => <li key={contribution.id}><time dateTime={contribution.createdAt}>{contribution.isOpeningBalance ? "Opening balance · " : ""}{format(parseISO(contribution.createdAt), "MMM d, yyyy")}</time><strong className="amount v2-money is-in">+{plainAmount(contribution.amountMinor)}</strong></li>)}</ul> : <p className="v2-muted">Nothing added yet.</p>}
            </details>
          </li>;
        })}
      </ul> : <section className="v2-hero v2-budget-hero" aria-label="Savings goals">
        <span className="v2-hero-label">Savings goals</span>
        <strong className="v2-budget-hero-title">Save for something</strong>
        <p className="v2-budget-hero-copy">An emergency fund, a new phone, Dashain shopping. Give it a target and watch the ring fill as you add to it.</p>
      </section>}
    </div>
    <aside className="v2-plan-side">
      <section className="v2-card v2-plan-form" aria-labelledby="new-goal-heading">
        <header className="v2-card-head"><h2 id="new-goal-heading">New goal</h2></header>
        <form onSubmit={save} className="v2-form" aria-busy={saving}>
          <TextInput label="What for" value={name} onChange={(event) => setName(event.target.value)} placeholder="Emergency fund" required disabled={saving} />
          <NumberInput label={`Target in ${currency}`} value={target} onChange={(value) => setTarget(String(value))} placeholder="300,000" required disabled={saving} min={0} thousandSeparator="," decimalScale={2} />
          <DatePickerInput label="By when" description="Optional. We'll work out how much to put away each month." value={targetDate || null} onChange={(value) => setTargetDate(value ?? "")} disabled={saving} clearable valueFormat="MMM D, YYYY" firstDayOfWeek={0} />
          <div className="v2-form-actions"><button className="v2-button is-primary" disabled={saving}>{saving ? <><ButtonSpinner />Creating…</> : <><Plus size={17} weight="bold" />Create goal</>}</button></div>
        </form>
      </section>
    </aside>
  </div>;
}

const SCHEDULE_OPTIONS = [
  { value: "day:1", label: "Daily" },
  { value: "week:1", label: "Weekly" },
  { value: "week:2", label: "Every 2 weeks" },
  { value: "month:1", label: "Monthly" },
  { value: "month:3", label: "Every 3 months" },
  { value: "year:1", label: "Yearly" },
];

function RecurringSection({ calendarSystem, currency, transactions, recurringEntries, customCategories, paymentAccounts, onSaveRecurring, onDeleteRecurring }: PlanningPageProps) {
  const { setRecurringActive } = useLedger();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const today = useToday();
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
  const focusForm = () => document.getElementById("recurring-entry-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    focusForm();
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
    focusForm();
  };
  const runEntryAction = async (entry: RecurringEntry, action: "toggle" | "delete") => { if (pendingEntry) return; setPendingEntry({ id: entry.id, action }); try { setError(null); await (action === "toggle" ? setRecurringActive(entry.id, !entry.active) : onDeleteRecurring(entry.id)); } catch (caught) { setError(caught instanceof Error ? caught.message : `Could not ${action === "toggle" ? (entry.active ? "pause" : "resume") : "delete"} recurring entry.`); } finally { setPendingEntry(null); } };
  // Due first, then the soonest; paused ones last.
  const ordered = useMemo(() => [...recurringEntries].sort((a, b) => Number(b.active) - Number(a.active) || a.nextDueOn.localeCompare(b.nextDueOn)), [recurringEntries]);
  const due = ordered.filter((entry) => entry.active && entry.nextDueOn <= today);
  const monthlyOut = recurringEntries.filter((entry) => entry.active && entry.kind === "expense").reduce((sum, entry) => sum + monthlyEquivalent(entry), 0);
  const monthlyIn = recurringEntries.filter((entry) => entry.active && entry.kind === "income").reduce((sum, entry) => sum + monthlyEquivalent(entry), 0);

  const row = (entry: RecurringEntry) => {
    const ready = entry.active && entry.nextDueOn <= today;
    const toggling = pendingEntry?.id === entry.id && pendingEntry.action === "toggle";
    const deleting = pendingEntry?.id === entry.id && pendingEntry.action === "delete";
    const busy = toggling || deleting;
    const label = entry.note || getCategory(entry.category, customCategories).label;
    const account = entry.paymentAccountId ? paymentAccounts.find((item) => item.id === entry.paymentAccountId) : null;
    const when = deleting ? "Removing…" : toggling ? (entry.active ? "Pausing…" : "Resuming…") : !entry.active ? "Paused" : ready ? `Due ${formatLedgerDate(entry.nextDueOn, calendarSystem)}` : `Next ${formatLedgerDate(entry.nextDueOn, calendarSystem)}`;
    return <li key={entry.id} className={`v2-recurring-row${entry.active ? "" : " is-paused"}${ready ? " is-due" : ""}`} aria-busy={busy}>
      <CategoryTile category={entry.category} custom={customCategories} />
      <div className="v2-row-main">
        <strong>{label}</strong>
        <small>{recurrenceLabel(entry)} · {account ? paymentAccountLabel(account) : "Cash"}</small>
        <small className={ready ? "is-due" : undefined}>{when}</small>
      </div>
      <span className="v2-row-end">
        <strong className={`amount${entry.kind === "income" ? " v2-money is-in" : ""}`}>{entry.kind === "income" ? "+" : ""}{plainAmount(entry.amountMinor)}</strong>
        {ready && <button type="button" className="v2-button is-primary is-small" disabled={busy} onClick={() => setReviewingId(entry.id)}><Check size={14} weight="bold" />Log it</button>}
      </span>
      <Menu position="bottom-end" shadow="md" withinPortal>
        <Menu.Target><button type="button" className="v2-icon-btn is-quiet" disabled={busy} aria-label={`More actions for ${label}`}>{busy ? <ButtonSpinner /> : <DotsThree size={20} weight="bold" />}</button></Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<PencilSimple size={16} />} disabled={saving} onClick={() => edit(entry)}>Edit</Menu.Item>
          <Menu.Item leftSection={entry.active ? <PauseCircle size={16} /> : <PlayCircle size={16} />} disabled={saving} onClick={() => void runEntryAction(entry, "toggle")}>{entry.active ? "Pause" : "Resume"}</Menu.Item>
          <Menu.Item color="red" leftSection={<Trash size={16} />} onClick={() => void runEntryAction(entry, "delete")}>Delete</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </li>;
  };

  return <div className="v2-plan-grid">
    <div className="v2-plan-main">
      <section className="v2-hero v2-recurring-hero" aria-label="Recurring entries">
        <span className="v2-hero-label">{recurringEntries.length ? "Every month, on schedule" : "Recurring entries"}</span>
        {recurringEntries.length ? <>
          <div className="v2-recurring-totals">
            <span><small>Going out</small><strong className="amount">{formatMoney(monthlyOut, currency)}</strong></span>
            <span><small>Coming in</small><strong className="amount">{formatMoney(monthlyIn, currency)}</strong></span>
          </div>
          <span className="v2-hero-pill">{due.length ? `${due.length} ready to log` : "Nothing due today"}</span>
        </> : <>
          <strong className="v2-budget-hero-title">Nothing repeats yet</strong>
          <p className="v2-budget-hero-copy">Rent, salary, the internet bill. Schedule them once and they come back for you to confirm, so nothing is logged without a look.</p>
        </>}
      </section>
      <FormError message={error} />
      {suggestions.length > 0 && <section className="v2-card v2-suggest-card" aria-labelledby="recurring-suggestions-heading">
        <header className="v2-card-head"><h2 id="recurring-suggestions-heading"><Sparkle size={18} weight="duotone" />Looks like these repeat</h2></header>
        <ul className="v2-rows">{suggestions.map((suggestion) => <li key={suggestion.id} className="v2-suggest-row">
          <CategoryTile category={suggestion.category} custom={customCategories} />
          <div className="v2-row-main"><strong>{suggestion.note || getCategory(suggestion.category, customCategories).label}</strong><small>{recurrenceLabel(suggestion)} · seen {suggestion.evidenceCount} times · {Math.round(suggestion.confidence * 100)}% sure</small></div>
          <span className="v2-row-end"><strong className="amount">{plainAmount(suggestion.amountMinor)}</strong><button type="button" className="v2-link" onClick={() => useSuggestion(suggestion)}>Review</button></span>
        </li>)}</ul>
      </section>}
      {ordered.length > 0 && <section className="v2-card" aria-labelledby="recurring-list-heading">
        <header className="v2-card-head"><h2 id="recurring-list-heading">Scheduled</h2><span className="v2-muted">You confirm each one before it is logged</span></header>
        <ul className="v2-rows">{ordered.map(row)}</ul>
      </section>}
      <RecurringConfirmSheet entryId={reviewingId} onClose={() => setReviewingId(null)} />
    </div>
    <aside className="v2-plan-side">
      <section className={`v2-card v2-plan-form${editing ? " is-editing" : ""}`} id="recurring-entry-form" aria-labelledby="recurring-form-heading">
        <header className="v2-card-head"><h2 id="recurring-form-heading">{editing ? "Edit schedule" : "Schedule an entry"}</h2></header>
        <form onSubmit={save} className="v2-form" aria-busy={saving}>
          <div className="v2-seg is-kind" role="radiogroup" aria-label="Recurring entry type">
            {(["expense", "income"] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={kind === value} className={kind === value ? `active is-${value}` : undefined} disabled={saving} onClick={() => { setKind(value); setCategory(value === "expense" ? "housing" : "salary"); }}>{value === "expense" ? "Money out" : "Money in"}</button>)}
          </div>
          <Select label="Category" value={category} disabled={saving} onChange={(value) => value && setCategory(value)} data={allCategoriesFor(kind, customCategories).map((item) => ({ value: item.id, label: item.label }))} searchable allowDeselect={false} />
          <NumberInput label={`Amount in ${currency}`} value={amount} disabled={saving} onChange={(value) => setAmount(String(value))} required min={0} thousandSeparator="," decimalScale={2} />
          <TextInput label="Note" value={note} disabled={saving} onChange={(event) => setNote(event.target.value)} placeholder={kind === "expense" ? "Rent, Netflix, internet" : "Salary"} />
          <Select label={kind === "expense" ? "Paid from" : "Paid into"} description={onlineAccounts.length ? "Leave blank for cash." : "Add an account on Accounts to link one."} placeholder="Cash" value={paymentAccountId || null} disabled={saving} onChange={(value) => setPaymentAccountId(value ?? "")} data={onlineAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} searchable clearable />
          <div className="v2-form-pair">
            <Select label="Repeats" value={schedule} disabled={saving} onChange={(value) => value && setSchedule(value)} data={SCHEDULE_OPTIONS} allowDeselect={false} />
            <DatePickerInput label="First due" value={startOn} onChange={(value) => setStartOn(value ?? "")} disabled={saving} valueFormat="MMM D, YYYY" firstDayOfWeek={0} required />
          </div>
          <div className="v2-form-actions">
            {editing && <button type="button" className="v2-button" disabled={saving} onClick={resetForm}>Cancel</button>}
            <button className="v2-button is-primary" disabled={saving || !startOn}>{saving ? <><ButtonSpinner />Saving…</> : editing ? <><Check size={17} weight="bold" />Update schedule</> : <><Plus size={17} weight="bold" />Save schedule</>}</button>
          </div>
        </form>
      </section>
    </aside>
  </div>;
}

/** A schedule's amount spread over a month: weekly rent counts about 4.3 times, a yearly fee a twelfth. */
function monthlyEquivalent(entry: Pick<RecurringEntry, "amountMinor" | "recurrenceUnit" | "recurrenceInterval">) {
  const perUnit = entry.recurrenceUnit === "day" ? 30.44 : entry.recurrenceUnit === "week" ? 30.44 / 7 : entry.recurrenceUnit === "month" ? 1 : 1 / 12;
  return Math.round((entry.amountMinor * perUnit) / Math.max(1, entry.recurrenceInterval));
}

/** "1.2k", "48k": short enough for a calendar cell. */
const shortAmount = (minor: number) => {
  const major = Math.abs(minor) / 100;
  if (major >= 100_000) return `${Math.round(major / 1000)}k`;
  if (major >= 1000) return `${(major / 1000).toFixed(major >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(Math.round(major));
};

function CalendarSection({ period, currency, transactions, customCategories, calendarSystem }: PlanningPageProps) {
  const today = useToday();
  // Every day of the month in its own calendar: Ashwin 1 to Ashwin's last day for a BS month.
  const days = useMemo(() => { const { start, days: count } = periodRange(period); return Array.from({ length: count }, (_, index) => addDaysToIso(start, index)); }, [period]);
  const firstOffset = getDay(localDate(days[0]));
  // The number printed in each cell: the BS day in BS mode, the Gregorian day otherwise.
  const dayNumber = (iso: string) => parseMonthKey(period).system === "BS" ? String(calendarFor("BS").fromIso(iso).day) : String(Number(iso.slice(8, 10)));
  const totals = useMemo(() => dailyCashFlow(transactions), [transactions]);
  const [selectedKey, setSelectedKey] = useState(() => isInMonth(today, period) ? today : periodRange(period).start);
  useEffect(() => { setSelectedKey((current) => isInMonth(current, period) ? current : isInMonth(today, period) ? today : periodRange(period).start); }, [period, today]);
  const selectedEntries = useMemo(() => transactions.filter((item) => item.occurredOn === selectedKey), [selectedKey, transactions]);
  const selectedTotal = totals.get(selectedKey);
  // Spending days are shaded by how big they were next to the month's biggest day.
  const biggestDay = Math.max(1, ...days.map((key) => totals.get(key)?.expenses ?? 0));
  const monthOut = days.reduce((sum, key) => sum + (totals.get(key)?.expenses ?? 0), 0);
  const monthIn = days.reduce((sum, key) => sum + (totals.get(key)?.income ?? 0), 0);
  const spendDays = days.filter((key) => (totals.get(key)?.expenses ?? 0) > 0).length;

  return <div className="v2-plan-grid is-calendar">
    <div className="v2-plan-main">
      <section className="v2-card v2-cal" aria-label={`${formatLedgerMonth(period, calendarSystem)} calendar`}>
        <div className="v2-cal-summary">
          <span><small>Out</small><strong className="amount">{formatMoney(monthOut, currency)}</strong></span>
          <span><small>In</small><strong className="amount v2-money is-in">{formatMoney(monthIn, currency)}</strong></span>
          <span><small>Spending days</small><strong>{spendDays} of {days.length}</strong></span>
        </div>
        <div className="v2-cal-week" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="v2-cal-grid">
          {Array.from({ length: firstOffset }).map((_, index) => <span key={`blank-${index}`} />)}
          {days.map((key) => {
            const total = totals.get(key);
            const heat = total ? Math.min(1, total.expenses / biggestDay) : 0;
            const summary = total ? `Spent ${formatMoney(total.expenses, currency)}, received ${formatMoney(total.income, currency)}` : "No entries";
            return <button key={key} type="button" className={`v2-cal-day${key === selectedKey ? " is-selected" : ""}${key === today ? " is-today" : ""}${key > today ? " is-later" : ""}${total?.income ? " has-income" : ""}`} style={{ "--heat": heat.toFixed(2) } as CSSProperties} onClick={() => setSelectedKey(key)} aria-pressed={key === selectedKey} aria-label={`${formatLedgerDay(key, calendarSystem, "date")}. ${summary}`}>
              <strong>{dayNumber(key)}</strong>
              {total && total.expenses > 0 && <span className="amount">{shortAmount(total.expenses)}</span>}
              {total && total.income > 0 && <i aria-hidden="true" />}
            </button>;
          })}
        </div>
        <p className="v2-footnote v2-cal-key"><span><i className="is-heat" />Darker means more spent</span><span><i className="is-income" />Money came in</span></p>
      </section>
    </div>
    <aside className="v2-plan-side">
      <section className="v2-card v2-cal-detail" aria-live="polite" aria-labelledby="calendar-day-heading">
        <header className="v2-card-head"><h2 id="calendar-day-heading">{formatLedgerDay(selectedKey, calendarSystem)}</h2></header>
        {selectedTotal ? <div className="v2-totals">
          <span className="v2-total is-out"><span>Out</span><strong className="amount">{plainAmount(selectedTotal.expenses)}</strong></span>
          <span className="v2-total is-in"><span>In</span><strong className="amount">{plainAmount(selectedTotal.income)}</strong></span>
        </div> : <p className="v2-empty">{selectedKey > today ? "Hasn't happened yet." : "A quiet day. Nothing logged."}</p>}
        {selectedEntries.length > 0 && <ul className="v2-rows">{selectedEntries.map((item) => <li key={item.id} className="v2-row">
          <CategoryTile category={item.category} custom={customCategories} />
          <span className="v2-row-main"><strong>{item.note || getCategory(item.category, customCategories).label}</strong><small>{getCategory(item.category, customCategories).label}</small></span>
          <span className="v2-row-end"><strong className={`amount${item.kind === "income" ? " v2-money is-in" : ""}`}>{item.kind === "income" ? "+" : ""}{plainAmount(item.amountMinor)}</strong></span>
        </li>)}</ul>}
      </section>
    </aside>
  </div>;
}
