import { Bank, CaretLeft, CaretRight, ChartPie, Confetti, DownloadSimple, FlagBanner, Plus, Receipt, Sparkle, TrendDown, TrendUp } from "@phosphor-icons/react";
import { format, parseISO } from "date-fns";
import { useContext, useMemo, useState, type CSSProperties } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BalanceLocked, BalancePinHint } from "../components/BalancePrivacy";
import { AccountTile, CategoryTile } from "../components/ToneIcon";
import { LedgerWorkspaceContext } from "../context/LedgerWorkspaceContext";
import { formatMoney } from "../lib/currency";
import { countsAsIncomeOrSpending } from "../lib/categories";
import { formatLedgerDate, formatLedgerMonth, isInMonth, monthKey, todayInput } from "../lib/dates";
import { plainAmount } from "../lib/entry-labels";
import { addMonthsToKey, type PeriodKey } from "../lib/period";
import { monthlySeries, summarizeLedger } from "../lib/ledger";
import { financialMilestones, type FinancialMilestone } from "../lib/milestones";
import type { CalendarSystem, CurrencyCode, CustomCategory, DueItem, LedgerTransaction, PaymentAccount } from "../types";
import { totalCurrentBalance } from "../lib/account-balances";
import { paymentAccountLabel } from "../lib/payment-accounts";
import { isCompletedReportMonth, reportFileKey } from "../lib/monthly-report";
import { addFiscalYears, fiscalYearBounds, fiscalYearLabel, fiscalYearOf } from "../lib/fiscal-year";
import { compareFestivalSpending, expensesBetween, FESTIVALS, festivalMonthLabel, type FestivalComparison } from "../lib/festivals";
import { adToBs } from "../lib/nepali-date";
import { accountLook, categoryTone } from "../lib/tones";
const toneStyle = (bg: string, ink: string, size = 42) => ({ "--tile-bg": bg, "--tile-ink": ink, "--tile-size": `${size}px` } as CSSProperties);
const MILESTONE_TONES: Record<FinancialMilestone["tone"], { bg: string; ink: string }> = {
  blue: { bg: "#dfe6fb", ink: "#3446a8" },
  green: { bg: "#d6f0df", ink: "#1f7a45" },
  gold: { bg: "#fdf0c4", ink: "#8a5a00" },
};

interface ReportsPageProps {
  calendarSystem: CalendarSystem;
  period: PeriodKey;
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  paymentAccounts: PaymentAccount[];
  dueItems: DueItem[];
  onPeriodChange: (period: PeriodKey) => void;
  onAdd: () => void;
  allowPdfDownload?: boolean;
}

