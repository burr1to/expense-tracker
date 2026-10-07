import { ArrowRight, Bank, CalendarBlank, CaretDown, Check, Flag, Lightbulb, MapPinLine, Minus, Plus, Repeat, TrendDown, TrendUp, WarningCircle } from "@phosphor-icons/react";
import { Popover, SegmentedControl } from "@mantine/core";
import { DatePicker } from "@mantine/dates";
import { format, isSameMonth, parseISO, startOfMonth } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "../components/EmptyState";
import { BalanceLocked, BalancePinHint, SetUpPinLink } from "../components/BalancePrivacy";
import { MonthPicker } from "../components/MonthPicker";
import { TransactionRow } from "../components/TransactionRow";
import { TransferRow } from "../components/TransferRow";
import { RecurringConfirmSheet } from "../components/RecurringConfirmSheet";
import { FestivalHeadsUp } from "../components/FestivalHeadsUp";
import { ALL_SPENDING_LABEL, budgetAllowanceText, budgetLabel, isAllSpendingBudget } from "../lib/budgets";
import { getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { formatLedgerDay, formatLedgerMonth, isInMonth, monthKey } from "../lib/dates";
import { dailyExpenseSeries, summarizeLedger } from "../lib/ledger";
import { generateInsights } from "../lib/insights";
import { buildMonthSnapshot, type MonthSnapshot } from "../lib/month-snapshot";
import { useToday } from "../lib/use-today";
import { useBalancePrivacy } from "../context/LedgerWorkspaceContext";
import { calculatePlaceSpendingTrends, placeTrendPeriodOptions, type PlaceSpendingTrend, type PlaceTrendPeriodMonths } from "../lib/place-spending-trends";
import { calculateBudgetPacing, calculateSafeToSpendV2, committedBeforeHorizon, detectSpendingHorizon, recurringAwaitingConfirmation } from "../lib/planning-insights";
import { spendingPeriodOptions, spendingPeriodRange, type SpendingPeriod } from "../lib/spending-period";
import { totalCurrentBalance } from "../lib/account-balances";
import { paymentAccountLabel } from "../lib/payment-accounts";
import { forecastCash } from "../lib/cash-forecast";
import { listLedgerActivity, transferAccountLabel } from "../lib/transaction-history";
import type { AccountTransfer, CalendarSystem, AppView, Budget, CurrencyCode, CustomCategory, DueItem, LedgerTransaction, PaymentAccount, RecurringEntry, SavedPlace, SavingsGoal } from "../types";

interface DashboardPageProps {
  month: Date;
  focus: { date: string; revision: number } | null;
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  transfers: AccountTransfer[];
  budgets: Budget[];
  recurringEntries: RecurringEntry[];
  dueItems: DueItem[];
  goals: SavingsGoal[];
  customCategories: CustomCategory[];
  paymentAccounts: PaymentAccount[];
  savedPlaces: SavedPlace[];
  hasPin: boolean;
  safeToSpendBufferMinor: number;
  calendarSystem: CalendarSystem;
  onMonthChange: (date: Date) => void;
  onAdd: (occurredOn: string) => void;
  onSelectedDayChange: (occurredOn: string) => void;
  onNavigate: (view: AppView) => void;
  onOpenPlace: (placeKey: string) => void;
  /** Unused: balances unlock once per session through the workspace (LedgerAppLayout). */
  onVerifyPin?: (pin: string) => Promise<void>;
}

function placeTrendExplanation(trend: PlaceSpendingTrend) {
  const spendingDirection = trend.currentTotalMinor >= trend.previousTotalMinor ? "increase" : "decrease";
  if (trend.driver === "steady") return "Spending stayed close to the previous period.";
  if (trend.driver === "frequency") {
    const purchases = Math.abs(trend.purchaseChange);
    return `${purchases} ${purchases === 1 ? "purchase" : "purchases"} ${trend.purchaseChange > 0 ? "more" : "fewer"} drove most of the ${spendingDirection}.`;
  }
  if (trend.driver === "average") return `Average purchase ${trend.averageChangePercent >= 0 ? "rose" : "fell"} ${Math.abs(trend.averageChangePercent)}%.`;
  return `Both purchase frequency and average spend contributed to the ${spendingDirection}.`;
}

function spendingHorizonLabel(horizon: { throughDate: string; daysRemaining: number; source: string }) {
  const until = format(parseISO(horizon.throughDate), "MMM d");
  const days = horizon.daysRemaining === 1 ? "1 day" : `${horizon.daysRemaining} days`;
  if (horizon.source === "payday") return `Covers ${days}, until your next scheduled income on ${until}.`;
  if (horizon.source === "incomePattern") return `Covers ${days}, until ${until} — when you usually get paid.`;
  return `Covers ${days}, until the end of the month on ${until}.`;
}

/** "NPR 1,200 less than September up to the same day (−8%)": the card's comparison when there is no budget. */
function previousMonthLine(target: Extract<MonthSnapshot["target"], { kind: "previousMonth" }>, currency: CurrencyCode, calendarSystem: CalendarSystem) {
  const name = formatLedgerMonth(target.previousMonth, calendarSystem);
  const when = target.throughDay === null ? `all of ${name}` : `${name} up to the same day`;
  if (target.changePercentage === null) return <>Nothing logged in {when}, so there is nothing to compare yet.</>;
  const difference = target.currentMinor - target.previousMinor;
  if (difference === 0) return <>The same as {when}.</>;
  return <><span className="amount">{formatMoney(Math.abs(difference), currency)}</span> {difference > 0 ? "more" : "less"} than {when} ({difference > 0 ? "+" : "−"}{Math.abs(target.changePercentage)}%)</>;
}

export function DashboardPage({ month, focus, currency, transactions, transfers, budgets, recurringEntries, dueItems, goals, customCategories, paymentAccounts, savedPlaces, hasPin, safeToSpendBufferMinor, calendarSystem, onMonthChange, onAdd, onSelectedDayChange, onNavigate, onOpenPlace }: DashboardPageProps) {
  // Kathmandu today, kept current in a tab left open overnight.
  const today = useToday();
  const [reviewingRecurringId, setReviewingRecurringId] = useState<string | null>(null);
  const [showAllDue, setShowAllDue] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date>(() => isSameMonth(month, parseISO(today)) ? parseISO(today) : startOfMonth(month));
  const [spendingPeriod, setSpendingPeriod] = useState<SpendingPeriod>("weekly");
  const [placeTrendPeriod, setPlaceTrendPeriod] = useState<PlaceTrendPeriodMonths>(1);
  const [forecastDays, setForecastDays] = useState("30");
  const privacy = useBalancePrivacy(hasPin);
  const hasAccounts = paymentAccounts.length > 0;
  // Balances, safe-to-spend and the forecast share one gate: shown without a PIN, or once unlocked this session.
  const balancesLive = privacy.visible && hasAccounts;
  useEffect(() => {
    if (focus) setSelectedDay(parseISO(focus.date));
  }, [focus]);
  const monthTransactions = useMemo(() => transactions.filter((item) => isInMonth(item.occurredOn, month)), [month, transactions]);
  const summary = useMemo(() => summarizeLedger(monthTransactions, customCategories), [customCategories, monthTransactions]);
  const trackedBalance = totalCurrentBalance(paymentAccounts);
  const forecast = useMemo(() => forecastCash({ startingBalanceMinor: trackedBalance, transactions, recurringEntries, dueItems, today }), [dueItems, recurringEntries, today, trackedBalance, transactions]);
  const forecastPoint = forecast.days[Number(forecastDays) - 1] ?? forecast.day30;
  const spendingRange = spendingPeriodRange(spendingPeriod, selectedDay);
  const spendingTransactions = useMemo(() => transactions.filter((item) => item.occurredOn >= spendingRange.startKey && item.occurredOn <= spendingRange.endKey), [spendingRange.endKey, spendingRange.startKey, transactions]);
  const chartData = useMemo(() => dailyExpenseSeries(spendingTransactions), [spendingTransactions]);
  const spendingRangeLabel = `${format(spendingRange.start, spendingRange.start.getFullYear() === spendingRange.end.getFullYear() ? "MMM d" : "MMM d, yyyy")} – ${format(spendingRange.end, "MMM d, yyyy")}`;
  const placeTrendSets = useMemo(() => placeTrendPeriodOptions.map((option) => ({
    ...option,
    trends: calculatePlaceSpendingTrends(transactions, savedPlaces, option.value, selectedDay),
  })), [savedPlaces, selectedDay, transactions]);
  const hasPlaceTrends = placeTrendSets.some((set) => set.trends.length > 0);
  const activePlaceTrendSet = placeTrendSets.find((set) => set.value === placeTrendPeriod) ?? placeTrendSets[0];
  useEffect(() => {
    if (!hasPlaceTrends || activePlaceTrendSet.trends.length) return;
    const firstAvailable = placeTrendSets.find((set) => set.trends.length > 0);
    if (firstAvailable) setPlaceTrendPeriod(firstAvailable.value);
  }, [activePlaceTrendSet.trends.length, hasPlaceTrends, placeTrendSets]);
  const selectedDayKey = format(selectedDay, "yyyy-MM-dd");
  useEffect(() => { onSelectedDayChange(selectedDayKey); }, [onSelectedDayChange, selectedDayKey]);
  // When the date changes under an open tab, a view sitting on "today" follows it to the new day (and month).
  const followedToday = useRef(today);
  useEffect(() => {
    const previous = followedToday.current;
    if (previous === today) return;
    followedToday.current = today;
    if (selectedDayKey !== previous) return;
    const next = parseISO(today);
    setSelectedDay(next);
    if (!isSameMonth(month, next)) onMonthChange(next);
  }, [month, onMonthChange, selectedDayKey, today]);
  const dayTransactions = useMemo(() => transactions.filter((item) => item.occurredOn === selectedDayKey), [selectedDayKey, transactions]);
  const dayEntries = useMemo(() => listLedgerActivity(transactions, transfers, paymentAccounts, customCategories, {
    scope: "day", selectedDayKey, kind: "all", category: "all", from: "", to: "", minMinor: null, maxMinor: null, paymentMode: "all", query: "",
  }), [customCategories, paymentAccounts, selectedDayKey, transactions, transfers]);
  const daySummary = useMemo(() => summarizeLedger(dayTransactions, customCategories), [customCategories, dayTransactions]);
  const insights = useMemo(() => generateInsights(transactions, month, currency, customCategories, { recurringEntries, dueItems, calendarSystem, today }), [calendarSystem, currency, customCategories, dueItems, month, recurringEntries, today, transactions]);
  const currentBudgets = useMemo(() => budgets.filter((item) => item.monthKey === monthKey(month)), [budgets, month]);
  const budgetPacing = useMemo(() => calculateBudgetPacing(currentBudgets, transactions, recurringEntries, dueItems, month, parseISO(today)), [currentBudgets, dueItems, month, recurringEntries, today, transactions]);
  const snapshot = useMemo(() => buildMonthSnapshot({ month, today, transactions, recurringEntries, dueItems, budgetPacing }), [budgetPacing, dueItems, month, recurringEntries, today, transactions]);
  const spendingHorizon = useMemo(() => detectSpendingHorizon(recurringEntries, transactions, month, today), [month, recurringEntries, today, transactions]);
  const committedMinor = useMemo(() => committedBeforeHorizon(recurringEntries, dueItems, spendingHorizon, today), [dueItems, recurringEntries, spendingHorizon, today]);
  const safeToSpend = calculateSafeToSpendV2(trackedBalance, committedMinor, spendingHorizon, safeToSpendBufferMinor, recurringAwaitingConfirmation(recurringEntries, today));
  const currentMonth = snapshot.timing === "current";
  // The card carries the month's net, so the pace-based projection insight would only be a second, different estimate.
  const visibleInsights = insights.filter((insight) => insight.id !== "projection").slice(0, 3);
  // An "All spending" limit already covers every category, so it leads the home row instead of being added to the category totals.
  const totalBudgetPacing = budgetPacing.find((item) => isAllSpendingBudget(item.budget));
  const categoryBudgetPacing = budgetPacing.filter((item) => !isAllSpendingBudget(item.budget));
  const budgetTotal = categoryBudgetPacing.reduce((sum, item) => sum + item.budget.amountMinor, 0);
  const budgetSpent = categoryBudgetPacing.reduce((sum, item) => sum + item.spentMinor, 0);
  const budgetUpcoming = categoryBudgetPacing.reduce((sum, item) => sum + item.upcomingMinor, 0);
  const budgetProjected = budgetSpent + budgetUpcoming;
  const budgetPercentage = budgetTotal > 0 ? Math.round((budgetProjected / budgetTotal) * 100) : 0;
  const budgetRisk = [...budgetPacing].filter((item) => item.tone !== "healthy").sort((a, b) => b.projectedPercentage - a.projectedPercentage)[0];
  const upcomingEntries = recurringEntries.filter((entry) => entry.active).sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn));
  const highlightedGoal = [...goals].sort((a, b) => {
    if (!a.targetDate) return 1;
    if (!b.targetDate) return -1;
    return a.targetDate.localeCompare(b.targetDate);
  })[0];
  const goalPercentage = highlightedGoal?.targetMinor ? Math.round((highlightedGoal.savedMinor / highlightedGoal.targetMinor) * 100) : 0;
  const hasPlans = currentBudgets.length > 0 || goals.length > 0 || upcomingEntries.length > 0;
  const dueEntries = useMemo(() => recurringEntries.filter((entry) => entry.active && entry.nextDueOn <= today).sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn)), [recurringEntries, today]);
  const visibleDueEntries = showAllDue ? dueEntries : dueEntries.slice(0, 3);
  const changeMonth = (nextMonth: Date) => {
    onMonthChange(nextMonth);
    if (!isSameMonth(selectedDay, nextMonth)) setSelectedDay(isSameMonth(nextMonth, parseISO(today)) ? parseISO(today) : startOfMonth(nextMonth));
  };
  const selectDay = (value: string | null) => {
    if (!value) return;
    const nextDay = parseISO(value);
    setSelectedDay(nextDay);
    if (!isSameMonth(month, nextDay)) onMonthChange(nextDay);
  };
  const { target } = snapshot;
  const budgetTarget = target.kind === "allSpending" || target.kind === "categoryBudgets" ? target : null;
  const budgetDaysLeft = budgetPacing[0]?.remainingDays ?? 0;
  const monthName = formatLedgerMonth(month, calendarSystem);

  return (
    <div className="page dashboard-page">
      <header className="dashboard-header">
        <div>
          <MonthPicker calendarSystem={calendarSystem} month={month} onChange={changeMonth} />
          <Popover position="bottom-start" shadow="md" withArrow>
            <Popover.Target>
              <button className="current-date" aria-label={`Choose day. Selected ${formatLedgerDay(selectedDay, calendarSystem)}`}>
                {formatLedgerDay(selectedDay, calendarSystem)} <CaretDown size={13} weight="bold" />
              </button>
            </Popover.Target>
            <Popover.Dropdown className="day-picker-popover">
              <DatePicker value={selectedDayKey} onChange={selectDay} firstDayOfWeek={0} />
            </Popover.Dropdown>
          </Popover>
        </div>
        <button className="desktop-quick-add primary-button" onClick={() => onAdd(selectedDayKey)}><Plus size={18} />Add transaction</button>
      </header>

      {dueEntries.length > 0 && <section className="due-strip" id="due-recurring-strip"><div><CalendarBlank size={23} weight="duotone" /><div><strong>{dueEntries.length} recurring {dueEntries.length === 1 ? "entry is" : "entries are"} ready</strong><span>Tap one to record it, adjust the amount, or skip it.</span></div></div><div className="due-strip-entries">{visibleDueEntries.map((entry) => { const label = entry.note || getCategory(entry.category, customCategories).label; return <button key={entry.id} onClick={() => setReviewingRecurringId(entry.id)} aria-label={`Review ${label}`}><Check size={15} /><span className="due-strip-label">{label}</span><span className="amount">{formatMoney(entry.amountMinor, currency)}</span></button>; })}{dueEntries.length > visibleDueEntries.length && <button className="due-strip-more" onClick={() => setShowAllDue(true)}>+{dueEntries.length - visibleDueEntries.length} more</button>}</div></section>}

      <section className="month-card" aria-labelledby="month-card-title">
        <div className="month-card-main">
          <span className="section-label" id="month-card-title">{currentMonth ? `This month · ${monthName}` : monthName}</span>
          <small className="month-card-kicker">{currentMonth ? "Spent so far" : "Spent"}</small>
          <h2 className="amount">{formatMoney(snapshot.spentMinor, currency)}</h2>
          {budgetTarget ? <>
            <div className={`bar-track month-card-bar${budgetTarget.percentage >= 100 ? " over" : budgetTarget.percentage >= 80 ? " warning" : ""}`} role="progressbar" aria-label="Budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, budgetTarget.percentage)}><span style={{ width: `${Math.min(100, budgetTarget.percentage)}%` }} /></div>
            <p className="month-card-target">{budgetTarget.kind === "allSpending"
              ? <>{budgetTarget.percentage}% of your <span className="amount">{formatMoney(budgetTarget.limitMinor, currency)}</span> {ALL_SPENDING_LABEL} budget</>
              : <><span className="amount">{formatMoney(budgetTarget.spentMinor, currency)}</span> of <span className="amount">{formatMoney(budgetTarget.limitMinor, currency)}</span> across {budgetTarget.count} category {budgetTarget.count === 1 ? "budget" : "budgets"} ({budgetTarget.percentage}%)</>}</p>
          </> : <p className="month-card-target">{target.kind === "previousMonth" ? previousMonthLine(target, currency, calendarSystem) : "This month has not started yet."}</p>}
        </div>
        <div className="month-card-figures">
          <div className="month-card-figure">
            <small>{snapshot.netIsEstimate ? "Projected net · estimate" : "Net for the month"}</small>
            <strong className={`amount${snapshot.netMinor < 0 ? " negative" : ""}`}>{formatMoney(snapshot.netMinor, currency)}</strong>
            <span>{snapshot.timing === "past" ? "Income minus expenses." : currentMonth ? "Logged so far, plus the income, bills and dues still scheduled this month." : "Scheduled income, bills and dues for the month."}</span>
          </div>
          {currentMonth && <div className="month-card-figure">
            {balancesLive ? <>
              <small>Safe to spend</small>
              <strong className={`amount${safeToSpend.totalMinor < 0 ? " negative" : ""}`}>{formatMoney(safeToSpend.perDayMinor, currency)}<em>/day</em></strong>
              <span>{spendingHorizonLabel(spendingHorizon)} {safeToSpend.totalMinor < 0
                ? <>What is already committed{safeToSpend.bufferMinor > 0 ? " and your buffer" : ""} comes to <span className="amount">{formatMoney(-safeToSpend.totalMinor, currency)}</span> more than your tracked balance.</>
                : <><span className="amount">{formatMoney(safeToSpend.totalMinor, currency)}</span> left after <span className="amount">{formatMoney(safeToSpend.committedMinor, currency)}</span> already committed{safeToSpend.bufferMinor > 0 ? <> and <span className="amount">{formatMoney(safeToSpend.bufferMinor, currency)}</span> kept back</> : null}.</>} A planning guide, not a live bank balance.</span>
            </> : snapshot.budgetDailyMinor !== null ? <>
              <small>Your budget allows</small>
              <strong className="amount">{formatMoney(snapshot.budgetDailyMinor, currency)}<em>/day</em></strong>
              <span>For the {budgetDaysLeft} {budgetDaysLeft === 1 ? "day" : "days"} left, after upcoming bills.</span>
              {hasAccounts && <BalanceLocked compact title="Safe to spend is hidden" />}
            </> : hasAccounts ? <>
              <small>Safe to spend</small>
              <BalanceLocked compact title="Hidden" />
            </> : <>
              <small>Per day</small>
              <span>Add an account or a budget to see what you can spend each day.</span>
              <button type="button" className="text-button" onClick={() => onNavigate("plan")}>Set a budget <ArrowRight size={14} /></button>
            </>}
          </div>}
        </div>
        {currentMonth && balancesLive && safeToSpend.overdueRecurringMinor > 0 && <p className="safe-to-spend-waiting">Includes <span className="amount">{formatMoney(safeToSpend.overdueRecurringMinor, currency)}</span> in recurring bills waiting to be confirmed. <button type="button" className="text-button" onClick={() => document.getElementById("due-recurring-strip")?.scrollIntoView({ behavior: "smooth", block: "center" })}>Review</button></p>}
        {snapshot.riskiest && <button type="button" className={`month-card-risk ${snapshot.riskiest.tone}`} onClick={() => onNavigate("plan")}><WarningCircle size={18} weight="duotone" /><span><strong>{budgetLabel(snapshot.riskiest.budget.category, customCategories)}: {snapshot.riskiest.alertTitle}</strong><small>{snapshot.riskiest.alertDetail}</small></span><ArrowRight size={15} /></button>}
      </section>

      <section className="recent-section dashboard-day-activity">
        <div className="section-heading"><div><span className="section-label">{formatLedgerDay(selectedDay, calendarSystem, "date")} transactions</span><h2>{dayEntries.length ? `${dayEntries.length} ${dayEntries.length === 1 ? "entry" : "entries"}` : "No activity"}</h2></div><button className="text-button" onClick={() => onNavigate("transactions")}>Full history <ArrowRight size={16} /></button></div>
        <div className="transaction-list">
          {dayEntries.map((entry) => entry.type === "transaction"
            ? <TransactionRow key={`transaction-${entry.transaction.id}`} transaction={entry.transaction} currency={currency} customCategories={customCategories} compact tapToEdit />
            : <TransferRow key={`transfer-${entry.transfer.id}`} transfer={entry.transfer} fromLabel={transferAccountLabel(paymentAccounts, entry.transfer.fromAccountId)} toLabel={transferAccountLabel(paymentAccounts, entry.transfer.toAccountId)} currency={currency} compact />)}
          {!dayEntries.length && <EmptyState title="No activity this day" message="Choose another day, add an entry, or record a transfer from Accounts." action={<button className="primary-button small" onClick={() => onAdd(selectedDayKey)}><CalendarBlank size={17} />Add transaction</button>} />}
        </div>
        {dayTransactions.length > 0 && <div className="dashboard-day-summary" aria-label={`Income and expenses for ${format(selectedDay, "MMMM d")}`}>
          <div><span>Income</span><strong className="income">{formatMoney(daySummary.income, currency)}</strong></div>
          <div><span>Expenses</span><strong className="expense">{formatMoney(daySummary.expenses, currency)}</strong></div>
        </div>}
      </section>

      <FestivalHeadsUp transactions={transactions} budgets={budgets} currency={currency} />

      <div className="spending-period-bar">
        <div>
          <span className="section-label">Daily rhythm period</span>
          <strong>{spendingRangeLabel}</strong>
        </div>
        <label className="spending-period-control">
          <span>Period</span>
          <select value={spendingPeriod} onChange={(event) => setSpendingPeriod(event.currentTarget.value as SpendingPeriod)}>
            {spendingPeriodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>

      <section className="dashboard-grid" aria-live="polite">
        <div className="chart-section">
          <div className="section-heading"><div><span className="section-label">Spending overview</span><h2>Daily rhythm</h2></div><span>{spendingPeriodOptions.find((option) => option.value === spendingPeriod)?.label}</span></div>
          {chartData.length ? (
            <div className="chart-wrap" aria-label="Daily expense chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 12, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#cbd3c9" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#5c6e63", fontSize: 11 }} />
                  <YAxis tickFormatter={(value) => formatMoney(Number(value), currency, true)} axisLine={false} tickLine={false} tick={{ fill: "#5c6e63", fontSize: 10 }} />
                  <Tooltip
                    cursor={{ stroke: "rgba(85, 127, 105, .24)", strokeWidth: 1 }}
                    isAnimationActive={false}
                    content={({ active, payload }) => {
                      const point = payload?.[0]?.payload as { date?: string; label?: string; amount?: number } | undefined;
                      if (!active || !point) return null;
                      return (
                        <div className="spending-tooltip" role="status">
                          <span>{point.date ? format(parseISO(point.date), "EEEE, MMMM d") : point.label}</span>
                          <div><i aria-hidden="true" /><small>Spent</small></div>
                          <strong>{formatMoney(Number(point.amount ?? payload?.[0]?.value ?? 0), currency)}</strong>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="amount" fill="#dfe8df" radius={[2, 2, 0, 0]} barSize={28} isAnimationActive={false} />
                  <Line type="monotone" dataKey="amount" stroke="#557f69" strokeWidth={2.6} dot={{ r: 3.5, fill: "#557f69", strokeWidth: 0 }} activeDot={{ r: 5, fill: "#557f69", stroke: "#557f69", strokeWidth: 0 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyState action={<button className="text-button" onClick={() => onAdd(selectedDayKey)}>Add an expense</button>} />}
        </div>

        <div className="category-section">
          {/* The selected month, like the "This month" card above, so the two always add up to the same spending. */}
          <div className="section-heading"><div><span className="section-label">Where it went · {monthName}</span><h2>Top categories</h2></div><button className="text-button" onClick={() => onNavigate("reports")}>Full report <ArrowRight size={16} /></button></div>
          <div className="category-bars">
            {summary.categories.slice(0, 5).map((item) => (
              <div className="category-bar" key={item.category}>
                <div><span>{item.label}</span><strong>{formatMoney(item.value, currency)}</strong></div>
                <div className="bar-track"><span style={{ width: `${item.percentage}%`, backgroundColor: item.color }} /></div>
                <small>{item.percentage}%</small>
              </div>
            ))}
            {!summary.categories.length && <EmptyState />}
          </div>
        </div>
      </section>

      {hasPlaceTrends && <section className="place-spending-section" aria-labelledby="place-spending-title">
        <div className="place-spending-heading">
          <div><span className="section-label">Places over time</span><h2 id="place-spending-title">Where spending changed</h2><p>Compared with the previous {activePlaceTrendSet.label}. Changes separate purchase frequency from average spend.</p></div>
          <div className="place-period-control" aria-label="Place spending comparison period">
            {placeTrendSets.map((set) => <button type="button" key={set.value} className={placeTrendPeriod === set.value ? "active" : ""} disabled={!set.trends.length} onClick={() => setPlaceTrendPeriod(set.value)} aria-pressed={placeTrendPeriod === set.value}>{set.shortLabel}</button>)}
          </div>
        </div>
        <div className="place-spending-list">
          {activePlaceTrendSet.trends.slice(0, 3).map((trend) => {
            const increased = trend.totalChangePercent > 0;
            const steady = trend.driver === "steady";
            const TrendIcon = steady ? Minus : increased ? TrendUp : TrendDown;
            return <button type="button" className="place-spending-row" key={trend.key} onClick={() => onOpenPlace(trend.key)}>
              <span className={`place-trend-icon ${increased ? "up" : "down"}`}><MapPinLine size={18} weight="duotone" /></span>
              <span className="place-trend-copy"><strong>{trend.label}</strong><small>{placeTrendExplanation(trend)}</small></span>
              <span className="place-trend-change"><strong className={steady ? undefined : increased ? "expense" : "income"}><TrendIcon size={14} />{steady ? "Stable" : `${increased ? "+" : ""}${trend.totalChangePercent}%`}</strong><small>vs previous</small></span>
              <span className="place-trend-stats">
                <span><small>Spent</small><strong className="map-amount">{formatMoney(trend.currentTotalMinor, currency)}</strong></span>
                <span><small>Purchases</small><strong>{trend.currentPurchases}</strong></span>
                <span><small>Average</small><strong className="map-amount">{formatMoney(trend.currentAverageMinor, currency)}</strong></span>
              </span>
              <ArrowRight size={16} className="place-trend-arrow" />
            </button>;
          })}
        </div>
        <p className="place-spending-note">This reflects your spending pattern, not item-level price inflation.</p>
      </section>}

      <section className={`account-balance-card${balancesLive ? " unlocked" : " locked"}`} aria-label="Tracked account balances">
        {balancesLive ? <>
          <div className="account-balance-heading">
            <div>
              <span className="section-label">Your money right now</span>
              <h2 className={`amount${trackedBalance < 0 ? " negative" : ""}`}>{formatMoney(trackedBalance, currency)}</h2>
              <p>Across {paymentAccounts.length} manually tracked {paymentAccounts.length === 1 ? "account" : "accounts"}</p>
            </div>
            <Bank size={27} weight="duotone" />
          </div>
          {paymentAccounts.length ? (
            <ul className="account-balance-list">
              {paymentAccounts.map((account) => (
                <li key={account.id} className="account-balance-item">
                  <span className="account-balance-copy">
                    <strong>{paymentAccountLabel(account)}</strong>
                    <small>Checked {account.balanceAsOf}</small>
                  </span>
                  <strong className={`account-balance-amount amount${account.currentBalanceMinor < 0 ? " negative" : ""}`}>{formatMoney(account.currentBalanceMinor, currency)}</strong>
                </li>
              ))}
            </ul>
          ) : null}
          {!hasPin && <BalancePinHint />}
        </> : hasAccounts ? <>
          <span className="section-label">Your money right now</span>
          <BalanceLocked title="Account balances are hidden" detail="Enter your ledger PIN once to show the total, each account, safe-to-spend and the forecast on every page until the app locks." />
        </> : <div className="account-balance-locked">
          <span className="account-balance-lock-icon"><Bank size={24} weight="duotone" /></span>
          <div><span className="section-label">Your money right now</span><h2>No accounts tracked yet</h2><p>{hasPin ? "Add a bank, a wallet or your cash in hand to track its current balance here." : "Set up a ledger PIN first: it keeps your balances private. Then add a bank or wallet to track it here."}</p></div>
          {hasPin ? <button className="secondary-button" onClick={() => onNavigate("accounts")}><Bank size={17} />Add an account</button> : <SetUpPinLink />}
        </div>}
      </section>

      <section className="cash-forecast-card" aria-label="30 day cash forecast">
        <div>
          <span className="section-label">Next 30 days</span>
          {balancesLive ? <h2 className={`amount${forecastPoint.balanceMinor < 0 ? " expense" : ""}`}>{formatMoney(forecastPoint.balanceMinor, currency)}</h2> : <h2>{hasAccounts ? "Forecast hidden" : "No forecast yet"}</h2>}
          <p>Starts from your tracked balance. Scheduled income and money owed to you come in. Scheduled bills, open dues, and your recent online pace go out. Cash spending stays out of the pace.</p>
        </div>
        {balancesLive ? <>
          <SegmentedControl value={forecastDays} onChange={setForecastDays} data={[{ value: "7", label: "7 days" }, { value: "15", label: "15 days" }, { value: "30", label: "30 days" }]} />
          <div className="cash-forecast-points">
            <span><small>On {formatLedgerDay(forecastPoint.date, calendarSystem, "date")}</small><strong className="amount">{formatMoney(forecastPoint.balanceMinor, currency)}</strong></span>
            <span><small>Lowest · {formatLedgerDay(forecast.lowest.date, calendarSystem, "date")}</small><strong className={`amount${forecast.lowest.balanceMinor < 0 ? " expense" : ""}`}>{formatMoney(forecast.lowest.balanceMinor, currency)}</strong></span>
            <span><small>Online pace</small><strong className="amount">{formatMoney(forecast.dailyPaceMinor, currency)}/day</strong></span>
          </div>
        </> : hasAccounts ? <BalanceLocked compact title="The forecast is hidden" /> : hasPin ? <button className="secondary-button" onClick={() => onNavigate("accounts")}><Bank size={17} />Add an account</button> : <SetUpPinLink />}
      </section>

      <section className="dashboard-planning">
        <article className="plan-snapshot">
          <div className="section-heading"><div><span className="section-label">Your plans</span><h2>{hasPlans ? "What you’re working toward" : "Make a plan for your money"}</h2></div><button className="text-button" onClick={() => onNavigate("plan")}>{hasPlans ? "View all" : "Get started"} <ArrowRight size={16} /></button></div>
          {hasPlans ? <div className="home-plan-list">
            {totalBudgetPacing ? <div className={`home-plan-row${budgetRisk ? " attention" : ""}`}><span className="home-plan-icon budget"><Flag size={17} weight="duotone" /></span><div><span><strong>{budgetRisk ? `${budgetLabel(budgetRisk.budget.category, customCategories)}: ${budgetRisk.alertTitle}` : `${ALL_SPENDING_LABEL} · ${formatLedgerMonth(month, calendarSystem)}`}</strong><small>{totalBudgetPacing.projectedPercentage}% projected</small></span><div className="bar-track"><span style={{ width: `${Math.min(100, totalBudgetPacing.projectedPercentage)}%` }} /></div><p>{budgetAllowanceText(totalBudgetPacing, currency)}{categoryBudgetPacing.length ? ` · ${categoryBudgetPacing.length} category ${categoryBudgetPacing.length === 1 ? "budget" : "budgets"}` : ""}</p></div></div>
              : currentBudgets.length > 0 && <div className={`home-plan-row${budgetRisk ? " attention" : ""}`}><span className="home-plan-icon budget"><Flag size={17} weight="duotone" /></span><div><span><strong>{budgetRisk ? `${budgetLabel(budgetRisk.budget.category, customCategories)}: ${budgetRisk.alertTitle}` : `${formatLedgerMonth(month, calendarSystem)} budgets`}</strong><small>{budgetPercentage}% projected</small></span><div className="bar-track"><span style={{ width: `${Math.min(100, budgetPercentage)}%` }} /></div><p>{formatMoney(budgetSpent, currency)} spent{budgetUpcoming > 0 ? ` + ${formatMoney(budgetUpcoming, currency)} upcoming` : ""} of {formatMoney(budgetTotal, currency)} across {categoryBudgetPacing.length} {categoryBudgetPacing.length === 1 ? "category" : "categories"}</p></div></div>}
            {highlightedGoal && <div className="home-plan-row"><span className="home-plan-icon goal"><Check size={17} weight="bold" /></span><div><span><strong>{highlightedGoal.name}</strong><small>{goalPercentage}% saved</small></span><div className="bar-track"><span style={{ width: `${Math.min(100, goalPercentage)}%` }} /></div><p>{formatMoney(highlightedGoal.savedMinor, currency)} of {formatMoney(highlightedGoal.targetMinor, currency)}{goals.length > 1 ? ` · +${goals.length - 1} more ${goals.length === 2 ? "goal" : "goals"}` : ""}</p></div></div>}
            {upcomingEntries[0] && <div className="home-plan-row recurring"><span className="home-plan-icon recurring"><Repeat size={17} weight="duotone" /></span><div><span><strong>{upcomingEntries[0].note || getCategory(upcomingEntries[0].category, customCategories).label}</strong><small>{format(parseISO(upcomingEntries[0].nextDueOn), "MMM d")}</small></span><p>{formatMoney(upcomingEntries[0].amountMinor, currency)} scheduled{upcomingEntries.length > 1 ? ` · +${upcomingEntries.length - 1} more` : ""}</p></div></div>}
          </div> : <p className="plan-empty-copy">Add a budget, savings goal, or recurring entry and its progress will stay visible here.</p>}
        </article>
        <article className="insight-snapshot"><div className="section-heading"><div><span className="section-label">Smart insights</span><h2>Your month, explained</h2></div><Lightbulb size={22} weight="duotone" /></div><div>{visibleInsights.map((insight) => <div key={insight.id} className={insight.tone}><strong>{insight.title}{insight.amountMinor !== undefined && <> <span className="amount">{formatMoney(insight.amountMinor, currency)}</span></>}</strong><span>{insight.detail}</span></div>)}</div></article>
      </section>
      <RecurringConfirmSheet entryId={reviewingRecurringId} onClose={() => setReviewingRecurringId(null)} />
    </div>
  );
}
