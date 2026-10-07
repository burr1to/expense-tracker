import { Confetti, PiggyBank, Target, X } from "@phosphor-icons/react";
import { NumberInput } from "@mantine/core";
import { format, parseISO } from "date-fns";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ButtonSpinner } from "./ButtonSpinner";
import { FormError } from "./FormError";
import { useLedger } from "../context/LedgerContext";
import { minorToMajorInput } from "../lib/allocation-calculator";
import { isAllSpendingBudget } from "../lib/budgets";
import { formatMoney, majorToMinor } from "../lib/currency";
import { todayInput } from "../lib/dates";
import { compareFestivalSpending, expensesBetween, festivalHeadsUp, festivalLabel } from "../lib/festivals";
import { transactionCountsTowardBudget } from "../lib/household";
import type { Budget, CurrencyCode, LedgerTransaction } from "../types";

const DISMISS_EVENT = "syr:festival-heads-up";
const storageKey = (periodKey: string) => `syr:festival-heads-up:${periodKey}`;
const readDismissed = (periodKey: string) => { try { return window.localStorage.getItem(storageKey(periodKey)) === "dismissed"; } catch { return false; } };
const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener(DISMISS_EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(DISMISS_EVENT, callback); };
};

/**
 * A dashboard nudge before (and during) a festival season: when it starts,
 * what last year's season cost, and a way to budget or save for it. Dismissed
 * once per season; hidden once the season has a budget.
 */
export function FestivalHeadsUp({ transactions, budgets, currency }: { transactions: LedgerTransaction[]; budgets: Budget[]; currency: CurrencyCode }) {
  const { profile, goals, saveGoal } = useLedger();
  const router = useRouter();
  const today = todayInput();
  const season = useMemo(() => { try { return festivalHeadsUp(today, 30); } catch { return null; } }, [today]);
  const lastYearMinor = useMemo(() => {
    if (!season) return 0;
    const own = transactions.filter((item) => transactionCountsTowardBudget(item, { userId: profile.id, shared: false }));
    try { return compareFestivalSpending(season.festival, season.bsYear, expensesBetween(own), today).previousSpentMinor ?? 0; } catch { return 0; }
  }, [profile.id, season, today, transactions]);
  const periodKey = season?.periodKey ?? "";
  // Hidden during server render and until storage is read, so a dismissed card never flashes.
  const dismissed = useSyncExternalStore(subscribe, () => !periodKey || readDismissed(periodKey), () => true);
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalAmount, setGoalAmount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!season || dismissed || hidden) return null;
  if (budgets.some((budget) => budget.userId === profile.id && budget.monthKey === season.periodKey && isAllSpendingBudget(budget))) return null;

  const { festival, bsYear, daysAway, daysToMainDay, mainDay } = season;
  const goalName = festivalLabel(festival, bsYear);
  const goal = goals.find((item) => item.name === goalName);
  const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;
  const headline = daysAway > 0 ? `${festival.name} season starts in ${days(daysAway)}` : daysToMainDay ? `${festival.mainDayName} is in ${days(daysToMainDay)}` : `${festival.name} season is here`;
  const targetDate = mainDay && mainDay > today ? mainDay : season.bounds.start > today ? season.bounds.start : "";
  const amount = goalAmount ?? (lastYearMinor > 0 ? minorToMajorInput(Math.ceil(lastYearMinor / 100_000) * 100_000) : "");
  const dismiss = () => {
    setHidden(true);
    try { window.localStorage.setItem(storageKey(season.periodKey), "dismissed"); window.dispatchEvent(new Event(DISMISS_EVENT)); } catch { /* storage blocked: hidden for this visit only */ }
  };
  const createGoal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || majorToMinor(amount) <= 0) return;
    setSaving(true); setError(null);
    try { await saveGoal({ name: goalName, target: amount, saved: "0", targetDate }); setGoalOpen(false); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create the goal."); }
    finally { setSaving(false); }
  };

  return <section className="festival-heads-up" aria-labelledby="festival-heads-up-title">
    <span className="festival-heads-up-icon"><Confetti size={22} weight="duotone" /></span>
    <div className="festival-heads-up-copy">
      <strong id="festival-heads-up-title">{headline}</strong>
      <p>{lastYearMinor > 0 ? <>Last year you spent <span className="budget-money">{formatMoney(lastYearMinor, currency)}</span> over the {festival.name} season.</> : `Plan the ${festival.name} season before the shopping starts.`}{mainDay && mainDay >= today ? ` ${festival.mainDayName} falls on ${format(parseISO(mainDay), "MMM d")}.` : ""}</p>
      {goal && <small>Saving for it: <span className="budget-money">{formatMoney(goal.savedMinor, currency)}</span> of <span className="budget-money">{formatMoney(goal.targetMinor, currency)}</span> in “{goal.name}”.</small>}
      {goalOpen && !goal && <form className="festival-heads-up-goal" onSubmit={createGoal} aria-busy={saving}>
        <NumberInput label={`Save for ${goalName} in ${currency}`} value={amount} onChange={(value) => setGoalAmount(String(value))} min={0} thousandSeparator="," decimalScale={2} required disabled={saving} />
        <button className="primary-button small" disabled={saving || majorToMinor(amount) <= 0}>{saving ? <><ButtonSpinner />Creating…</> : <><Target size={16} />Create goal</>}</button>
      </form>}
      <FormError message={error} />
      <div className="festival-heads-up-actions">
        <button type="button" className="primary-button small" onClick={() => router.push(`/plans?festival=${encodeURIComponent(season.periodKey)}`)}>Set a budget</button>
        {!goal && !goalOpen && <button type="button" className="secondary-button small" onClick={() => setGoalOpen(true)}><PiggyBank size={16} />Save for it</button>}
      </div>
    </div>
    <button type="button" className="icon-button festival-heads-up-dismiss" onClick={dismiss} aria-label="Dismiss the festival heads-up"><X size={16} /></button>
  </section>;
}
