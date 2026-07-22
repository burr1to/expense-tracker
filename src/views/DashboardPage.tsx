import { ArrowRight, Bank, CalendarBlank, CaretDown, Check, Flag, Lightbulb, Plus, Repeat } from "@phosphor-icons/react";
import { Popover } from "@mantine/core";
import { DatePicker } from "@mantine/dates";
import { format, isSameMonth, parseISO, startOfMonth } from "date-fns";
import { useEffect, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "../components/EmptyState";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { MonthPicker } from "../components/MonthPicker";
import { TransactionRow } from "../components/TransactionRow";
import { getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { isInMonth } from "../lib/dates";
import { dailyExpenseSeries, summarizeLedger } from "../lib/ledger";
import { generateInsights } from "../lib/insights";
import { calculateBudgetPacing, calculateMonthlyBreathingRoom } from "../lib/planning-insights";
import { totalCurrentBalance } from "../lib/account-balances";
import type { AppView, Budget, CurrencyCode, CustomCategory, DueItem, LedgerTransaction, PaymentAccount, RecurringEntry, SavingsGoal } from "../types";

interface DashboardPageProps {
  month: Date;
  focus: { date: string; revision: number } | null;
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  budgets: Budget[];
  recurringEntries: RecurringEntry[];
  dueItems: DueItem[];
  goals: SavingsGoal[];
  customCategories: CustomCategory[];
  paymentAccounts: PaymentAccount[];
  onMonthChange: (date: Date) => void;
  onAdd: (occurredOn: string) => void;
  onSelectedDayChange: (occurredOn: string) => void;
  onNavigate: (view: AppView) => void;
  onConfirmRecurring: (id: string) => Promise<void>;
}

export function DashboardPage({ month, focus, currency, transactions, budgets, recurringEntries, dueItems, goals, customCategories, paymentAccounts, onMonthChange, onAdd, onSelectedDayChange, onNavigate, onConfirmRecurring }: DashboardPageProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date>(() => isSameMonth(month, new Date()) ? new Date() : startOfMonth(month));
  useEffect(() => {
    if (focus) setSelectedDay(parseISO(focus.date));
  }, [focus]);
  const monthTransactions = transactions.filter((item) => isInMonth(item.occurredOn, month));
  const summary = summarizeLedger(monthTransactions, customCategories);
  const trackedBalance = totalCurrentBalance(paymentAccounts);
  const chartData = dailyExpenseSeries(monthTransactions).slice(-7);
  const selectedDayKey = format(selectedDay, "yyyy-MM-dd");
  useEffect(() => { onSelectedDayChange(selectedDayKey); }, [onSelectedDayChange, selectedDayKey]);
  const dayTransactions = transactions
    .filter((item) => item.occurredOn === selectedDayKey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const insights = generateInsights(transactions, month, currency, customCategories);
  const currentBudgets = budgets.filter((item) => item.monthKey === format(month, "yyyy-MM"));
  const budgetPacing = calculateBudgetPacing(currentBudgets, transactions, recurringEntries, dueItems, month);
  const breathingRoom = calculateMonthlyBreathingRoom(transactions, recurringEntries, dueItems, month);
  const budgetTotal = currentBudgets.reduce((sum, item) => sum + item.amountMinor, 0);
  const budgetSpent = budgetPacing.reduce((sum, item) => sum + item.spentMinor, 0);
  const budgetUpcoming = budgetPacing.reduce((sum, item) => sum + item.upcomingMinor, 0);
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
  const dueEntries = recurringEntries.filter((entry) => entry.active && entry.nextDueOn <= format(new Date(), "yyyy-MM-dd"));
  const confirmRecurring = async (id: string) => { if (confirmingId) return; setConfirmingId(id); try { await onConfirmRecurring(id); } finally { setConfirmingId(null); } };
  const changeMonth = (nextMonth: Date) => {
    onMonthChange(nextMonth);
    if (!isSameMonth(selectedDay, nextMonth)) setSelectedDay(isSameMonth(nextMonth, new Date()) ? new Date() : startOfMonth(nextMonth));
  };
  const selectDay = (value: string | null) => {
    if (!value) return;
    const nextDay = parseISO(value);
    setSelectedDay(nextDay);
    if (!isSameMonth(month, nextDay)) onMonthChange(nextDay);
  };

  return (
    <div className="page dashboard-page">
      <header className="dashboard-header">
        <div>
          <MonthPicker month={month} onChange={changeMonth} />
          <Popover position="bottom-start" shadow="md" withArrow>
            <Popover.Target>
              <button className="current-date" aria-label={`Choose day. Selected ${format(selectedDay, "EEEE, MMMM d, yyyy")}`}>
                {format(selectedDay, "EEEE, MMMM d")} <CaretDown size={13} weight="bold" />
              </button>
            </Popover.Target>
            <Popover.Dropdown className="day-picker-popover">
              <DatePicker value={selectedDayKey} onChange={selectDay} firstDayOfWeek={0} />
            </Popover.Dropdown>
          </Popover>
        </div>
        <button className="desktop-quick-add primary-button" onClick={() => onAdd(selectedDayKey)}><Plus size={18} />Add transaction</button>
      </header>

      {dueEntries.length > 0 && <section className="due-strip"><div><CalendarBlank size={23} weight="duotone" /><div><strong>{dueEntries.length} recurring {dueEntries.length === 1 ? "entry is" : "entries are"} ready</strong><span>Confirm before adding anything to your ledger.</span></div></div><div>{dueEntries.slice(0, 2).map((entry) => { const confirming = confirmingId === entry.id; return <button key={entry.id} disabled={Boolean(confirmingId)} onClick={() => void confirmRecurring(entry.id)}>{confirming ? <ButtonSpinner /> : <Check size={15} />}{confirming ? "Confirming…" : entry.note || getCategory(entry.category, customCategories).label}</button>; })}</div></section>}

      <section className="summary-strip" aria-label="Monthly summary">
        <div><span>Income</span><strong className="income">{formatMoney(summary.income, currency)}</strong></div>
        <div><span>Expenses</span><strong className="expense">{formatMoney(summary.expenses, currency)}</strong></div>
        <div><span>Net saved</span><strong>{formatMoney(summary.saved, currency)}</strong></div>
      </section>

      <section className="account-balance-card" aria-label="Tracked account balances">
        <div className="account-balance-heading"><div><span className="section-label">Your money right now</span><h2>{formatMoney(trackedBalance, currency)}</h2><p>Across {paymentAccounts.length} manually tracked {paymentAccounts.length === 1 ? "account" : "accounts"}</p></div><Bank size={27} weight="duotone" /></div>
        {paymentAccounts.length ? <div className="account-balance-list">{paymentAccounts.map((account) => <div key={account.id}><span><strong>{account.label || account.provider}</strong><small>Checked {account.balanceAsOf}</small></span><strong>{formatMoney(account.currentBalanceMinor, currency)}</strong></div>)}</div> : <p className="account-balance-empty">Add a bank or wallet in Profile to see your live tracked balance here.</p>}
      </section>

      <section className="savings-hero">
        <div className="savings-copy">
          <span className="section-label">Net saved</span>
          <h1 className={summary.saved < 0 ? "negative" : ""}>{formatMoney(summary.saved, currency)}</h1>
          <p>{summary.income > 0 ? summary.saved >= 0 ? <>You’ve saved <strong>{summary.savedPercentage}%</strong> of your income this month.</> : <>Spending is <strong>{Math.abs(summary.savedPercentage)}%</strong> above this month’s income.</> : "Log income to see your savings rate."}</p>
        </div>
        <div className="top-category">
          <span>Top expense</span>
          <strong>{summary.categories[0]?.label ?? "—"}</strong>
          <small>{summary.categories[0] ? `${summary.categories[0].percentage}% of spending` : "No expenses yet"}</small>
        </div>
      </section>

      <section className="recent-section dashboard-day-activity">
        <div className="section-heading"><div><span className="section-label">{format(selectedDay, "MMMM d")} transactions</span><h2>{dayTransactions.length ? `${dayTransactions.length} ${dayTransactions.length === 1 ? "entry" : "entries"}` : "No activity"}</h2></div><button className="text-button" onClick={() => onNavigate("transactions")}>Full history <ArrowRight size={16} /></button></div>
        <div className="transaction-list">
          {dayTransactions.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} currency={currency} customCategories={customCategories} compact />)}
          {!dayTransactions.length && <EmptyState title="No transactions this day" message="Choose another day or add an entry for this date." action={<button className="primary-button small" onClick={() => onAdd(selectedDayKey)}><CalendarBlank size={17} />Add transaction</button>} />}
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="chart-section">
          <div className="section-heading"><div><span className="section-label">Spending overview</span><h2>Daily rhythm</h2></div><span>{chartData.length ? `${chartData[0].label} – ${chartData[chartData.length - 1].label}` : format(month, "MMMM yyyy")}</span></div>
          {chartData.length ? (
            <div className="chart-wrap" aria-label="Daily expense chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 12, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dedbd4" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#77736c", fontSize: 11 }} />
                  <YAxis tickFormatter={(value) => formatMoney(Number(value), currency, true)} axisLine={false} tickLine={false} tick={{ fill: "#77736c", fontSize: 10 }} />
                  <Tooltip
                    cursor={{ stroke: "rgba(20, 122, 75, .18)", strokeWidth: 1 }}
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
                  <Bar dataKey="amount" fill="#ebe8e1" radius={[7, 7, 0, 0]} barSize={28} isAnimationActive={false} />
                  <Line type="monotone" dataKey="amount" stroke="#147a4b" strokeWidth={2.6} dot={{ r: 3.5, fill: "#147a4b", strokeWidth: 0 }} activeDot={{ r: 5, fill: "#147a4b", stroke: "#147a4b", strokeWidth: 0 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyState action={<button className="text-button" onClick={() => onAdd(selectedDayKey)}>Add an expense</button>} />}
        </div>

        <div className="category-section">
          <div className="section-heading"><div><span className="section-label">Where it went</span><h2>Top categories</h2></div><button className="text-button" onClick={() => onNavigate("reports")}>Full report <ArrowRight size={16} /></button></div>
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

      <section className="breathing-room-card" aria-label="Monthly breathing room">
        <span className="section-label">Monthly breathing room</span>
        <div className="breathing-room-breakdown">
          <span><small>Income this month</small><strong className="income">{formatMoney(breathingRoom.loggedIncomeMinor, currency)}</strong></span>
          <span><small>Expenses this month</small><strong className="expense">{formatMoney(breathingRoom.loggedExpensesMinor, currency)}</strong></span>
          <span><small>Upcoming in</small><strong>{formatMoney(breathingRoom.upcomingIncomeMinor, currency)}</strong></span>
          <span><small>Upcoming out</small><strong>{formatMoney(breathingRoom.upcomingExpensesMinor, currency)}</strong></span>
        </div>
      </section>

      <section className="dashboard-planning">
        <article className="plan-snapshot">
          <div className="section-heading"><div><span className="section-label">Your plans</span><h2>{hasPlans ? "What you’re working toward" : "Make a plan for your money"}</h2></div><button className="text-button" onClick={() => onNavigate("plan")}>{hasPlans ? "View all" : "Get started"} <ArrowRight size={16} /></button></div>
          {hasPlans ? <div className="home-plan-list">
            {currentBudgets.length > 0 && <div className={`home-plan-row${budgetRisk ? " attention" : ""}`}><span className="home-plan-icon budget"><Flag size={17} weight="duotone" /></span><div><span><strong>{budgetRisk ? `${getCategory(budgetRisk.budget.category, customCategories).label}: ${budgetRisk.alertTitle}` : `${format(month, "MMMM")} budgets`}</strong><small>{budgetPercentage}% projected</small></span><div className="bar-track"><span style={{ width: `${Math.min(100, budgetPercentage)}%` }} /></div><p>{formatMoney(budgetSpent, currency)} spent{budgetUpcoming > 0 ? ` + ${formatMoney(budgetUpcoming, currency)} upcoming` : ""} of {formatMoney(budgetTotal, currency)} across {currentBudgets.length} {currentBudgets.length === 1 ? "category" : "categories"}</p></div></div>}
            {highlightedGoal && <div className="home-plan-row"><span className="home-plan-icon goal"><Check size={17} weight="bold" /></span><div><span><strong>{highlightedGoal.name}</strong><small>{goalPercentage}% saved</small></span><div className="bar-track"><span style={{ width: `${Math.min(100, goalPercentage)}%` }} /></div><p>{formatMoney(highlightedGoal.savedMinor, currency)} of {formatMoney(highlightedGoal.targetMinor, currency)}{goals.length > 1 ? ` · +${goals.length - 1} more ${goals.length === 2 ? "goal" : "goals"}` : ""}</p></div></div>}
            {upcomingEntries[0] && <div className="home-plan-row recurring"><span className="home-plan-icon recurring"><Repeat size={17} weight="duotone" /></span><div><span><strong>{upcomingEntries[0].note || getCategory(upcomingEntries[0].category, customCategories).label}</strong><small>{format(parseISO(upcomingEntries[0].nextDueOn), "MMM d")}</small></span><p>{formatMoney(upcomingEntries[0].amountMinor, currency)} scheduled{upcomingEntries.length > 1 ? ` · +${upcomingEntries.length - 1} more` : ""}</p></div></div>}
          </div> : <p className="plan-empty-copy">Add a budget, savings goal, or recurring entry and its progress will stay visible here.</p>}
        </article>
        <article className="insight-snapshot"><div className="section-heading"><div><span className="section-label">Smart insights</span><h2>Your month, explained</h2></div><Lightbulb size={22} weight="duotone" /></div><div>{insights.slice(0, 3).map((insight) => <div key={insight.id} className={insight.tone}><strong>{insight.title}</strong><span>{insight.detail}</span></div>)}</div></article>
      </section>
    </div>
  );
}
