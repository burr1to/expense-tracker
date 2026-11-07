import { ArrowDownRight, ArrowUpRight, CaretLeft, CaretRight, ClipboardText, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, type CSSProperties } from "react";
import { AccountTile, CategoryTile } from "../components/ToneIcon";
import { accountLook } from "../lib/tones";
import { getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { formatLedgerDay, formatLedgerMonth } from "../lib/dates";
import { CASH_BUCKET, compareMonthSpend, daysSinceLastLogged, type MonthComparison } from "../lib/month-compare";
import { paymentAccountLabel } from "../lib/payment-accounts";
import { addMonthsToKey, currentMonthKey, dateOnlyInTimeZone, APP_TIME_ZONE, isSameMonthKey, monthLabel, parseMonthKey, type PeriodKey } from "../lib/period";
import { appRoutes } from "../lib/routes";
import { useToday } from "../lib/use-today";
import type { CalendarSystem, CurrencyCode, CustomCategory, LedgerTransaction, PaymentAccount } from "../types";

interface HomePageProps {
  period: PeriodKey;
  calendarSystem: CalendarSystem;
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  paymentAccounts: PaymentAccount[];
  customCategories: CustomCategory[];
  onPeriodChange: (period: PeriodKey) => void;
  onAdd: () => void;
  onOpenEntry: (transaction: LedgerTransaction) => void;
}

const monthName = (key: PeriodKey) => monthLabel(key).split(" ")[0];
/** Amounts without the currency code, for rows where the code would only repeat. */
const plain = (minor: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(minor / 100));

function Delta({ current, previous, pill = false }: { current: number; previous: number; pill?: boolean }) {
  const diff = current - previous;
  if (diff === 0) return <span className={pill ? "v2-delta is-pill is-flat" : "v2-delta is-flat"}>Same</span>;
  const up = diff > 0;
  return (
    <span className={`v2-delta ${up ? "is-up" : "is-down"}${pill ? " is-pill" : ""}`} aria-label={`${plain(Math.abs(diff))} ${up ? "more" : "less"} than last month`}>
      {up ? "▲" : "▼"} {plain(Math.abs(diff))}
    </span>
  );
}

function SpendChart({ comparison, label, previousLabel }: { comparison: MonthComparison; label: string; previousLabel: string }) {
  const width = 320, height = 150, floor = 132, top = 12;
  const days = Math.max(comparison.daysInMonth, comparison.previousDaysInMonth);
  const peak = Math.max(1, comparison.currentCumulative.at(-1) ?? 0, comparison.previousCumulative.at(-1) ?? 0);
  const x = (index: number) => (days <= 1 ? 0 : (index / (days - 1)) * width);
  const y = (value: number) => floor - (value / peak) * (floor - top);
  const points = (values: number[]) => values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const current = comparison.currentCumulative;
  const last = current.length - 1;
  return (
    <figure className="v2-hero-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Running total by day: ${label} against ${previousLabel}`}>
        <line x1="0" y1={floor} x2={width} y2={floor} className="v2-chart-axis" />
        <line x1="0" y1={(floor + top) / 2} x2={width} y2={(floor + top) / 2} className="v2-chart-grid" />
        {current.length > 1 && <polygon className="v2-chart-area" points={`0,${floor} ${points(current)} ${x(last).toFixed(1)},${floor}`} />}
        <polyline className="v2-chart-previous" points={points(comparison.previousCumulative)} />
        {current.length > 0 && <polyline className="v2-chart-current" points={points(current)} />}
      </svg>
      {current.length > 0 && <span className="v2-chart-dot" style={{ left: `${(x(last) / width) * 100}%`, top: `${(y(current[last]) / height) * 100}%` }} />}
      <figcaption className="v2-chart-legend">
        <span>{label.slice(0, 3)} 1</span>
        <span className="v2-chart-keys"><span><i className="is-current" />{label}</span><span><i className="is-previous" />{previousLabel}</span></span>
        <span>{label.slice(0, 3)} {comparison.daysInMonth}</span>
      </figcaption>
    </figure>
  );
}

export function HomePage({ period, calendarSystem, currency, transactions, paymentAccounts, customCategories, onPeriodChange, onAdd, onOpenEntry }: HomePageProps) {
  const today = useToday();
  const comparison = useMemo(() => compareMonthSpend(transactions, paymentAccounts, period, today), [transactions, paymentAccounts, period, today]);
  const idleDays = useMemo(() => daysSinceLastLogged(transactions, today, (instant) => dateOnlyInTimeZone(APP_TIME_ZONE, new Date(instant))), [transactions, today]);
  const recent = useMemo(() => {
    const days = new Map<string, LedgerTransaction[]>();
    for (const transaction of [...transactions].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt))) {
      if (transaction.occurredOn > today) continue;
      const list = days.get(transaction.occurredOn) ?? [];
      if (!days.has(transaction.occurredOn) && days.size >= 3) break;
      list.push(transaction);
      days.set(transaction.occurredOn, list);
    }
    return [...days.entries()];
  }, [transactions, today]);

  const name = monthName(period);
  const previousName = monthName(addMonthsToKey(period, -1));
  const isCurrent = isSameMonthKey(period, currentMonthKey(parseMonthKey(period).system));
  const range = comparison.elapsedDays > 0 ? `${name} 1–${comparison.elapsedDays}` : name;
  const previousRange = comparison.elapsedDays >= comparison.daysInMonth ? `all of ${previousName}` : `${previousName} 1–${Math.min(comparison.elapsedDays, comparison.previousDaysInMonth)}`;
  const diff = comparison.currentMinor - comparison.previousMinor;
  const percent = comparison.previousMinor > 0 ? Math.round((Math.abs(diff) / comparison.previousMinor) * 100) : null;
  const accountPeak = Math.max(1, ...comparison.accounts.map((row) => Math.max(row.currentMinor, row.previousMinor)));
  const accountRows = comparison.accounts.filter((row) => row.account || row.currentMinor || row.previousMinor);
  const changes = comparison.categories.slice(0, 4);
  const step = (delta: number) => { try { onPeriodChange(addMonthsToKey(period, delta)); } catch { /* outside the supported range */ } };

  const hero = (
    <section className="v2-hero" aria-labelledby="v2-spent-label">
      <span id="v2-spent-label" className="v2-hero-label">{isCurrent ? "Spent so far" : "Spent"} · {range}</span>
      <strong className="v2-hero-amount amount">{formatMoney(comparison.currentMinor, currency)}</strong>
      {comparison.previousMinor > 0 || comparison.currentMinor > 0 ? (
        <span className="v2-hero-pill">
          {diff >= 0 ? <ArrowUpRight size={15} weight="bold" /> : <ArrowDownRight size={15} weight="bold" />}
          {diff === 0 ? `Same as ${previousRange}` : `${formatMoney(Math.abs(diff), currency)}${percent !== null ? ` · ${percent}%` : ""} ${diff > 0 ? "more" : "less"} than ${previousRange}`}
        </span>
      ) : <span className="v2-hero-pill">Nothing spent yet</span>}
      <SpendChart comparison={comparison} label={name} previousLabel={previousName} />
    </section>
  );

  const nudge = isCurrent && idleDays !== null && idleDays >= 2 ? (
    <button type="button" className="v2-nudge" onClick={onAdd}>
      <span className="v2-tile" style={{ "--tile-bg": "#fbe3a6", "--tile-ink": "#8a5a00", "--tile-size": "42px" } as CSSProperties} aria-hidden="true"><ClipboardText size={22} weight="duotone" /></span>
      <span className="v2-nudge-copy"><strong>{idleDays} days since your last entry</strong><span>Catch up from SMS, a statement or a receipt</span></span>
      <CaretRight size={18} weight="bold" aria-hidden="true" />
    </button>
  ) : null;

  const byAccount = (
    <section className="v2-card" aria-labelledby="v2-by-account">
      <header className="v2-card-head"><h2 id="v2-by-account">By account</h2><Link href={appRoutes.accounts}>All accounts</Link></header>
      {accountRows.length === 0 ? <p className="v2-empty">Add an account to see where your money goes.</p> : (
        <ul className="v2-rows">
          {accountRows.map((row) => {
            const { tone } = accountLook(row.account, row.key);
            const label = row.account ? paymentAccountLabel(row.account) : row.key === CASH_BUCKET ? "Cash" : "No account set";
            return (
              <li key={row.key}>
                <Link className="v2-row" href={row.account ? `${appRoutes.accounts}?account=${encodeURIComponent(row.account.id)}` : appRoutes.transactions}>
                  <AccountTile account={row.account} bucket={row.key} />
                  <span className="v2-row-main">
                    <strong>{label}</strong>
                    {(row.currentMinor > 0 || row.previousMinor > 0) && <>
                      <span className="v2-bar" style={{ width: `${(row.currentMinor / accountPeak) * 100}%`, background: tone.ink }} />
                      <span className="v2-bar" style={{ width: `${(row.previousMinor / accountPeak) * 100}%`, background: tone.pale }} />
                    </>}
                    {row.currentMinor === 0 && row.previousMinor === 0 && <small>Nothing spent either month</small>}
                  </span>
                  <span className="v2-row-end"><strong className="amount">{plain(row.currentMinor)}</strong><Delta current={row.currentMinor} previous={row.previousMinor} /></span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="v2-footnote">Strong bar: {range}. Pale bar: {previousRange}.</p>
    </section>
  );

  const biggest = (
    <section className="v2-card" aria-labelledby="v2-changes">
      <header className="v2-card-head"><h2 id="v2-changes">Biggest changes</h2><Link href={appRoutes.reports}>Compare</Link></header>
      {changes.length === 0 ? <p className="v2-empty">No change from last month yet.</p> : (
        <ul className="v2-rows">
          {changes.map((row) => (
            <li key={row.category} className="v2-row">
              <CategoryTile category={row.category} custom={customCategories} />
              <span className="v2-row-main"><strong>{getCategory(row.category, customCategories).label}</strong><small className="amount">{plain(row.currentMinor)} vs {plain(row.previousMinor)}</small></span>
              <Delta current={row.currentMinor} previous={row.previousMinor} pill />
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const recentCard = (
    <section className="v2-card" aria-labelledby="v2-recent">
      <header className="v2-card-head"><h2 id="v2-recent">Recent entries</h2><Link href={appRoutes.transactions}>All transactions</Link></header>
      {recent.length === 0 ? <p className="v2-empty">Nothing logged yet. Tap + to add your first entries.</p> : recent.map(([day, entries]) => {
        const net = entries.reduce((total, entry) => total + (entry.kind === "income" ? entry.amountMinor : -entry.amountMinor), 0);
        return (
          <div key={day} className="v2-day">
            <div className="v2-day-head"><span>{formatLedgerDay(day, calendarSystem)}</span><span className="amount">{net > 0 ? "+" : net < 0 ? "−" : ""}{plain(Math.abs(net))}</span></div>
            <ul className="v2-rows">
              {entries.map((entry) => {
                const category = getCategory(entry.category, customCategories);
                const account = entry.paymentAccount ?? paymentAccounts.find((item) => item.id === entry.paymentAccountId) ?? null;
                return (
                  <li key={entry.id}>
                    <button type="button" className="v2-row" onClick={() => onOpenEntry(entry)}>
                      <CategoryTile category={entry.category} custom={customCategories} />
                      <span className="v2-row-main"><strong>{entry.note || category.label}</strong><small>{category.label} · {account ? paymentAccountLabel(account) : entry.paymentMode === "cash" ? "Cash" : "No account"}</small></span>
                      <strong className={entry.kind === "income" ? "v2-money is-in amount" : "v2-money amount"}>{entry.kind === "income" ? "+" : "−"}{plain(entry.amountMinor)}</strong>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );

  return (
    <div className="v2-page v2-home">
      <header className="v2-page-head">
        <div>
          <span className="v2-eyebrow">{formatLedgerDay(today, calendarSystem)}</span>
          <h1>{formatLedgerMonth(period, calendarSystem)}</h1>
        </div>
        <div className="v2-head-actions">
          <button type="button" className="v2-add-inline" onClick={onAdd}><Plus size={18} weight="bold" />Add entries</button>
          <button type="button" className="v2-icon-btn" onClick={() => step(-1)} aria-label="Previous month"><CaretLeft size={18} weight="bold" /></button>
          <button type="button" className="v2-icon-btn" onClick={() => step(1)} aria-label="Next month" disabled={isCurrent}><CaretRight size={18} weight="bold" /></button>
        </div>
      </header>
      <div className="v2-home-grid">
        <div className="v2-home-col is-main"><div className="v2-slot is-hero">{hero}</div><div className="v2-slot is-recent">{recentCard}</div></div>
        <div className="v2-home-col is-side">{nudge && <div className="v2-slot is-nudge">{nudge}</div>}<div className="v2-slot is-accounts">{byAccount}</div><div className="v2-slot is-changes">{biggest}</div></div>
      </div>
    </div>
  );
}
