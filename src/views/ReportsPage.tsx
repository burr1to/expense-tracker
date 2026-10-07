import { Bank, CaretLeft, CaretRight, DownloadSimple, FlagBanner, Sparkle, TrendDown, TrendUp } from "@phosphor-icons/react";
import { format, parseISO } from "date-fns";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "../components/EmptyState";
import { MonthPicker } from "../components/MonthPicker";
import { formatMoney } from "../lib/currency";
import { countsAsIncomeOrSpending } from "../lib/categories";
import { isInMonth, monthKey, todayInput } from "../lib/dates";
import { monthlySeries, summarizeLedger } from "../lib/ledger";
import { financialMilestones } from "../lib/milestones";
import type { CalendarSystem, CurrencyCode, CustomCategory, DueItem, LedgerTransaction, PaymentAccount } from "../types";
import { totalCurrentBalance } from "../lib/account-balances";
import { isCompletedReportMonth } from "../lib/monthly-report";
import { addFiscalYears, fiscalYearBounds, fiscalYearLabel, fiscalYearOf } from "../lib/fiscal-year";
import { compareFestivalSpending, expensesBetween, FESTIVALS, festivalMonthLabel, type FestivalComparison } from "../lib/festivals";
import { adToBs } from "../lib/nepali-date";
const reportCategoryColors = ["#0072b2", "#e69f00", "#009e73", "#d55e00", "#cc79a7", "#56b4e9", "#f0e442", "#6f6f6f", "#332288", "#117733", "#cc6677", "#88ccee"] as const;

interface ReportsPageProps {
  calendarSystem: CalendarSystem;
  month: Date;
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  paymentAccounts: PaymentAccount[];
  dueItems: DueItem[];
  onMonthChange: (date: Date) => void;
  onAdd: () => void;
  allowPdfDownload?: boolean;
}

