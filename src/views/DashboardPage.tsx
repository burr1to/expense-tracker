import { ArrowRight, CalendarBlank, Check, Lightbulb, Plus } from "@phosphor-icons/react";
import { format } from "date-fns";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "../components/EmptyState";
import { MonthPicker } from "../components/MonthPicker";
import { TransactionRow } from "../components/TransactionRow";
import { getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { isInMonth } from "../lib/dates";
import { dailyExpenseSeries, summarizeLedger } from "../lib/ledger";
import { generateInsights } from "../lib/insights";
import type { AppView, Budget, CurrencyCode, CustomCategory, LedgerTransaction, RecurringEntry } from "../types";

interface DashboardPageProps {
  month: Date;
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  budgets: Budget[];
  recurringEntries: RecurringEntry[];
  customCategories: CustomCategory[];
  onMonthChange: (date: Date) => void;
  onAdd: () => void;
  onNavigate: (view: AppView) => void;
  onConfirmRecurring: (id: string) => Promise<void>;
}

export function DashboardPage({ month, currency, transactions, budgets, recurringEntries, customCategories, onMonthChange, onAdd, onNavigate, onConfirmRecurring }: DashboardPageProps) {
  const monthTransactions = transactions.filter((item) => isInMonth(item.occurredOn, month));
  const summary = summarizeLedger(monthTransactions, customCategories);
  const chartData = dailyExpenseSeries(monthTransactions).slice(-7);
  const recent = [...monthTransactions].sort((a, b) => `${b.occurredOn}${b.createdAt}`.localeCompare(`${a.occurredOn}${a.createdAt}`)).slice(0, 5);
  const insights = generateInsights(transactions, month, currency, customCategories);
  const currentBudgets = budgets.filter((item) => item.monthKey === format(month, "yyyy-MM"));
  const budgetTotal = currentBudgets.reduce((sum, item) => sum + item.amountMinor, 0);
  const budgetSpent = monthTransactions.filter((item) => item.kind === "expense" && currentBudgets.some((budget) => budget.category === item.category)).reduce((sum, item) => sum + item.amountMinor, 0);
  const dueEntries = recurringEntries.filter((entry) => entry.active && entry.nextDueOn <= format(new Date(), "yyyy-MM-dd"));

  return (
    <div className="page dashboard-page">
      <header className="dashboard-header">
        <div><MonthPicker month={month} onChange={onMonthChange} /><span className="current-date">{format(new Date(), "EEEE, MMMM d")}</span></div>
        <button className="desktop-quick-add primary-button" onClick={onAdd}><Plus size={18} />Add transaction</button>
      </header>

      {dueEntries.length > 0 && <section className="due-strip"><div><CalendarBlank size={23} weight="duotone" /><div><strong>{dueEntries.length} recurring {dueEntries.length === 1 ? "entry is" : "entries are"} ready</strong><span>Confirm before adding anything to your ledger.</span></div></div><div>{dueEntries.slice(0, 2).map((entry) => <button key={entry.id} onClick={() => void onConfirmRecurring(entry.id)}><Check size={15} />{entry.note || getCategory(entry.category, customCategories).label}</button>)}</div></section>}

      <section className="summary-strip" aria-label="Monthly summary">
        <div><span>Income</span><strong className="income">{formatMoney(summary.income, currency)}</strong></div>
        <div><span>Expenses</span><strong className="expense">{formatMoney(summary.expenses, currency)}</strong></div>
        <div><span>Net saved</span><strong>{formatMoney(summary.saved, currency)}</strong></div>
      </section>

      <section className="savings-hero">
        <div className="savings-copy">
          <span className="section-label">NET SAVED</span>
          <h1 className={summary.saved < 0 ? "negative" : ""}>{formatMoney(summary.saved, currency)}</h1>
          <p>{summary.income > 0 ? summary.saved >= 0 ? <>You’ve saved <strong>{summary.savedPercentage}%</strong> of your income this month.</> : <>Spending is <strong>{Math.abs(summary.savedPercentage)}%</strong> above this month’s income.</> : "Log income to see your savings rate."}</p>
        </div>
        <div className="top-category">
          <span>Top expense</span>
          <strong>{summary.categories[0]?.label ?? "—"}</strong>
          <small>{summary.categories[0] ? `${summary.categories[0].percentage}% of spending` : "No expenses yet"}</small>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="chart-section">
          <div className="section-heading"><div><span className="section-label">SPENDING OVERVIEW</span><h2>Daily rhythm</h2></div><span>{chartData.length ? `${chartData[0].label} – ${chartData[chartData.length - 1].label}` : format(month, "MMMM yyyy")}</span></div>
          {chartData.length ? (
            <div className="chart-wrap" aria-label="Daily expense chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 12, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dedbd4" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#77736c", fontSize: 11 }} />
                  <YAxis tickFormatter={(value) => formatMoney(Number(value), currency, true)} axisLine={false} tickLine={false} tick={{ fill: "#77736c", fontSize: 10 }} />
                  <Tooltip formatter={(value) => formatMoney(Number(value), currency)} contentStyle={{ borderRadius: 12, border: "1px solid #e5e1da", boxShadow: "0 12px 35px rgba(30,35,44,.12)" }} />
                  <Bar dataKey="amount" fill="#ebe8e1" radius={[7, 7, 0, 0]} barSize={28} isAnimationActive={false} />
                  <Line type="monotone" dataKey="amount" stroke="#135dea" strokeWidth={2.6} dot={{ r: 3.5, fill: "#135dea", strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyState action={<button className="text-button" onClick={onAdd}>Add an expense</button>} />}
        </div>

        <div className="category-section">
          <div className="section-heading"><div><span className="section-label">WHERE IT WENT</span><h2>Top categories</h2></div><button className="text-button" onClick={() => onNavigate("reports")}>Full report <ArrowRight size={16} /></button></div>
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

      <section className="recent-section">
        <div className="section-heading"><div><span className="section-label">RECENT TRANSACTIONS</span><h2>Latest activity</h2></div><button className="text-button" onClick={() => onNavigate("transactions")}>View all <ArrowRight size={16} /></button></div>
        <div className="transaction-list">
          {recent.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} currency={currency} customCategories={customCategories} compact />)}
          {!recent.length && <EmptyState action={<button className="primary-button small" onClick={onAdd}><CalendarBlank size={17} />Log today</button>} />}
        </div>
      </section>

      <section className="dashboard-planning">
        <article className="plan-snapshot"><div className="section-heading"><div><span className="section-label">BUDGET PULSE</span><h2>{currentBudgets.length ? `${Math.round((budgetSpent / Math.max(1, budgetTotal)) * 100)}% used` : "Set your first budget"}</h2></div><button className="text-button" onClick={() => onNavigate("plan")}>Open plan <ArrowRight size={16} /></button></div>{currentBudgets.length > 0 && <><div className="bar-track"><span style={{ width: `${Math.min(100, (budgetSpent / budgetTotal) * 100)}%` }} /></div><p>{formatMoney(budgetSpent, currency)} spent across {currentBudgets.length} category budgets.</p></>}</article>
        <article className="insight-snapshot"><div className="section-heading"><div><span className="section-label">SMART INSIGHTS</span><h2>Your month, explained</h2></div><Lightbulb size={22} weight="duotone" /></div><div>{insights.slice(0, 3).map((insight) => <div key={insight.id} className={insight.tone}><strong>{insight.title}</strong><span>{insight.detail}</span></div>)}</div></article>
      </section>
    </div>
  );
}
