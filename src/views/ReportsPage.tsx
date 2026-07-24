import { Bank, FlagBanner, Sparkle, TrendDown, TrendUp } from "@phosphor-icons/react";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "../components/EmptyState";
import { MonthPicker } from "../components/MonthPicker";
import { formatMoney } from "../lib/currency";
import { isInMonth } from "../lib/dates";
import { monthlySeries, summarizeLedger } from "../lib/ledger";
import { financialMilestones } from "../lib/milestones";
import type { CurrencyCode, CustomCategory, DueItem, LedgerTransaction, PaymentAccount } from "../types";
import { totalCurrentBalance } from "../lib/account-balances";

interface ReportsPageProps {
  month: Date;
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  paymentAccounts: PaymentAccount[];
  dueItems: DueItem[];
  onMonthChange: (date: Date) => void;
  onAdd: () => void;
}

export function ReportsPage({ month, currency, transactions, customCategories, paymentAccounts, dueItems, onMonthChange, onAdd }: ReportsPageProps) {
  const [activeCategoryIndex, setActiveCategoryIndex] = useState<number | null>(null);
  const current = transactions.filter((item) => isInMonth(item.occurredOn, month));
  const summary = summarizeLedger(current, customCategories);
  const history = monthlySeries(transactions);
  const milestones = financialMilestones(transactions, dueItems);
  const activeCategory = activeCategoryIndex === null ? undefined : summary.categories[activeCategoryIndex];
  const trackedBalance = totalCurrentBalance(paymentAccounts);

  return (
    <div className="page reports-page">
      <header className="page-header"><div><span className="eyebrow">The bigger picture</span><h1>Reports</h1><p>See where your money moved and how the months compare.</p></div><MonthPicker month={month} onChange={onMonthChange} /></header>
      <section className="report-kpis">
        <div><span>Savings rate</span><strong className={summary.savedPercentage < 0 ? "negative" : ""}>{summary.savedPercentage}%</strong><small>{summary.savedPercentage >= 0 ? <><TrendUp size={15} /> of income retained</> : <><TrendDown size={15} /> spending above income</>}</small></div>
        <div><span>Tracked balance</span><strong>{formatMoney(trackedBalance, currency)}</strong><small>{paymentAccounts.length} {paymentAccounts.length === 1 ? "account" : "accounts"} checked manually</small></div>
        <div><span>Largest category</span><strong>{summary.categories[0]?.label ?? "—"}</strong><small>{summary.categories[0] ? formatMoney(summary.categories[0].value, currency) : "No expenses"}</small></div>
        <div><span>Average expense</span><strong>{formatMoney(summary.expenses / Math.max(1, current.filter((item) => item.kind === "expense").length), currency)}</strong><small>per expense entry</small></div>
      </section>
      <section className="reports-grid">
        <article className="report-panel category-report">
          <div className="section-heading"><div><span className="section-label">Category mix</span><h2>Where it went</h2></div><strong>{formatMoney(summary.expenses, currency)}</strong></div>
          {summary.categories.length ? <>
            <div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={summary.categories} dataKey="value" nameKey="label" innerRadius="65%" outerRadius="90%" paddingAngle={2} stroke="none" rootTabIndex={-1} isAnimationActive={false} onMouseEnter={(_, index) => setActiveCategoryIndex(index)} onMouseLeave={() => setActiveCategoryIndex(null)}>{summary.categories.map((item) => <Cell key={item.category} fill={item.color} />)}</Pie></PieChart></ResponsiveContainer><div><span>{activeCategory?.label ?? "Expenses"}</span><strong>{formatMoney(activeCategory?.value ?? summary.expenses, currency, true)}</strong></div></div>
            <div className="legend-list">{summary.categories.map((item) => <div key={item.category}><span className="legend-dot" style={{ backgroundColor: item.color }} /><span>{item.label}</span><strong>{item.percentage}%</strong></div>)}</div>
          </> : <EmptyState action={<button className="text-button" onClick={onAdd}>Log an expense</button>} />}
        </article>
        <article className="report-panel history-report">
          <div className="section-heading"><div><span className="section-label">Six-month view</span><h2>Income vs expenses</h2></div></div>
          {history.length ? <div className="history-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={history} barGap={4}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#cbd3c9" /><XAxis dataKey="month" axisLine={false} tickLine={false} /><YAxis tickFormatter={(value) => formatMoney(Number(value), currency, true)} axisLine={false} tickLine={false} width={46} /><Tooltip cursor={false} formatter={(value) => formatMoney(Number(value), currency)} /><Bar dataKey="income" name="Income" fill="#557f69" radius={[2, 2, 0, 0]} isAnimationActive={false} /><Bar dataKey="expenses" name="Expenses" fill="#8f4c49" radius={[2, 2, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></div> : <EmptyState />}
          <div className="chart-legend"><span><i className="income-dot" />Income</span><span><i className="expense-dot" />Expenses</span></div>
        </article>
      </section>
      <section className="report-panel account-report-panel"><div className="section-heading"><div><span className="section-label">Account picture</span><h2>Where your tracked money sits</h2></div><Bank size={22} weight="duotone" /></div>{paymentAccounts.length ? <div className="report-account-list">{paymentAccounts.map((account) => { const percentage = trackedBalance > 0 ? Math.round((account.currentBalanceMinor / trackedBalance) * 100) : 0; return <div key={account.id}><div><span>{account.label || account.provider}</span><strong>{formatMoney(account.currentBalanceMinor, currency)}</strong></div><div className="bar-track"><span style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }} /></div><small>{percentage}% of tracked balance · checked {account.balanceAsOf}</small></div>; })}</div> : <EmptyState title="No account balances yet" message="Add your bank or wallet balances on the Accounts page to see the full picture." />}</section>
      <section className="milestone-panel"><div className="section-heading"><div><span className="section-label">Financial timeline</span><h2>The moments your ledger remembers</h2></div><Sparkle size={22} weight="duotone" /></div>{milestones.length ? <div className="milestone-list">{milestones.map((item) => <article key={item.id} className={item.tone}><span><FlagBanner size={17} weight="duotone" /></span><div><small>{format(parseISO(item.date), "MMM d, yyyy")}</small><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}</div> : <EmptyState />}</section>
    </div>
  );
}