export function ReportsPage({ month, currency, transactions, customCategories, paymentAccounts, dueItems, onMonthChange, onAdd, allowPdfDownload = false, calendarSystem }: ReportsPageProps) {
  const [activeCategoryIndex, setActiveCategoryIndex] = useState<number | null>(null);
  const current = useMemo(() => transactions.filter((item) => isInMonth(item.occurredOn, month)), [month, transactions]);
  const summary = useMemo(() => summarizeLedger(current, customCategories), [current, customCategories]);
  const expenseCount = useMemo(() => current.reduce((count, item) => count + (item.kind === "expense" && countsAsIncomeOrSpending(item) ? 1 : 0), 0), [current]);
  const categoryData = summary.categories.map((item, index) => ({ ...item, color: reportCategoryColors[index % reportCategoryColors.length] }));
  const history = useMemo(() => monthlySeries(transactions), [transactions]);
  const milestones = useMemo(() => financialMilestones(transactions, dueItems), [dueItems, transactions]);
  const activeCategory = activeCategoryIndex === null ? undefined : categoryData[activeCategoryIndex];
  const trackedBalance = totalCurrentBalance(paymentAccounts);
  const reportMonthKey = monthKey(month);
  const canDownloadPdf = allowPdfDownload && isCompletedReportMonth(reportMonthKey);

  return (
    <div className="page reports-page">
      <header className="page-header"><div><span className="eyebrow">The bigger picture</span><h1>Reports</h1><p>See where your money moved and how the months compare.</p></div><div className="report-header-actions"><MonthPicker calendarSystem={calendarSystem} month={month} onChange={onMonthChange} />{canDownloadPdf && <a className="secondary-button" href={`/api/reports/monthly?month=${reportMonthKey}`} download={`SaveYoRupee-${reportMonthKey}-monthly-report.pdf`}><DownloadSimple size={17} />Download PDF</a>}</div></header>
      <section className="report-kpis">
        <div><span>Savings rate</span><strong className={summary.savedPercentage < 0 ? "negative" : ""}>{summary.savedPercentage}%</strong><small>{summary.savedPercentage >= 0 ? <><TrendUp size={15} /> of income retained</> : <><TrendDown size={15} /> spending above income</>}</small></div>
        <div><span>Tracked balance</span><strong>{formatMoney(trackedBalance, currency)}</strong><small>{paymentAccounts.length} {paymentAccounts.length === 1 ? "account" : "accounts"} checked manually</small></div>
        <div><span>Largest category</span><strong>{summary.categories[0]?.label ?? "—"}</strong><small>{summary.categories[0] ? formatMoney(summary.categories[0].value, currency) : "No expenses"}</small></div>
        <div><span>Average expense</span><strong>{formatMoney(summary.expenses / Math.max(1, expenseCount), currency)}</strong><small>per expense entry</small></div>
      </section>
      <NepaliYearSection transactions={transactions} currency={currency} />
      <section className="reports-grid">
        <article className="report-panel category-report">
          <div className="section-heading"><div><span className="section-label">Category mix</span><h2>Where it went</h2></div><strong>{formatMoney(summary.expenses, currency)}</strong></div>
          {summary.categories.length ? <>
            <div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categoryData} dataKey="value" nameKey="label" innerRadius="65%" outerRadius="90%" paddingAngle={2} stroke="none" rootTabIndex={-1} isAnimationActive={false} onMouseEnter={(_, index) => setActiveCategoryIndex(index)} onMouseLeave={() => setActiveCategoryIndex(null)}>{categoryData.map((item) => <Cell key={item.category} fill={item.color} />)}</Pie></PieChart></ResponsiveContainer><div><span>{activeCategory?.label ?? "Expenses"}</span><strong>{formatMoney(activeCategory?.value ?? summary.expenses, currency, true)}</strong></div></div>
            <div className="legend-list">{categoryData.map((item) => <div key={item.category}><span className="legend-dot" style={{ backgroundColor: item.color }} /><span>{item.label}</span><strong>{item.percentage}%</strong></div>)}</div>
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

/**
 * The Nepali fiscal year (Shrawan to Ashadh) and festival spending, which is
 * what salaries, taxes and household budgets in Nepal actually run on. A
 * Jan-Dec summary matches nothing a user here files against.
 */
function NepaliYearSection({ transactions, currency }: { transactions: LedgerTransaction[]; currency: CurrencyCode }) {
  const today = todayInput();
  const [fiscalKey, setFiscalKey] = useState(() => { try { return fiscalYearOf(today); } catch { return null; } });
  if (!fiscalKey) return null;

  const step = (delta: number) => { try { setFiscalKey(addFiscalYears(fiscalKey, delta)); } catch { /* at the edge of the supported range */ } };
  const bsYear = (() => { try { return adToBs(today).year; } catch { return null; } })();
  const picture = useMemo(() => {
    const bounds = fiscalYearBounds(fiscalKey);
    let income = 0;
    let expenses = 0;
    let entries = 0;
    for (const item of transactions) {
      const counted = countsAsIncomeOrSpending(item);
      if (item.occurredOn >= bounds.start && item.occurredOn < bounds.endExclusive) {
        entries += 1;
        if (counted && item.kind === "income") income += item.amountMinor;
        else if (counted) expenses += item.amountMinor;
      }
    }
    const spentBetween = expensesBetween(transactions);
    return {
      bounds,
      income,
      expenses,
      entries,
      festivals: bsYear === null ? [] : FESTIVALS.flatMap((festival) => { try { return [compareFestivalSpending(festival, bsYear, spentBetween, today)]; } catch { return []; } }),
    };
  }, [bsYear, fiscalKey, today, transactions]);
  const { bounds, income, expenses, entries, festivals } = picture;
  const net = income - expenses;

  return <section className="nepali-year-section" aria-label="Nepali fiscal year and festivals">
    <div className="section-heading"><div><span className="section-label">Nepali year</span><h2>Fiscal year and festivals</h2></div>
      <div className="fiscal-year-picker"><button className="icon-button" onClick={() => step(-1)} aria-label="Previous fiscal year"><CaretLeft size={17} /></button><strong>{fiscalYearLabel(fiscalKey)}</strong><button className="icon-button" onClick={() => step(1)} aria-label="Next fiscal year"><CaretRight size={17} /></button></div>
    </div>
    <p className="fiscal-year-range">Shrawan 1 to the end of Ashadh · {format(parseISO(bounds.start), "MMM d, yyyy")} – {format(parseISO(bounds.endExclusive), "MMM d, yyyy")}</p>
    <div className="fiscal-year-kpis">
      <div><span>Income</span><strong className="income">{formatMoney(income, currency)}</strong></div>
      <div><span>Expenses</span><strong className="expense">{formatMoney(expenses, currency)}</strong></div>
      <div><span>Net</span><strong className={net < 0 ? "negative" : ""}>{formatMoney(net, currency)}</strong></div>
      <div><span>Entries</span><strong>{entries}</strong></div>
    </div>
    {festivals.length > 0 && <div className="festival-grid">
      {festivals.map((comparison) => <FestivalCard key={comparison.periodKey} comparison={comparison} currency={currency} today={today} />)}
    </div>}
  </section>;
}

/** One season this BS year: still to come (last year's total, never "−100%"), under way (against last year at the same day), or over. */
function FestivalCard({ comparison, currency, today }: { comparison: FestivalComparison; currency: CurrencyCode; today: string }) {
  const { festival, status, previousBsYear, previousSpentMinor, previousComparableMinor, changePercentage } = comparison;
  const dayCount = Math.round((Date.parse(`${comparison.bounds.start}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const startsIn = dayCount === 1 ? "Starts tomorrow" : `Starts in ${dayCount} days`;
  const change = changePercentage === null ? null : <small className={`festival-change ${changePercentage > 0 ? "up" : "down"}`}>{changePercentage > 0 ? "+" : ""}{changePercentage}% vs {status === "running" ? `the same point in ${previousBsYear}` : previousBsYear} (<span className="festival-amount">{formatMoney(previousComparableMinor ?? 0, currency)}</span>)</small>;
  return <article className={`festival-card is-${status}`}>
    <header><strong>{festival.name} {comparison.bsYear}</strong><small>{festivalMonthLabel(festival)}</small></header>
    {status === "upcoming" ? <>
      <b className="festival-status">{startsIn}</b>
      <small className="festival-change muted">Coming up · {previousSpentMinor ? <>last year <span className="festival-amount">{formatMoney(previousSpentMinor, currency)}</span></> : `nothing logged for ${previousBsYear}`}</small>
    </> : <>
      <b className="festival-amount">{formatMoney(comparison.spentMinor, currency)}</b>
      {status === "running" && <small className="festival-progress">Day {comparison.daysElapsed} of {comparison.seasonDays} · so far</small>}
      {change ?? <small className="festival-change muted">{previousSpentMinor === null ? "Nothing earlier to compare against." : status === "running" && previousSpentMinor > 0 ? <>Nothing by this point in {previousBsYear} · <span className="festival-amount">{formatMoney(previousSpentMinor, currency)}</span> over its whole season</> : `No ${previousBsYear} spending to compare against yet.`}</small>}
    </>}
  </article>;
}
