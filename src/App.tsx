"use client";

import { Eye, EyeSlash, LockKey, Wallet } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { TransactionForm } from "./components/TransactionForm";
import { useAuth } from "./context/AuthContext";
import { useLedger } from "./context/LedgerContext";
import { AuthPage } from "./views/AuthPage";
import { DashboardPage } from "./views/DashboardPage";
import { PlanningPage } from "./views/PlanningPage";
import { ReportsPage } from "./views/ReportsPage";
import { SettingsPage } from "./views/SettingsPage";
import { TransactionsPage } from "./views/TransactionsPage";
import type { AppView, LedgerTransaction } from "./types";

export default function App() {
  const { user, isDemo, loading: authLoading, verifyPassword } = useAuth();
  const ledger = useLedger();
  const [view, setView] = useState<AppView>("home"); const [month, setMonth] = useState(new Date());
  const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState<LedgerTransaction | null>(null);
  const [locked, setLocked] = useState(false); const [amountsHidden, setAmountsHidden] = useState(false);

  useEffect(() => { setAmountsHidden(ledger.profile.hideAmounts); }, [ledger.profile.hideAmounts]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [view]);
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { root.dataset.theme = ledger.profile.theme === "system" ? media.matches ? "dark" : "light" : ledger.profile.theme; };
    apply(); media.addEventListener("change", apply); return () => media.removeEventListener("change", apply);
  }, [ledger.profile.theme]);
  useEffect(() => { document.body.dataset.hideAmounts = String(amountsHidden); }, [amountsHidden]);
  useEffect(() => {
    if (!ledger.profile.autoLockMinutes || locked || (!user && !isDemo)) return;
    let timer = window.setTimeout(() => setLocked(true), ledger.profile.autoLockMinutes * 60_000);
    const reset = () => { window.clearTimeout(timer); timer = window.setTimeout(() => setLocked(true), ledger.profile.autoLockMinutes * 60_000); };
    window.addEventListener("pointerdown", reset); window.addEventListener("keydown", reset);
    return () => { window.clearTimeout(timer); window.removeEventListener("pointerdown", reset); window.removeEventListener("keydown", reset); };
  }, [ledger.profile.autoLockMinutes, locked, user, isDemo]);

  if (authLoading) return <div className="boot-screen"><span className="loader" /><strong>Opening your ledger…</strong></div>;
  if (!user && !isDemo) return <AuthPage />;
  const openAdd = () => { setEditing(null); setFormOpen(true); }; const openEdit = (transaction: LedgerTransaction) => { setEditing(transaction); setFormOpen(true); };
  const remove = async (transaction: LedgerTransaction) => { if (window.confirm(`Delete “${transaction.note || "this entry"}”? This cannot be undone.`)) await ledger.deleteTransaction(transaction.id); };
  let content: React.ReactNode;
  if (ledger.loading) content = <div className="page-loading"><span className="loader" />Loading your entries…</div>;
  else if (ledger.error) content = <div className="page-error"><strong>We couldn’t load your ledger.</strong><p>{ledger.error}</p></div>;
  else if (view === "plan") content = <PlanningPage month={month} currency={ledger.profile.currency} transactions={ledger.transactions} budgets={ledger.budgets} recurringEntries={ledger.recurringEntries} goals={ledger.goals} customCategories={ledger.customCategories} onMonthChange={setMonth} onSaveBudget={ledger.saveBudget} onDeleteBudget={ledger.deleteBudget} onSaveRecurring={ledger.saveRecurring} onDeleteRecurring={ledger.deleteRecurring} onConfirmRecurring={ledger.confirmRecurring} onSaveGoal={ledger.saveGoal} onContribute={ledger.contributeToGoal} onDeleteGoal={ledger.deleteGoal} />;
  else if (view === "reports") content = <ReportsPage month={month} currency={ledger.profile.currency} transactions={ledger.transactions} customCategories={ledger.customCategories} onMonthChange={setMonth} onAdd={openAdd} />;
  else if (view === "transactions") content = <TransactionsPage currency={ledger.profile.currency} transactions={ledger.transactions} customCategories={ledger.customCategories} onAdd={openAdd} onEdit={openEdit} onDelete={(transaction) => void remove(transaction)} onImport={ledger.importTransactions} />;
  else if (view === "settings") content = <SettingsPage onLock={() => setLocked(true)} />;
  else content = <DashboardPage month={month} currency={ledger.profile.currency} transactions={ledger.transactions} budgets={ledger.budgets} recurringEntries={ledger.recurringEntries} customCategories={ledger.customCategories} onMonthChange={setMonth} onAdd={openAdd} onNavigate={setView} onConfirmRecurring={ledger.confirmRecurring} />;

  return <><AppShell view={view} onNavigate={setView} onAdd={openAdd}>{content}</AppShell><button className="privacy-toggle" onClick={() => setAmountsHidden((hidden) => !hidden)} aria-label={amountsHidden ? "Reveal amounts" : "Hide amounts"}>{amountsHidden ? <Eye size={19} /> : <EyeSlash size={19} />}</button><TransactionForm open={formOpen} currency={ledger.profile.currency} transaction={editing} customCategories={ledger.customCategories} onClose={() => setFormOpen(false)} onSave={ledger.saveTransaction} />{locked && <PrivacyLock isDemo={isDemo} onUnlock={async (password) => { await verifyPassword(password); setLocked(false); }} />}</>;
}

function PrivacyLock({ isDemo, onUnlock }: { isDemo: boolean; onUnlock: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState(""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); try { setError(null); await onUnlock(password); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not unlock."); } finally { setBusy(false); } };
  return <div className="privacy-lock"><div className="lock-card"><span className="lock-icon"><LockKey size={28} weight="duotone" /></span><div className="brand-mark"><Wallet size={22} weight="duotone" /><span>Paper Ledger</span></div><h2>Your ledger is locked</h2><p>{isDemo ? "Unlock to continue your private demo session." : "Re-enter your account password to continue."}</p><form onSubmit={submit}>{!isDemo && <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Account password" autoFocus required />}{error && <div className="form-error">{error}</div>}<button className="primary-button full-width" disabled={busy}>{busy ? "Checking…" : "Unlock ledger"}</button></form></div></div>;
}
