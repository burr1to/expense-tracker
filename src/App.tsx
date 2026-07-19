"use client";

import { Eye, EyeSlash, LockKey, Wallet } from "@phosphor-icons/react";
import { PasswordInput } from "@mantine/core";
import { parseISO } from "date-fns";
import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { ButtonSpinner } from "./components/ButtonSpinner";
import { TransactionForm } from "./components/TransactionForm";
import { ReminderBell } from "./components/ReminderBell";
import { useAuth } from "./context/AuthContext";
import { useLedger } from "./context/LedgerContext";
import { AuthPage } from "./views/AuthPage";
import { DashboardPage } from "./views/DashboardPage";
import { DuesPage } from "./views/DuesPage";
import { PlanningPage } from "./views/PlanningPage";
import { ReportsPage } from "./views/ReportsPage";
import { SettingsPage } from "./views/SettingsPage";
import { TransactionsPage } from "./views/TransactionsPage";
import type { AppView, LedgerTransaction, TransactionDraft } from "./types";

export default function App() {
  const { user, isDemo, loading: authLoading, signOut } = useAuth();
  const ledger = useLedger();
  const [view, setView] = useState<AppView>("home"); const [month, setMonth] = useState(new Date());
  const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState<LedgerTransaction | null>(null);
  const [homeFocus, setHomeFocus] = useState<{ date: string; revision: number } | null>(null);
  const [locked, setLocked] = useState(false); const [amountsHidden, setAmountsHidden] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

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
    if (!ledger.profile.hasPin || !ledger.profile.autoLockMinutes || locked || (!user && !isDemo)) return;
    let timer = window.setTimeout(() => setLocked(true), ledger.profile.autoLockMinutes * 60_000);
    const reset = () => { window.clearTimeout(timer); timer = window.setTimeout(() => setLocked(true), ledger.profile.autoLockMinutes * 60_000); };
    window.addEventListener("pointerdown", reset); window.addEventListener("keydown", reset);
    return () => { window.clearTimeout(timer); window.removeEventListener("pointerdown", reset); window.removeEventListener("keydown", reset); };
  }, [ledger.profile.autoLockMinutes, ledger.profile.hasPin, locked, user, isDemo]);

  if (authLoading) return <AppLoader className="boot-screen" message="Opening your ledger" />;
  if (!user && !isDemo) return <AuthPage />;
  const openAdd = () => { setEditing(null); setFormOpen(true); }; const openEdit = (transaction: LedgerTransaction) => { setEditing(transaction); setFormOpen(true); };
  const saveTransaction = async (draft: TransactionDraft, id?: string) => {
    await ledger.saveTransaction(draft, id);
    if (!id && view === "home") {
      setMonth(parseISO(draft.occurredOn));
      setHomeFocus((current) => ({ date: draft.occurredOn, revision: (current?.revision ?? 0) + 1 }));
    }
  };
  const remove = async (transaction: LedgerTransaction) => { if (window.confirm(`Delete “${transaction.note || "this entry"}”? This cannot be undone.`)) await ledger.deleteTransaction(transaction.id); };
  const logOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "Could not sign out.");
      setSigningOut(false);
    }
  };
  let content: React.ReactNode;
  if (ledger.loading) content = <AppLoader className="page-loading" message="Loading your entries" />;
  else if (ledger.error) content = <div className="page-error"><strong>We couldn’t load your ledger.</strong><p>{ledger.error}</p></div>;
  else if (view === "plan") content = <PlanningPage month={month} currency={ledger.profile.currency} transactions={ledger.transactions} budgets={ledger.budgets} recurringEntries={ledger.recurringEntries} goals={ledger.goals} customCategories={ledger.customCategories} onMonthChange={setMonth} onSaveBudget={ledger.saveBudget} onDeleteBudget={ledger.deleteBudget} onSaveRecurring={ledger.saveRecurring} onDeleteRecurring={ledger.deleteRecurring} onConfirmRecurring={ledger.confirmRecurring} onSaveGoal={ledger.saveGoal} onContribute={ledger.contributeToGoal} onDeleteGoal={ledger.deleteGoal} />;
  else if (view === "reports") content = <ReportsPage month={month} currency={ledger.profile.currency} transactions={ledger.transactions} customCategories={ledger.customCategories} dueItems={ledger.dueItems} onMonthChange={setMonth} onAdd={openAdd} />;
  else if (view === "transactions") content = <TransactionsPage currency={ledger.profile.currency} transactions={ledger.transactions} customCategories={ledger.customCategories} paymentAccounts={ledger.paymentAccounts} onAdd={openAdd} onEdit={openEdit} onDelete={remove} onImport={ledger.importTransactions} />;
  else if (view === "dues") content = <DuesPage currency={ledger.profile.currency} items={ledger.dueItems} customCategories={ledger.customCategories} onSave={ledger.saveDueItem} onDelete={ledger.deleteDueItem} onRecordPayment={ledger.recordDuePayment} onComplete={ledger.completeDueItem} />;
  else if (view === "settings") content = <SettingsPage onLock={() => { if (ledger.profile.hasPin) setLocked(true); }} />;
  else content = <DashboardPage month={month} focus={homeFocus} currency={ledger.profile.currency} transactions={ledger.transactions} budgets={ledger.budgets} recurringEntries={ledger.recurringEntries} goals={ledger.goals} customCategories={ledger.customCategories} onMonthChange={setMonth} onAdd={openAdd} onNavigate={setView} onConfirmRecurring={ledger.confirmRecurring} />;

  return <><AppShell view={view} onNavigate={setView} onAdd={openAdd} onSignOut={() => void logOut()} signingOut={signingOut}>{content}</AppShell><ReminderBell items={ledger.dueItems} currency={ledger.profile.currency} onNavigate={setView} /><button className="privacy-toggle" onClick={() => setAmountsHidden((hidden) => !hidden)} aria-label={amountsHidden ? "Reveal amounts" : "Hide amounts"}>{amountsHidden ? <Eye size={19} /> : <EyeSlash size={19} />}</button><TransactionForm open={formOpen} currency={ledger.profile.currency} transaction={editing} customCategories={ledger.customCategories} paymentAccounts={ledger.paymentAccounts} onClose={() => setFormOpen(false)} onSave={saveTransaction} />{locked && ledger.profile.hasPin && <PrivacyLock onUnlock={async (pin) => { await ledger.verifyPin(pin); setLocked(false); }} />}</>;
}

