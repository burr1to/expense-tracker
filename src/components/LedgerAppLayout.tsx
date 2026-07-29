"use client";

import { PasswordInput } from "@mantine/core";
import { ArrowCounterClockwise, CheckCircle, Eye, EyeSlash, LockKey, Trash, X } from "@phosphor-icons/react";
import { parseISO } from "date-fns";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { useLedger } from "../context/LedgerContext";
import { LedgerWorkspaceContext } from "../context/LedgerWorkspaceContext";
import { toDateInput } from "../lib/dates";
import { monthlyReportNotice } from "../lib/monthly-report";
import { appRoutes, viewFromPathname } from "../lib/routes";
import type { AppView, LedgerTransaction, SavedPlace, TransactionDraft, TransactionLocationDraft } from "../types";
import { AuthPage } from "../views/AuthPage";
import { AppShell } from "./AppShell";
import { BrandIcon } from "./BrandIcon";
import { ButtonSpinner } from "./ButtonSpinner";
import { ReminderBell } from "./ReminderBell";
import { TransactionForm } from "./TransactionForm";
import { OnboardingGuide, type OnboardingStepId } from "./OnboardingGuide";

const UNDO_NOTICE_MS = 8_000;

interface TransactionNotice {
  id: string;
  action: "created" | "deleted";
  label: string;
  expiresAt: number;
}

