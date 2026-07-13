import { TrendDown, TrendUp } from "@phosphor-icons/react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "../components/EmptyState";
import { MonthPicker } from "../components/MonthPicker";
import { formatMoney } from "../lib/currency";
import { isInMonth } from "../lib/dates";
import { monthlySeries, summarizeLedger } from "../lib/ledger";
import type { CurrencyCode, CustomCategory, LedgerTransaction } from "../types";

interface ReportsPageProps {
  month: Date;
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  onMonthChange: (date: Date) => void;
  onAdd: () => void;
}

export function ReportsPage({ month, currency, transactions, customCategories, onMonthChange, onAdd }: ReportsPageProps) {
  const current = transactions.filter((item) => isInMonth(item.occurredOn, month));
  const summary = summarizeLedger(current, customCategories);
  const history = monthlySeries(transactions);

  return (
    <div className="page reports-page">
      <header className="page-header"><div><span className="eyebrow">The bigger picture</span><h1>Reports</h1><p>See where your money moved and how the months compare.</p></div><MonthPicker month={month} onChange={onMonthChange} /></header>
      <section className="report-kpis">
        <div><span>Savings rate</span><strong className={summary.savedPercentage < 0 ? "negative" : ""}>{summary.savedPercentage}%</strong><small>{summary.savedPercentage >= 0 ? <><TrendUp size={15} /> of income retained</> : <><TrendDown size={15} /> spending above income</>}</small></div>
        <div><span>Largest category</span><strong>{summary.categories[0]?.label ?? "—"}</strong><small>{summary.categories[0] ? formatMoney(summary.categories[0].value, currency) : "No expenses"}</small></div>
        <div><span>Average expense</span><strong>{formatMoney(summary.expenses / Math.max(1, current.filter((item) => item.kind === "expense").length), currency)}</strong><small>per expense entry</small></div>
      </section>
      <section className="reports-grid">
        <article className="report-panel category-report">
          <div className="section-heading"><div><span className="section-label">CATEGORY MIX</span><h2>Where it went</h2></div><strong>{formatMoney(summary.expenses, currency)}</strong></div>
          {summary.categories.length ? <>
            <div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={summary.categories} dataKey="value" nameKey="label" innerRadius="65%" outerRadius="90%" paddingAngle={2} stroke="none" isAnimationActive={false}>{summary.categories.map((item) => <Cell key={item.category} fill={item.color} />)}</Pie><Tooltip formatter={(value) => formatMoney(Number(value), currency)} /></PieChart></ResponsiveContainer><div><span>Expenses</span><strong>{formatMoney(summary.expenses, currency, true)}</strong></div></div>
            <div className="legend-list">{summary.categories.map((item) => <div key={item.category}><span className="legend-dot" style={{ backgroundColor: item.color }} /><span>{item.label}</span><strong>{item.percentage}%</strong></div>)}</div>
          </> : <EmptyState action={<button className="text-button" onClick={onAdd}>Log an expense</button>} />}
        </article>
        <article className="report-panel history-report">
          <div className="section-heading"><div><span className="section-label">SIX-MONTH VIEW</span><h2>Income vs expenses</h2></div></div>
          {history.length ? <div className="history-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={history} barGap={4}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#dedbd4" /><XAxis dataKey="month" axisLine={false} tickLine={false} /><YAxis tickFormatter={(value) => formatMoney(Number(value), currency, true)} axisLine={false} tickLine={false} width={46} /><Tooltip formatter={(value) => formatMoney(Number(value), currency)} /><Bar dataKey="income" name="Income" fill="#2b8a50" radius={[5, 5, 0, 0]} isAnimationActive={false} /><Bar dataKey="expenses" name="Expenses" fill="#e8675a" radius={[5, 5, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></div> : <EmptyState />}
          <div className="chart-legend"><span><i className="income-dot" />Income</span><span><i className="expense-dot" />Expenses</span></div>
        </article>
      </section>
    </div>
  );
}