export function ReportsPage({ period: month, currency, transactions, customCategories, paymentAccounts, dueItems, onPeriodChange, onAdd, allowPdfDownload = false, calendarSystem }: ReportsPageProps) {
  const [activeCategoryIndex, setActiveCategoryIndex] = useState<number | null>(null);
  const current = useMemo(() => transactions.filter((item) => isInMonth(item.occurredOn, month)), [month, transactions]);
  const summary = useMemo(() => summarizeLedger(current, customCategories), [current, customCategories]);
  const expenseCount = useMemo(() => current.reduce((count, item) => count + (item.kind === "expense" && countsAsIncomeOrSpending(item) ? 1 : 0), 0), [current]);
  // Each slice wears its category's own colour, the same one its icon tile uses everywhere else.
  const categoryData = summary.categories.map((item) => ({ ...item, color: categoryTone(item.category, customCategories).ink }));
  const history = useMemo(() => monthlySeries(transactions, calendarSystem), [calendarSystem, transactions]);
  const milestones = useMemo(() => financialMilestones(transactions, dueItems), [dueItems, transactions]);
  const activeCategory = activeCategoryIndex === null ? undefined : categoryData[activeCategoryIndex];
  const trackedBalance = totalCurrentBalance(paymentAccounts);
  // The same session unlock as the dashboard and Accounts.
  const workspace = useContext(LedgerWorkspaceContext);
  const balancesShown = workspace?.balancesVisible ?? true;
  const hasPin = workspace?.ledger.profile.hasPin ?? false;
  const reportMonthKey = monthKey(month);
  const canDownloadPdf = allowPdfDownload && isCompletedReportMonth(reportMonthKey);
  const monthName = formatLedgerMonth(month, calendarSystem);
  const step = (delta: number) => { try { onPeriodChange(addMonthsToKey(month, delta)); } catch { /* outside the supported range */ } };
  const saved = summary.income - summary.expenses;

  return (
    <div className="v2-page v2-reports">
      <header className="v2-page-head">
        <div><span className="v2-eyebrow is-beside-stepper">The bigger picture</span><h1>Reports</h1></div>
        <div className="v2-head-actions">
          <span className="v2-chip is-stepper"><button type="button" onClick={() => step(-1)} aria-label="Previous month"><CaretLeft size={15} weight="bold" /></button><strong>{monthName}</strong><button type="button" onClick={() => step(1)} aria-label="Next month"><CaretRight size={15} weight="bold" /></button></span>
        </div>
      </header>

      <section className="v2-hero v2-report-hero" aria-label={`${monthName} summary`}>
        <div className="v2-report-hero-top">
          <span className="v2-hero-label">{saved >= 0 ? "Kept" : "Spent more than came in"} · {monthName}</span>
          {canDownloadPdf && <a className="v2-button is-small is-on-green-ghost" href={`/api/reports/monthly?month=${encodeURIComponent(reportMonthKey)}`} download={`SaveYoRupee-${reportFileKey(reportMonthKey)}-monthly-report.pdf`}><DownloadSimple size={15} weight="bold" />PDF</a>}
        </div>
        <strong className="v2-hero-amount amount">{saved < 0 ? "−" : ""}{formatMoney(Math.abs(saved), currency)}</strong>
        <span className="v2-hero-pill">{summary.income > 0 ? (summary.savedPercentage >= 0 ? <><TrendUp size={15} weight="bold" />{summary.savedPercentage}% of income kept</> : <><TrendDown size={15} weight="bold" />{Math.abs(summary.savedPercentage)}% more out than in</>) : "No income logged this month"}</span>
        <div className="v2-budget-hero-facts">
          <span><small>Came in</small><strong className="amount">{formatMoney(summary.income, currency)}</strong></span>
          <span><small>Went out</small><strong className="amount">{formatMoney(summary.expenses, currency)}</strong></span>
        </div>
      </section>

      <div className="v2-report-kpis">
        <div className="v2-card v2-report-kpi">
          <span className="v2-tile" style={toneStyle("#dde9f7", "#1d5a96", 36)} aria-hidden="true"><Bank size={19} weight="duotone" /></span>
          <small>Tracked balance</small>
          {balancesShown || !paymentAccounts.length ? <strong className="amount">{formatMoney(trackedBalance, currency)}</strong> : <BalanceLocked compact title="Hidden" />}
          <span className="v2-muted">{paymentAccounts.length} {paymentAccounts.length === 1 ? "account" : "accounts"}</span>
        </div>
        <div className="v2-card v2-report-kpi">
          {summary.categories[0] ? <CategoryTile category={summary.categories[0].category} custom={customCategories} size={36} /> : <span className="v2-tile" style={toneStyle("#ebeae4", "#5a5e55", 36)} aria-hidden="true"><ChartPie size={19} weight="duotone" /></span>}
          <small>Biggest category</small>
          <strong>{summary.categories[0]?.label ?? "None yet"}</strong>
          <span className="v2-muted">{summary.categories[0] ? formatMoney(summary.categories[0].value, currency) : "No expenses"}</span>
        </div>
        <div className="v2-card v2-report-kpi">
          <span className="v2-tile" style={toneStyle("#fde5d4", "#b4531f", 36)} aria-hidden="true"><Receipt size={19} weight="duotone" /></span>
          <small>Average expense</small>
          <strong className="amount">{formatMoney(summary.expenses / Math.max(1, expenseCount), currency)}</strong>
          <span className="v2-muted">over {expenseCount} {expenseCount === 1 ? "entry" : "entries"}</span>
        </div>
      </div>

      <div className="v2-report-grid">
        <section className="v2-card v2-report-mix" aria-labelledby="report-mix-heading">
          <header className="v2-card-head"><h2 id="report-mix-heading">Where it went</h2><strong className="amount">{formatMoney(summary.expenses, currency)}</strong></header>
          {summary.categories.length ? <>
            <div className="v2-donut">
              <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categoryData} dataKey="value" nameKey="label" innerRadius="68%" outerRadius="92%" paddingAngle={2} stroke="none" rootTabIndex={-1} isAnimationActive={false} onMouseEnter={(_, index) => setActiveCategoryIndex(index)} onMouseLeave={() => setActiveCategoryIndex(null)}>{categoryData.map((item) => <Cell key={item.category} fill={item.color} />)}</Pie></PieChart></ResponsiveContainer>
              <div className="v2-donut-label"><span>{activeCategory?.label ?? "Spent"}</span><strong className="amount">{formatMoney(activeCategory?.value ?? summary.expenses, currency, true)}</strong></div>
            </div>
            <ul className="v2-rows">{categoryData.map((item, index) => <li key={item.category} className={`v2-report-cat${activeCategoryIndex === index ? " is-active" : ""}`} onMouseEnter={() => setActiveCategoryIndex(index)} onMouseLeave={() => setActiveCategoryIndex(null)}>
              <CategoryTile category={item.category} custom={customCategories} size={38} />
              <span className="v2-row-main"><strong>{item.label}</strong><span className="v2-progress"><span style={{ width: `${Math.max(2, item.percentage)}%`, background: item.color }} /></span></span>
              <span className="v2-row-end"><strong className="amount">{plainAmount(item.value)}</strong><small className="v2-muted">{item.percentage}%</small></span>
            </li>)}</ul>
          </> : <div className="v2-report-empty"><p className="v2-empty">Nothing spent in {monthName} yet.</p><button type="button" className="v2-button is-primary" onClick={onAdd}><Plus size={16} weight="bold" />Add entries</button></div>}
        </section>

        <section className="v2-card v2-report-history" aria-labelledby="report-history-heading">
          <header className="v2-card-head"><h2 id="report-history-heading">Last six months</h2><span className="v2-chart-keys is-dark"><span><i className="is-in" />In</span><span><i className="is-out" />Out</span></span></header>
          {history.length ? <div className="v2-history-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={history} barGap={3} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}><CartesianGrid vertical={false} stroke="#eeefe7" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#5d6b63", fontSize: 12 }} /><YAxis tickFormatter={(value) => formatMoney(Number(value), currency, true).replace(`${currency}`, "").trim()} axisLine={false} tickLine={false} width={42} tick={{ fill: "#5d6b63", fontSize: 11 }} /><Tooltip cursor={{ fill: "#f4f5ef" }} formatter={(value) => formatMoney(Number(value), currency)} contentStyle={{ borderRadius: 12, border: "1px solid #e3e5da" }} /><Bar dataKey="income" name="In" fill="#2f8f5b" radius={[6, 6, 2, 2]} isAnimationActive={false} /><Bar dataKey="expenses" name="Out" fill="#e07a5f" radius={[6, 6, 2, 2]} isAnimationActive={false} /></BarChart></ResponsiveContainer></div> : <p className="v2-empty">Log a few entries to see months side by side.</p>}
        </section>
      </div>

      <NepaliYearSection transactions={transactions} currency={currency} allowPdfDownload={allowPdfDownload} />

      <div className="v2-report-grid">
        <section className="v2-card" aria-labelledby="report-accounts-heading">
          <header className="v2-card-head"><h2 id="report-accounts-heading">Where your money sits</h2></header>
          {paymentAccounts.length > 0 && !balancesShown ? <BalanceLocked title="Account balances are hidden" /> : paymentAccounts.length ? <>
            <ul className="v2-rows">{paymentAccounts.map((account) => {
              const percentage = trackedBalance > 0 ? Math.round((account.currentBalanceMinor / trackedBalance) * 100) : 0;
              const { tone } = accountLook(account);
              return <li key={account.id} className="v2-row">
                <AccountTile account={account} size={38} />
                <span className="v2-row-main"><strong>{paymentAccountLabel(account)}</strong><span className="v2-progress"><span style={{ width: `${Math.max(0, Math.min(100, percentage))}%`, background: tone.ink }} /></span><small>{percentage}% · checked {formatLedgerDate(account.balanceAsOf, calendarSystem)}</small></span>
                <span className="v2-row-end"><strong className="amount">{plainAmount(account.currentBalanceMinor)}</strong></span>
              </li>;
            })}</ul>
            {!hasPin && <BalancePinHint />}
          </> : <p className="v2-empty">Add your bank or wallet balances on Accounts to see the full picture.</p>}
        </section>

        <section className="v2-card" aria-labelledby="report-moments-heading">
          <header className="v2-card-head"><h2 id="report-moments-heading">Moments to remember</h2><Sparkle size={18} weight="duotone" /></header>
          {milestones.length ? <ol className="v2-timeline">{milestones.map((item) => <li key={item.id}>
            <span className="v2-tile" style={toneStyle(MILESTONE_TONES[item.tone].bg, MILESTONE_TONES[item.tone].ink, 34)} aria-hidden="true"><FlagBanner size={17} weight="duotone" /></span>
            <div><small>{formatLedgerDate(item.date, calendarSystem)}</small><strong>{item.title}</strong><p>{item.detail}</p></div>
          </li>)}</ol> : <p className="v2-empty">Your first entries will start the story.</p>}
        </section>
      </div>
    </div>
  );
}

