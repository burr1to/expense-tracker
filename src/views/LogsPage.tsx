import { ArrowClockwise, CaretDown, ClockCounterClockwise } from "@phosphor-icons/react";
import { format, parseISO } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIcon, activityAmountText, activityTone } from "../components/ActivityIcon";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { ACTIVITY_AREA_LABELS, ACTIVITY_AREAS, ACTIVITY_RETENTION_DAYS, type ActivityArea, type ActivityChange, type ActivityEntry, type ActivityPage } from "../lib/activity-log";
import { formatMoney } from "../lib/currency";
import { formatLedgerDate, formatLedgerDay, toDateInput, todayInput } from "../lib/dates";
import type { CalendarSystem, CurrencyCode } from "../types";

type AreaFilter = ActivityArea | "all";

async function fetchPage(area: AreaFilter, cursor: string | null): Promise<ActivityPage> {
  const params = new URLSearchParams();
  if (area !== "all") params.set("area", area);
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/activity${params.size ? `?${params}` : ""}`, { cache: "no-store" });
  const body = await response.json() as ActivityPage & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Could not load your logs.");
  return body;
}

function dayHeading(dayKey: string, system: CalendarSystem) {
  const today = todayInput();
  const yesterday = toDateInput(new Date(Date.now() - 86_400_000));
  if (dayKey === today) return "Today";
  if (dayKey === yesterday) return "Yesterday";
  return formatLedgerDay(dayKey, system);
}

function ChangeValue({ value, currency, system }: { value: ActivityChange["from"]; currency: CurrencyCode; system: CalendarSystem }) {
  if (value === null) return <span className="log-empty">None</span>;
  if (typeof value === "string") return <span>{value}</span>;
  if ("money" in value) return <span className="log-money">{formatMoney(value.money, currency)}</span>;
  return <span>{formatLedgerDate(value.date, system)}</span>;
}

const META_DETAILS: { key: string; label: string; show?: (value: unknown) => boolean }[] = [
  { key: "note", label: "Note" },
  { key: "ip", label: "IP address" },
  { key: "repeats", label: "Repeats" },
  { key: "type", label: "Type" },
  { key: "count", label: "Rows" },
  { key: "newCategories", label: "New categories", show: (value) => Number(value) > 0 },
  { key: "addedToLedger", label: "Added to ledger", show: (value) => value === true },
];

function LogRow({ entry, system }: { entry: ActivityEntry; system: CalendarSystem }) {
  const [open, setOpen] = useState(false);
  const amount = activityAmountText(entry);
  const details = META_DETAILS.filter(({ key, show }) => entry.meta?.[key] !== undefined && entry.meta?.[key] !== null && entry.meta?.[key] !== "" && (show ? show(entry.meta?.[key]) : true));
  const expandable = entry.changes.length > 0 || details.length > 0;
  const panelId = `log-details-${entry.id}`;
  return (
    <li className={`log-row is-${activityTone(entry)}`}>
      <span className="log-icon" aria-hidden="true"><ActivityIcon entry={entry} size={18} /></span>
      <div className="log-main">
        <div className="log-line">
          <span className="log-copy">
            <strong>{entry.title}</strong>
            {entry.subject && <span>{entry.subject}</span>}
          </span>
          <span className="log-side">
            {amount && <span className={`log-amount${entry.meta?.kind === "income" && amount.startsWith("+") ? " is-in" : ""}`}>{amount}</span>}
            <time dateTime={entry.createdAt}>{format(parseISO(entry.createdAt), "h:mm a")}</time>
          </span>
        </div>
        {expandable && (
          <button type="button" className="log-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
            {entry.changes.length ? `${entry.changes.length} change${entry.changes.length === 1 ? "" : "s"}` : "Details"}
            <CaretDown size={13} weight="bold" />
          </button>
        )}
        {expandable && (
          <div id={panelId} className="log-details" data-open={open} hidden={!open}>
            {entry.changes.length > 0 && (
              <dl className="log-changes">
                {entry.changes.map((change) => (
                  <div key={change.field}>
                    <dt>{change.field}</dt>
                    <dd>
                      <ChangeValue value={change.from} currency={entry.currency} system={system} />
                      <span className="log-arrow" aria-label="changed to">→</span>
                      <ChangeValue value={change.to} currency={entry.currency} system={system} />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {details.length > 0 && (
              <dl className="log-meta">
                {details.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{entry.meta?.[key] === true ? "Yes" : String(entry.meta?.[key])}</dd></div>)}
              </dl>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function LogsPage({ calendarSystem, activityRevision }: { calendarSystem: CalendarSystem; activityRevision: number }) {
  const [area, setArea] = useState<AreaFilter>("all");
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  // The first page always comes straight from the server, so the list reflects exactly what was recorded.
  const loadFirstPage = useCallback(async (showLoading: boolean) => {
    const ticket = ++request.current;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(area, null);
      if (ticket !== request.current) return;
      setEntries(page.entries);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      if (ticket === request.current) setError(caught instanceof Error ? caught.message : "Could not load your logs.");
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [area]);

  useEffect(() => { void loadFirstPage(true); }, [loadFirstPage]);
  const seenRevision = useRef(activityRevision);
  useEffect(() => {
    if (seenRevision.current === activityRevision) return;
    seenRevision.current = activityRevision;
    void loadFirstPage(false);
  }, [activityRevision, loadFirstPage]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const ticket = request.current;
    setLoadingMore(true);
    try {
      const page = await fetchPage(area, nextCursor);
      if (ticket !== request.current) return;
      setEntries((current) => [...current, ...page.entries.filter((entry) => !current.some((item) => item.id === entry.id))]);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load older entries.");
    } finally {
      setLoadingMore(false);
    }
  };

  const days = useMemo(() => {
    const groups: { key: string; entries: ActivityEntry[] }[] = [];
    for (const entry of entries) {
      const key = toDateInput(parseISO(entry.createdAt));
      const group = groups[groups.length - 1];
      if (group?.key === key) group.entries.push(entry);
      else groups.push({ key, entries: [entry] });
    }
    return groups;
  }, [entries]);

  return (
    <div className="page logs-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">What happened, and when</span>
          <h1>Logs</h1>
          <p>Every change made in your ledger over the last {ACTIVITY_RETENTION_DAYS} days. Entries are written by the server as each change is saved, and can’t be edited.</p>
        </div>
      </header>

      <div className="log-filters" role="group" aria-label="Filter logs">
        {(["all", ...ACTIVITY_AREAS] as const).map((option) => (
          <button key={option} type="button" className="log-filter" aria-pressed={area === option} onClick={() => setArea(option)}>
            {option === "all" ? "Everything" : ACTIVITY_AREA_LABELS[option]}
          </button>
        ))}
      </div>

      {error && (
        <div className="log-error" role="alert">
          <span>{error}</span>
          <button type="button" className="secondary-button small" onClick={() => void loadFirstPage(true)}><ArrowClockwise size={16} />Try again</button>
        </div>
      )}

      {loading && !entries.length ? (
        <div className="log-loading" role="status"><ButtonSpinner />Loading logs…</div>
      ) : !entries.length && !error ? (
        <div className="empty-state log-empty-state">
          <ClockCounterClockwise size={30} />
          <strong>{area === "all" ? "Nothing logged yet" : `No ${ACTIVITY_AREA_LABELS[area].toLowerCase()} activity`}</strong>
          <p>{area === "all" ? "When you add, change or delete something, it shows up here." : `Nothing in ${ACTIVITY_AREA_LABELS[area].toLowerCase()} in the last ${ACTIVITY_RETENTION_DAYS} days.`}</p>
        </div>
      ) : (
        <div className="log-days" aria-busy={loading} data-loading={loading}>
          {days.map((day) => (
            <section className="log-day" key={day.key} aria-labelledby={`log-day-${day.key}`}>
              <h2 id={`log-day-${day.key}`}>{dayHeading(day.key, calendarSystem)}</h2>
              <ol className="log-list">
                {day.entries.map((entry) => <LogRow key={entry.id} entry={entry} system={calendarSystem} />)}
              </ol>
            </section>
          ))}
          {nextCursor && (
            <button type="button" className="secondary-button log-more" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore && <ButtonSpinner />}{loadingMore ? "Loading…" : "Show older entries"}
            </button>
          )}
          {!nextCursor && entries.length > 0 && <p className="log-end">That’s everything from the last {ACTIVITY_RETENTION_DAYS} days.</p>}
        </div>
      )}
    </div>
  );
}