export function LedgerAppLayout({ children }: { children: ReactNode }) {
  const { user, isDemo, loading: authLoading, signOut } = useAuth();
  const ledger = useLedger();
  const pathname = usePathname();
  const router = useRouter();
  const view = viewFromPathname(pathname);
  const [month, setMonth] = useState(new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LedgerTransaction | null>(null);
  const [reusing, setReusing] = useState<LedgerTransaction | null>(null);
  const [newTransactionDate, setNewTransactionDate] = useState<string | undefined>();
  const [newTransactionLocation, setNewTransactionLocation] = useState<TransactionLocationDraft | null>(null);
  const [homeSelectedDate, setHomeSelectedDate] = useState(toDateInput);
  const [homeFocus, setHomeFocus] = useState<{ date: string; revision: number } | null>(null);
  const [recentlyAddedTransactionId, setRecentlyAddedTransactionId] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [amountsHidden, setAmountsHidden] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [transactionNotice, setTransactionNotice] = useState<TransactionNotice | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const reportNotice = user && !isDemo ? monthlyReportNotice() : null;

  useEffect(() => { setAmountsHidden(ledger.profile.hideAmounts); }, [ledger.profile.hideAmounts]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [pathname]);
  useEffect(() => { document.body.dataset.hideAmounts = String(amountsHidden); }, [amountsHidden]);
  useEffect(() => {
    if (!recentlyAddedTransactionId) return;
    const timeout = window.setTimeout(() => setRecentlyAddedTransactionId(null), 900);
    return () => window.clearTimeout(timeout);
  }, [recentlyAddedTransactionId]);
  useEffect(() => {
    if (!transactionNotice) return;
    const timeout = window.setTimeout(() => setTransactionNotice(null), Math.max(0, transactionNotice.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [transactionNotice]);
  useEffect(() => {
    if (!ledger.profile.hasPin || !ledger.profile.autoLockMinutes || locked || (!user && !isDemo)) return;
    let timer = window.setTimeout(() => setLocked(true), ledger.profile.autoLockMinutes * 60_000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setLocked(true), ledger.profile.autoLockMinutes * 60_000);
    };
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [ledger.profile.autoLockMinutes, ledger.profile.hasPin, locked, user, isDemo]);

  const navigate = (nextView: AppView) => router.push(appRoutes[nextView]);
  const runOnboardingAction = (step: OnboardingStepId) => {
    if (step === "pin") router.push(`${appRoutes.settings}#security-heading`);
    else if (step === "account") router.push(`${appRoutes.accounts}#add-account`);
    else if (step === "budget") router.push(`${appRoutes.plan}#add-budget`);
    else openAdd();
  };
  const openDue = (id?: string, action?: "repay") => {
    const params = new URLSearchParams();
    if (id) params.set("due", id);
    if (action) params.set("action", action);
    router.push(`${appRoutes.dues}${params.size ? `?${params.toString()}` : ""}`);
  };
  const openAdd = () => {
    setEditing(null);
    setReusing(null);
    setNewTransactionDate(view === "home" ? homeSelectedDate : undefined);
    setNewTransactionLocation(null);
    setFormOpen(true);
  };
  const openAddAtPlace = (place: SavedPlace) => {
    setEditing(null);
    setReusing(null);
    setNewTransactionDate(undefined);
    setNewTransactionLocation({ label: place.name, address: place.address, latitude: place.latitude, longitude: place.longitude, accuracy: null, source: "saved", savedPlaceId: place.id });
    setFormOpen(true);
  };
  const openAddForDate = (occurredOn: string) => {
    setEditing(null);
    setReusing(null);
    setNewTransactionDate(occurredOn);
    setNewTransactionLocation(null);
    setFormOpen(true);
  };
  const openDuplicate = (transaction: LedgerTransaction) => {
    setEditing(null);
    setReusing(transaction);
    setNewTransactionDate(toDateInput());
    setNewTransactionLocation(null);
    setFormOpen(true);
  };
  const openEdit = (transaction: LedgerTransaction) => {
    setEditing(transaction);
    setReusing(null);
    setNewTransactionDate(undefined);
    setNewTransactionLocation(null);
    setFormOpen(true);
  };
  const saveTransaction = async (draft: TransactionDraft, id?: string) => {
    const savedId = await ledger.saveTransaction(draft, id);
    if (!id && savedId) {
      setRecentlyAddedTransactionId(savedId);
      setUndoError(null);
      setTransactionNotice({ id: savedId, action: "created", label: draft.note.trim() || (draft.kind === "income" ? "Income" : "Expense"), expiresAt: Date.now() + UNDO_NOTICE_MS });
    }
    if (!id && view === "home") {
      setMonth(parseISO(draft.occurredOn));
      setHomeFocus((current) => ({ date: draft.occurredOn, revision: (current?.revision ?? 0) + 1 }));
    }
  };
  const removeTransaction = async (transaction: LedgerTransaction) => {
    const label = transaction.note || (transaction.kind === "income" ? "Income" : "Expense");
    if (window.confirm(`Delete “${label}”? You can undo this for a few seconds.`)) {
      await ledger.deleteTransaction(transaction.id);
      setUndoError(null);
      setTransactionNotice({ id: transaction.id, action: "deleted", label, expiresAt: Date.now() + UNDO_NOTICE_MS });
    }
  };
  const undoTransaction = async () => {
    if (!transactionNotice || undoPending) return;
    setUndoPending(true);
    setUndoError(null);
    try {
      if (transactionNotice.action === "created") await ledger.deleteTransaction(transactionNotice.id);
      else await ledger.restoreTransaction(transactionNotice.id);
      setTransactionNotice(null);
    } catch (caught) {
      setUndoError(caught instanceof Error ? caught.message : "Could not undo that change.");
      setTransactionNotice((current) => current ? { ...current, expiresAt: Date.now() + UNDO_NOTICE_MS } : null);
    } finally {
      setUndoPending(false);
    }
  };
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

  const workspace = {
    ledger,
    month,
    setMonth,
    homeFocus,
    recentlyAddedTransactionId,
    setHomeSelectedDate,
    openAdd,
    openAddAtPlace,
    openAddForDate,
    openDuplicate,
    openEdit,
    removeTransaction,
    navigate,
    lock: () => { if (ledger.profile.hasPin) setLocked(true); },
  };

  if (authLoading) return <AppLoader className="boot-screen" message="Opening your ledger" />;
  if (!user && !isDemo) return <AuthPage />;

  let content = children;
  if (ledger.loading) content = <AppLoader className="page-loading" message="Loading your entries" />;
  else if (ledger.error) content = <div className="page-error"><strong>We couldn’t load your ledger.</strong><p>{ledger.error}</p></div>;

  return (
    <LedgerWorkspaceContext.Provider value={workspace}>
      <AppShell view={view} onAdd={openAdd} onSignOut={() => void logOut()} signingOut={signingOut}>
        {!isDemo && user && !ledger.loading && !ledger.error && (
          <OnboardingGuide
            userId={user.id}
            hasPin={ledger.profile.hasPin}
            hasAccount={ledger.paymentAccounts.length > 0}
            hasTransaction={ledger.transactions.length > 0}
            hasBudget={ledger.budgets.length > 0}
            onAction={runOnboardingAction}
          />
        )}
        <div key={pathname} className="route-transition">{content}</div>
      </AppShell>
      <ReminderBell
        items={ledger.dueItems}
        currency={ledger.profile.currency}
        monthlyReport={reportNotice}
        onOpenDue={openDue}
        onComplete={ledger.completeDueItem}
        onSnooze={ledger.snoozeDueItem}
      />
      <button className="privacy-toggle" onClick={() => setAmountsHidden((hidden) => !hidden)} aria-label={amountsHidden ? "Reveal amounts" : "Hide amounts"}>
        {amountsHidden ? <Eye size={19} /> : <EyeSlash size={19} />}
      </button>
      <TransactionForm
        open={formOpen}
        currency={ledger.profile.currency}
        transaction={editing}
        template={reusing}
        initialOccurredOn={newTransactionDate}
        initialLocation={newTransactionLocation}
        transactions={ledger.transactions}
        customCategories={ledger.customCategories}
        paymentAccounts={ledger.paymentAccounts}
        savedPlaces={ledger.savedPlaces}
        onClose={() => setFormOpen(false)}
        onSave={saveTransaction}
      />
      {transactionNotice && (
        <aside className={`transaction-undo-notice ${undoError ? "has-error" : ""}`} role="status" aria-live="polite">
          <span className="transaction-undo-icon" aria-hidden="true">
            {transactionNotice.action === "created" ? <CheckCircle size={22} weight="fill" /> : <Trash size={21} />}
          </span>
          <span className="transaction-undo-copy">
            <strong>{transactionNotice.action === "created" ? "Transaction added" : "Transaction deleted"}</strong>
            <small>{undoError ?? `“${transactionNotice.label}” ${transactionNotice.action === "created" ? "is now in your ledger." : "was removed."}`}</small>
          </span>
          <button type="button" className="transaction-undo-action" disabled={undoPending} onClick={() => void undoTransaction()}>
            {undoPending ? <ButtonSpinner /> : <ArrowCounterClockwise size={17} />}
            Undo
          </button>
          <button type="button" className="transaction-undo-close" disabled={undoPending} onClick={() => setTransactionNotice(null)} aria-label="Dismiss Undo message"><X size={16} /></button>
          <i key={transactionNotice.expiresAt} className="transaction-undo-progress" aria-hidden="true" />
        </aside>
      )}
      {locked && ledger.profile.hasPin && (
        <PrivacyLock onUnlock={async (pin) => {
          await ledger.verifyPin(pin);
          setLocked(false);
        }} />
      )}
    </LedgerWorkspaceContext.Provider>
  );
}

function AppLoader({ className, message }: { className: "boot-screen" | "page-loading"; message: string }) {
  return <div className={className} role="status" aria-live="polite">
    <div className="app-loader-card">
      <div className="loader-brand">
        <BrandIcon size={42} />
        <span><strong>SaveYoRupee</strong><small>Your money, clearly.</small></span>
      </div>
      <div className="loader-bill-stage" aria-hidden="true">
        <span className="loader-bill-shadow" />
        <div className="loader-bill">
          <svg className="loader-bill-art" viewBox="0 0 240 132" focusable="false">
            <rect x="7" y="12" width="226" height="108" rx="8" fill="#78a583" stroke="#3f6653" strokeWidth="3" />
            <rect x="15" y="20" width="210" height="92" rx="5" fill="none" stroke="#d8eedb" strokeWidth="1.5" opacity=".8" />
            <path d="M19 35c31-13 59-14 101-14s70 1 101 14v15c-31-8-63-10-101-10S50 42 19 50V35Z" fill="#b9d9bd" opacity=".28" />
            <path d="M19 97c31 8 63 10 101 10s70-2 101-10v15c-31 13-59 14-101 14s-70-1-101-14V97Z" fill="#315a46" opacity=".2" />
            <circle cx="120" cy="66" r="30" fill="#5f8d6c" stroke="#d8eedb" strokeWidth="1.5" />
            <circle cx="120" cy="66" r="24" fill="none" stroke="#d8eedb" strokeWidth="1" opacity=".7" />
            <path d="M120 45v42M108 54c2-5 20-6 23 1 3 8-22 7-23 16-1 8 20 10 25 1" fill="none" stroke="#f2f7e9" strokeLinecap="round" strokeWidth="3" />
            <text x="28" y="45" fill="#f2f7e9" fontSize="18" fontWeight="800">$</text>
            <text x="212" y="101" fill="#f2f7e9" fontSize="18" fontWeight="800" textAnchor="end">$</text>
            <text x="120" y="36" fill="#eff8e9" fontSize="8" fontWeight="800" letterSpacing="2" textAnchor="middle">ONE DOLLAR</text>
            <text x="120" y="103" fill="#eff8e9" fontSize="7" fontWeight="700" letterSpacing="1.5" textAnchor="middle">SAVEYO RUPEE</text>
            <path d="M30 73h32M178 73h32" fill="none" stroke="#d8eedb" strokeLinecap="round" strokeWidth="1.5" opacity=".72" />
          </svg>
        </div>
      </div>
      <div className="loader-status"><i aria-hidden="true" /><span>{message}</span></div>
    </div>
  </div>;
}

function PrivacyLock({ onUnlock }: { onUnlock: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      setError(null);
      await onUnlock(pin);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not unlock.");
      setPin("");
    } finally {
      setBusy(false);
    }
  };
  return <div className="privacy-lock"><div className="lock-card"><span className="lock-icon"><LockKey size={28} weight="duotone" /></span><div className="brand-mark"><BrandIcon size={32} /><span>SaveYoRupee</span></div><h2>Your ledger is locked</h2><p>Enter your ledger PIN to continue.</p><form onSubmit={submit} aria-busy={busy}><PasswordInput value={pin} disabled={busy} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="4–6 digit PIN" inputMode="numeric" autoComplete="current-password" autoFocus minLength={4} maxLength={6} required />{error && <div className="form-error" role="alert">{error}</div>}<button className="primary-button full-width" disabled={busy || pin.length < 4}>{busy ? <><ButtonSpinner />Checking…</> : "Unlock ledger"}</button></form></div></div>;
}