function AppLoader({ className, message }: { className: "boot-screen" | "page-loading"; message: string }) {
  return <div className={className} role="status" aria-live="polite">
    <div className="app-loader-card">
      <div className="loader-brand">
        <span className="loader-logo"><Wallet size={24} weight="duotone" /></span>
        <span><strong>Paper Ledger</strong><small>Your money, clearly.</small></span>
      </div>
      <div className="loader-ledger" aria-hidden="true">
        <div><i /><span /><b /></div>
        <div><i /><span /><b /></div>
        <div><i /><span /><b /></div>
      </div>
      <div className="loader-status"><i aria-hidden="true" /><span>{message}</span></div>
    </div>
  </div>;
}

function PrivacyLock({ onUnlock }: { onUnlock: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState(""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); try { setError(null); await onUnlock(pin); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not unlock."); setPin(""); } finally { setBusy(false); } };
  return <div className="privacy-lock"><div className="lock-card"><span className="lock-icon"><LockKey size={28} weight="duotone" /></span><div className="brand-mark"><Wallet size={22} weight="duotone" /><span>Paper Ledger</span></div><h2>Your ledger is locked</h2><p>Enter your ledger PIN to continue.</p><form onSubmit={submit} aria-busy={busy}><PasswordInput value={pin} disabled={busy} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="4–6 digit PIN" inputMode="numeric" autoComplete="current-password" autoFocus minLength={4} maxLength={6} required />{error && <div className="form-error" role="alert">{error}</div>}<button className="primary-button full-width" disabled={busy || pin.length < 4}>{busy ? <><ButtonSpinner />Checking…</> : "Unlock ledger"}</button></form></div></div>;
}