/**
 * The Nepali fiscal year (Shrawan to Ashadh) and festival spending, which is
 * what salaries, taxes and household budgets in Nepal actually run on. A
 * Jan-Dec summary matches nothing a user here files against.
 */
function NepaliYearSection({ transactions, currency, allowPdfDownload }: { transactions: LedgerTransaction[]; currency: CurrencyCode; allowPdfDownload: boolean }) {
  const today = todayInput();
  const [fiscalKey, setFiscalKey] = useState(() => { try { return fiscalYearOf(today); } catch { return null; } });
  const bsYear = (() => { try { return adToBs(today).year; } catch { return null; } })();
  // Hooks run on every render; the section simply renders nothing outside the supported years.
  const picture = useMemo(() => {
    if (!fiscalKey) return null;
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
  if (!fiscalKey || !picture) return null;

  const step = (delta: number) => { try { setFiscalKey(addFiscalYears(fiscalKey, delta)); } catch { /* at the edge of the supported range */ } };
  const { bounds, income, expenses, entries, festivals } = picture;
  const net = income - expenses;

  return <section className="v2-card v2-fiscal" aria-labelledby="fiscal-heading">
    <header className="v2-card-head v2-fiscal-head">
      <div><h2 id="fiscal-heading">Nepali year</h2><small className="v2-muted">Shrawan 1 to the end of Ashadh · {format(parseISO(bounds.start), "MMM d, yyyy")} – {format(parseISO(bounds.endExclusive), "MMM d, yyyy")}</small></div>
      <div className="v2-head-actions">
        <span className="v2-chip is-stepper"><button type="button" onClick={() => step(-1)} aria-label="Previous fiscal year"><CaretLeft size={15} weight="bold" /></button><strong>{fiscalYearLabel(fiscalKey)}</strong><button type="button" onClick={() => step(1)} aria-label="Next fiscal year"><CaretRight size={15} weight="bold" /></button></span>
        {allowPdfDownload && isCompletedReportMonth(fiscalKey) && <a className="v2-button is-small" href={`/api/reports/monthly?month=${encodeURIComponent(fiscalKey)}`} download={`SaveYoRupee-${reportFileKey(fiscalKey)}-summary.pdf`}><DownloadSimple size={15} weight="bold" />Summary PDF</a>}
      </div>
    </header>
    <div className="v2-fiscal-kpis">
      <span><small>In</small><strong className="amount v2-money is-in">{plainAmount(income)}</strong></span>
      <span><small>Out</small><strong className="amount">{plainAmount(expenses)}</strong></span>
      <span><small>Net</small><strong className={`amount${net < 0 ? " is-over" : ""}`}>{net < 0 ? "−" : ""}{plainAmount(Math.abs(net))}</strong></span>
      <span><small>Entries</small><strong>{entries}</strong></span>
    </div>
    {festivals.length > 0 && <>
      <h3 className="v2-fiscal-sub"><Confetti size={17} weight="duotone" />Festival seasons</h3>
      <div className="v2-festival-grid">{festivals.map((comparison) => <FestivalCard key={comparison.periodKey} comparison={comparison} currency={currency} today={today} />)}</div>
    </>}
  </section>;
}

/** One season this BS year: still to come (last year's total, never "−100%"), under way (against last year at the same day), or over. */
function FestivalCard({ comparison, currency, today }: { comparison: FestivalComparison; currency: CurrencyCode; today: string }) {
  const { festival, status, previousBsYear, previousSpentMinor, previousComparableMinor, changePercentage } = comparison;
  const dayCount = Math.round((Date.parse(`${comparison.bounds.start}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const startsIn = dayCount === 1 ? "Starts tomorrow" : `Starts in ${dayCount} days`;
  const change = changePercentage === null ? null : <small className={`v2-delta ${changePercentage > 0 ? "is-up" : "is-down"}`}>{changePercentage > 0 ? "+" : ""}{changePercentage}% vs {status === "running" ? `the same point in ${previousBsYear}` : previousBsYear} (<span className="amount">{formatMoney(previousComparableMinor ?? 0, currency)}</span>)</small>;
  return <article className={`v2-festival-card is-${status}`}>
    <header><strong>{festival.name} {comparison.bsYear}</strong><small>{festivalMonthLabel(festival)}</small></header>
    {status === "upcoming" ? <>
      <b>{startsIn}</b>
      <small className="v2-muted">{previousSpentMinor ? <>Last year <span className="amount">{formatMoney(previousSpentMinor, currency)}</span></> : `Nothing logged for ${previousBsYear}`}</small>
    </> : <>
      <b className="amount">{formatMoney(comparison.spentMinor, currency)}</b>
      {status === "running" && <small className="v2-festival-day">Day {comparison.daysElapsed} of {comparison.seasonDays} · so far</small>}
      {change ?? <small className="v2-muted">{previousSpentMinor === null ? "Nothing earlier to compare against." : status === "running" && previousSpentMinor > 0 ? <>Nothing by this point in {previousBsYear} · <span className="amount">{formatMoney(previousSpentMinor, currency)}</span> over its whole season</> : `No ${previousBsYear} spending to compare against yet.`}</small>}
    </>}
  </article>;
}
