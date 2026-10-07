"use client";

import { PasswordInput } from "@mantine/core";
import { Eye, EyeSlash, LockKey, MagnifyingGlass } from "@phosphor-icons/react";
import { parseISO } from "date-fns";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { useLedger } from "../context/LedgerContext";
import { LedgerWorkspaceContext } from "../context/LedgerWorkspaceContext";
import { useToasts } from "../context/ToastContext";
import { getCategory } from "../lib/categories";
import { toDateInput, todayInput } from "../lib/dates";
import { buildReminderDigest } from "../lib/reminder-digest";
import { monthlyReportNotice } from "../lib/monthly-report";
import { recurrenceLabel } from "../lib/recurrence";
import { markOnboardingStep } from "../lib/onboarding";
import { appRoutes, viewFromPathname } from "../lib/routes";
import type { AppView, LedgerTransaction, SavedPlace, TransactionDraft, TransactionLocationDraft } from "../types";
import { AuthPage } from "../views/AuthPage";
import { AppShell } from "./AppShell";
import { BrandIcon } from "./BrandIcon";
import { ButtonSpinner } from "./ButtonSpinner";
import { LedgerSearch } from "./LedgerSearch";
import { ReminderBell } from "./ReminderBell";
import { TransactionForm } from "./TransactionForm";
import { OnboardingGuide } from "./OnboardingGuide";
import type { OnboardingStepId } from "../lib/onboarding";
import { FormError } from "./FormError";
import { FloatingActions } from "./FloatingActions";
import { SmsCapture } from "./SmsCapture";
import { ReceiptScanner } from "./ReceiptScanner";
import { SplitBillSheet } from "./SplitBillSheet";
import { TransferSheet } from "./TransferSheet";
import { onlinePaymentAccounts } from "../lib/payment-accounts";

/** What a caller asked the move-money sheet to prefill. */
export interface TransferRequest { fromAccountId?: string; toAccountId?: string; amount?: string; occurredOn?: string; note?: string; /** Opens that transfer for editing; the other fields are ignored. */ transferId?: string }
/** What a caller asked the split-a-bill sheet to prefill. */
export interface SplitBillRequest { amount?: string; people?: string[]; note?: string }

function RoutePanel({ pathname, children }: { pathname: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const previousPath = useRef(pathname);
  useLayoutEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    setOpen(false);
    const frame = window.requestAnimationFrame(() => setOpen(true));
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);
  return <div className="route-transition t-panel-slide" data-open={open ? "true" : "false"}>{children}</div>;
}

export function LedgerAppLayout({ children }: { children: ReactNode }) {
  const { user, isDemo, loading: authLoading, signOut } = useAuth();
  const ledger = useLedger();
  const { push: pushToast } = useToasts();
  const pathname = usePathname();
  const router = useRouter();
  const view = viewFromPathname(pathname);
  const [month, setMonth] = useState(new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LedgerTransaction | null>(null);
  const [reusing, setReusing] = useState<LedgerTransaction | null>(null);
  const [newTransactionDate, setNewTransactionDate] = useState<string | undefined>();
  const [newTransactionLocation, setNewTransactionLocation] = useState<TransactionLocationDraft | null>(null);
  const [, setHomeSelectedDate] = useState(toDateInput);
  const [homeFocus, setHomeFocus] = useState<{ date: string; revision: number } | null>(null);
  const [recentlyAddedTransactionId, setRecentlyAddedTransactionId] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [amountsHidden, setAmountsHidden] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsInitialText, setSmsInitialText] = useState<string | undefined>();
  const [receiptScanOpen, setReceiptScanOpen] = useState(false);
  // Mounted by the transfer and split-bill sheets; null means closed.
  const [transferRequest, setTransferRequest] = useState<TransferRequest | null>(null);
  const [splitBillRequest, setSplitBillRequest] = useState<SplitBillRequest | null>(null);
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
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!user || isDemo || ledger.loading || ledger.error || !ledger.profile.browserReminders) return;
    if (typeof Notification === "undefined") return;
    const key = `syr-reminder-${user.id}-${todayInput()}`;
    if (window.localStorage.getItem(key)) return;
    const notices = buildReminderDigest({
      dues: ledger.dueItems,
      recurring: ledger.recurringEntries,
      today: todayInput(),
      categoryLabel: (category) => getCategory(category, ledger.customCategories).label,
    });
    if (!notices.length) return;
    const notify = () => {
      const body = notices.slice(0, 3).map((notice) => `${notice.title}: ${notice.body}`).join("\n");
      new Notification("SaveYoRupee reminders", { body });
      window.localStorage.setItem(key, "1");
    };
    if (Notification.permission === "granted") notify();
    else if (Notification.permission === "default" && !window.localStorage.getItem(`${key}:asked`)) {
      window.localStorage.setItem(`${key}:asked`, "1");
      void Notification.requestPermission().then((result) => { if (result === "granted") notify(); });
    }
  }, [isDemo, ledger.customCategories, ledger.dueItems, ledger.error, ledger.loading, ledger.profile.browserReminders, ledger.recurringEntries, user]);
  useEffect(() => {
    if (!user || isDemo || ledger.loading || ledger.error || !ledger.profile.emailReminders) return;
    const key = `syr-email-reminder-${user.id}-${todayInput()}`;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
    void fetch("/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sendDueReminders" }),
    }).then((response) => { if (!response.ok) window.sessionStorage.removeItem(key); }).catch(() => window.sessionStorage.removeItem(key));
  }, [isDemo, ledger.error, ledger.loading, ledger.profile.emailReminders, user]);
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
  const completeOnboardingStep = (step: OnboardingStepId) => {
    if (user && !isDemo) markOnboardingStep(user.id, step);
  };
  const runOnboardingAction = (step: OnboardingStepId) => {
    if (step === "pin") router.push(`${appRoutes.settings}#security-heading`);
    else if (step === "account") router.push(`${appRoutes.accounts}#add-account`);
    else if (step === "import") router.push(`${appRoutes.transactions}#import-csv`);
    else if (step === "customize") router.push(`${appRoutes.settings}#customizations-heading`);
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
    // The global + always means "now": the sheet dates it today when it opens. Per-day buttons use openAddForDate.
    setNewTransactionDate(undefined);
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
    setNewTransactionDate(todayInput());
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
      completeOnboardingStep("transaction");
      setRecentlyAddedTransactionId(savedId);
    }
    if (!id && view === "home") {
      setMonth(parseISO(draft.occurredOn));
      setHomeFocus((current) => ({ date: draft.occurredOn, revision: (current?.revision ?? 0) + 1 }));
    }
  };
  // No confirm: the "Deleted …" toast names the entry and its amount, and carries Undo.
  const removeTransaction = async (transaction: LedgerTransaction) => {
    try {
      await ledger.deleteTransaction(transaction.id);
    } catch (error) {
      // With no confirm step, a failed delete must still say so instead of failing silently.
      pushToast({ title: `Couldn’t delete “${transaction.note || getCategory(transaction.category, ledger.customCategories).label}”`, body: error instanceof Error ? error.message : "Check your connection and try again.", tone: "danger" });
    }
  };
  const logOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "Could not sign out.");
    } finally {
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
    completeOnboardingStep,
    lock: () => { if (ledger.profile.hasPin) setLocked(true); },
    openSms: (initialText?: string) => { setSmsInitialText(initialText); setSmsOpen(true); },
    openReceiptScan: () => setReceiptScanOpen(true),
    openTransfer: (options: TransferRequest = {}) => setTransferRequest(options),
    openSplitBill: (options: SplitBillRequest = {}) => setSplitBillRequest(options),
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
            hasCustomizations={ledger.customCategories.length > 0 || ledger.customSubcategories.length > 0}
            onAction={runOnboardingAction}
          />
        )}
        <RoutePanel pathname={pathname}>{content}</RoutePanel>
      </AppShell>
      <FloatingActions closeSignal={`${pathname}:${searchOpen}`}>
        <button className="ledger-search" onClick={() => setSearchOpen(true)} aria-label="Search the ledger" title="Search (Ctrl+K)"><MagnifyingGlass size={18} /></button>
        <ReminderBell
          items={ledger.dueItems}
          currency={ledger.profile.currency}
          recurringEntries={ledger.recurringEntries.filter((entry) => entry.active).map((entry) => ({ id: entry.id, kind: entry.kind, title: entry.note || getCategory(entry.category, ledger.customCategories).label, amountMinor: entry.amountMinor, dueOn: entry.nextDueOn, scheduleLabel: recurrenceLabel(entry) }))}
          monthlyReport={reportNotice}
          onOpenDue={openDue}
          onComplete={ledger.completeDueItem}
          onSnooze={ledger.snoozeDueItem}
          onConfirmRecurring={ledger.confirmRecurring}
        />
        <button className="privacy-toggle" onClick={() => setAmountsHidden((hidden) => !hidden)} aria-label={amountsHidden ? "Reveal amounts" : "Hide amounts"} aria-pressed={amountsHidden}>
          <span className="t-icon-swap" data-state={amountsHidden ? "a" : "b"} aria-hidden="true">
            <span className="t-icon" data-icon="a"><Eye size={19} /></span>
            <span className="t-icon" data-icon="b"><EyeSlash size={19} /></span>
          </span>
        </button>
      </FloatingActions>
      <LedgerSearch
        open={searchOpen}
        currency={ledger.profile.currency}
        transactions={ledger.transactions}
        transfers={ledger.transfers}
        dues={ledger.dueItems}
        places={ledger.savedPlaces}
        accounts={ledger.paymentAccounts}
        customCategories={ledger.customCategories}
        onClose={() => setSearchOpen(false)}
        onOpenTransaction={(transaction) => {
          if (ledger.profile.id && transaction.userId !== ledger.profile.id) return false;
          openEdit(transaction);
          return true;
        }}
      />
      <TransactionForm
        open={formOpen}
        currency={ledger.profile.currency}
        transaction={editing}
        template={reusing}
        initialOccurredOn={newTransactionDate}
        initialLocation={newTransactionLocation}
        transactions={ledger.transactions}
        customCategories={ledger.customCategories}
        customSubcategories={ledger.customSubcategories}
        paymentAccounts={onlinePaymentAccounts(ledger.paymentAccounts)}
        savedPlaces={ledger.savedPlaces}
        learning={ledger.profile.learning}
        shareWithHousehold={ledger.profile.household?.status === "active"}
        calendarSystem={ledger.profile.calendarSystem}
        ownerId={ledger.profile.id}
        onClose={() => setFormOpen(false)}
        onSave={saveTransaction}
        onPasteSms={() => workspace.openSms()}
        onScanReceipt={() => workspace.openReceiptScan()}
        onTransfer={(prefill) => workspace.openTransfer(prefill)}
        onSplitBill={(prefill) => workspace.openSplitBill(prefill)}
      />
      <SmsCapture
        open={smsOpen}
        onOpenChange={(open) => { setSmsOpen(open); if (!open) setSmsInitialText(undefined); }}
        initialText={smsInitialText}
        showTrigger={false}
        currency={ledger.profile.currency}
        transactions={ledger.transactions}
        customCategories={ledger.customCategories}
        customSubcategories={ledger.customSubcategories}
        paymentAccounts={ledger.paymentAccounts}
        learning={ledger.profile.learning}
        calendarSystem={ledger.profile.calendarSystem}
        ownerId={ledger.profile.id}
        onSave={async (draft) => { const savedId = await ledger.saveTransaction(draft); completeOnboardingStep("transaction"); return savedId; }}
        onSaveTransfer={(draft) => ledger.saveTransfer(draft)}
      />
      <ReceiptScanner
        open={receiptScanOpen}
        onOpenChange={setReceiptScanOpen}
        showTrigger={false}
        currency={ledger.profile.currency}
        fallbackOccurredOn={todayInput()}
        customCategories={ledger.customCategories}
        customSubcategories={ledger.customSubcategories}
        paymentAccounts={onlinePaymentAccounts(ledger.paymentAccounts)}
        onSave={async (drafts, receipt, totalMinor) => { const count = await ledger.saveReceiptSplit(drafts, receipt, totalMinor); completeOnboardingStep("transaction"); return count; }}
      />
      {/* TransferSheet (driven by transferRequest) and SplitBillSheet (driven by splitBillRequest) mount here. */}
      <TransferSheet
        request={transferRequest}
        currency={ledger.profile.currency}
        calendarSystem={ledger.profile.calendarSystem}
        accounts={ledger.paymentAccounts.filter((account) => !ledger.profile.id || account.userId === ledger.profile.id)}
        transfers={ledger.transfers}
        onClose={() => setTransferRequest(null)}
        onSave={ledger.saveTransfer}
      />
      <SplitBillSheet
        request={splitBillRequest}
        currency={ledger.profile.currency}
        calendarSystem={ledger.profile.calendarSystem}
        customCategories={ledger.customCategories}
        paymentAccounts={ledger.paymentAccounts.filter((account) => !ledger.profile.id || account.userId === ledger.profile.id)}
        dueItems={ledger.dueItems}
        onClose={() => setSplitBillRequest(null)}
        onSave={ledger.saveSplitBill}
      />
      {locked && ledger.profile.hasPin && (
        <PrivacyLock onUnlock={async (pin) => {
          await ledger.verifyPin(pin);
          setLocked(false);
        }} />
      )}
    </LedgerWorkspaceContext.Provider>
  );
}

const NOTE_STRIPS = 24;
const NOTE_STRIP_WIDTH = 240 / NOTE_STRIPS;
const NOTE_HEIGHT = 102;

function AppLoader({ className, message }: { className: "boot-screen" | "page-loading"; message: string }) {
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `${name}-${uid}`;
  return <div className={className} role="status" aria-live="polite">
    <div className="app-loader-card">
      <div className="loader-brand">
        <BrandIcon size={42} />
        <span><strong>SaveYoRupee</strong><small>Your money, clearly.</small></span>
      </div>
      <div className="loader-bill-stage" aria-hidden="true">
        <span className="loader-bill-shadow" />
        <div className="loader-bill">
          <svg className="loader-bill-art" viewBox={`0 0 240 ${NOTE_HEIGHT}`} focusable="false">
            <defs>
              <linearGradient id={id("paper")} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#dfebc7" />
                <stop offset=".45" stopColor="#bad0a2" />
                <stop offset="1" stopColor="#94b17f" />
              </linearGradient>
              <clipPath id={id("shape")}>
                <rect x="4" y="4" width="232" height="94" rx="3" />
              </clipPath>
              <clipPath id={id("oval")}>
                <ellipse cx="120" cy="54" rx="24" ry="24" />
              </clipPath>
              {Array.from({ length: NOTE_STRIPS }, (_, i) => (
                <clipPath key={i} id={id(`strip${i}`)}>
                  <rect x={i * NOTE_STRIP_WIDTH - 0.06} y="-14" width={NOTE_STRIP_WIDTH + 0.12} height="130" />
                </clipPath>
              ))}
              <g id={id("note")}>
                <rect x="4" y="4" width="232" height="94" rx="3" fill={`url(#${id("paper")})`} stroke="#3f6b4d99" strokeWidth=".9" />
                <g clipPath={`url(#${id("shape")})`}>
                  {/* engraved guilloche wash */}
                  <g fill="none" stroke="#3f6b4d" strokeWidth=".45" opacity=".17">
                    <path d="M4 22c40-14 80 14 120 0s80-14 116 0" />
                    <path d="M4 44c40-14 80 14 120 0s80-14 116 0" />
                    <path d="M4 66c40-14 80 14 120 0s80-14 116 0" />
                    <path d="M4 86c40-14 80 14 120 0s80-14 116 0" />
                  </g>
                  {/* lathework rosettes behind the seals */}
                  <g fill="none" stroke="#3f6b4d" strokeWidth=".4" opacity=".22">
                    <circle cx="54" cy="54" r="18" /><circle cx="54" cy="54" r="14" /><circle cx="54" cy="54" r="10" />
                    <circle cx="186" cy="54" r="18" /><circle cx="186" cy="54" r="14" /><circle cx="186" cy="54" r="10" />
                  </g>
                  {/* portrait vignette */}
                  <ellipse cx="120" cy="54" rx="24" ry="24" fill="#dbe8c9" stroke="#2b4a35" strokeWidth=".8" />
                  <ellipse cx="120" cy="54" rx="21" ry="21" fill="none" stroke="#2b4a35" strokeWidth=".4" opacity=".5" />
                  <g clipPath={`url(#${id("oval")})`} fill="#2b4a35">
                    {/* engraved bust, three-quarter facing left */}
                    <path d="M97 78c2-11.5 9.5-16 23-16s21 4.5 23 16Z" />
                    <rect x="115.2" y="53" width="9.6" height="10" />
                    <ellipse cx="121" cy="46" rx="8.2" ry="9.4" />
                    <path d="M113.2 43.6c-1.8.7-2.9 2-2.6 3.1.3 1.1 1.6 1.5 2.9 1.2Z" />
                    <path d="M112.7 39.6c1.3-4.7 5.1-7.1 9.1-7.1 4.6 0 7.8 2.6 8.6 6.7.4 2-.2 3.4-.9 3.4-1.4-3.6-4-5.4-8-5.4-3.4 0-6 1.2-7.6 3.6-.7.9-1.5.4-1.2-1.2Z" />
                    <circle cx="130.2" cy="51.4" r="2.7" />
                    <path d="M113.6 63c3.6 3.2 10.8 3.2 14.4 0" fill="none" stroke="#dbe8c9" strokeWidth=".9" />
                  </g>
                  {/* federal reserve seal */}
                  <g fill="none" stroke="#2f4a3a" opacity=".8">
                    <circle cx="54" cy="54" r="12.5" strokeWidth=".9" />
                    <circle cx="54" cy="54" r="10" strokeWidth=".45" strokeDasharray="1.5 1.4" />
                  </g>
                  <text x="54" y="58" fill="#2f4a3a" fontSize="10" fontWeight="800" textAnchor="middle" opacity=".8">F</text>
                  {/* treasury seal — balance scales */}
                  <g fill="none" stroke="#3f7a52" opacity=".9">
                    <circle cx="186" cy="54" r="12.5" strokeWidth=".9" />
                    <circle cx="186" cy="54" r="10" strokeWidth=".45" strokeDasharray="1.5 1.4" />
                    <path d="M186 47v11" strokeWidth=".8" strokeLinecap="round" />
                    <path d="M180.4 49.5h11.2" strokeWidth=".8" strokeLinecap="round" />
                    <path d="M178.2 49.5a2.2 2.2 0 0 0 4.4 0M189.4 49.5a2.2 2.2 0 0 0 4.4 0" strokeWidth=".65" />
                    <path d="M181.5 58.6h9" strokeWidth=".8" strokeLinecap="round" />
                  </g>
                  {/* corner scrollwork */}
                  <g fill="none" stroke="#33573f" strokeWidth=".5" opacity=".4">
                    <path d="M12 12h14M12 12v10M228 12h-14M228 12v10M12 90h14M12 90v-10M228 90h-14M228 90v-10" />
                  </g>
                </g>
                <rect x="9" y="9" width="222" height="84" rx="1.5" fill="none" stroke="#33573f" strokeWidth=".7" opacity=".65" />
                <rect x="11.5" y="11.5" width="217" height="79" rx="1" fill="none" stroke="#33573f" strokeWidth=".4" strokeDasharray="2 1.6" opacity=".45" />
                <text x="120" y="19" fill="#245239" fontSize="4.6" fontWeight="700" letterSpacing="1.1" textAnchor="middle">FEDERAL RESERVE NOTE</text>
                <text x="120" y="28" fill="#1e3d2b" fontSize="6.6" fontWeight="800" letterSpacing=".7" textAnchor="middle">THE UNITED STATES OF AMERICA</text>
                <text x="20" y="30" fill="#1e3d2b" fontSize="12" fontWeight="800">1</text>
                <text x="220" y="30" fill="#1e3d2b" fontSize="12" fontWeight="800" textAnchor="end">1</text>
                <text x="20" y="88" fill="#1e3d2b" fontSize="12" fontWeight="800">1</text>
                <text x="220" y="88" fill="#1e3d2b" fontSize="12" fontWeight="800" textAnchor="end">1</text>
                <text x="214" y="40" fill="#3f7a52" fontSize="4.6" fontWeight="700" letterSpacing=".7" textAnchor="end">F 74210099 B</text>
                <text x="26" y="80" fill="#3f7a52" fontSize="4.2" fontWeight="700" letterSpacing="1">SAVEYO RUPEE</text>
                <text x="214" y="80" fill="#3f7a52" fontSize="4.2" fontWeight="700" letterSpacing="1" textAnchor="end">SERIES 2026</text>
                <text x="120" y="82" fill="#245239" fontSize="4" fontWeight="700" letterSpacing=".9" textAnchor="middle">IN GOD WE TRUST</text>
                <text x="120" y="90" fill="#1e3d2b" fontSize="8" fontWeight="800" letterSpacing="1.5" textAnchor="middle">ONE DOLLAR</text>
              </g>
            </defs>
            {Array.from({ length: NOTE_STRIPS }, (_, i) => (
              <g
                key={i}
                className="loader-note-strip"
                style={{
                  "--i": i,
                  // the left edge is the "pole": barely moves, while the free edge flaps hardest
                  "--a": (0.16 + 0.84 * (i / (NOTE_STRIPS - 1)) ** 1.35).toFixed(3),
                  transformOrigin: `${(i + 0.5) * NOTE_STRIP_WIDTH}px ${NOTE_HEIGHT / 2}px`,
                } as React.CSSProperties}
              >
                <g clipPath={`url(#${id(`strip${i}`)})`}>
                  <use href={`#${id("note")}`} />
                  <rect className="loader-note-shade" x="0" y="0" width="240" height={NOTE_HEIGHT} clipPath={`url(#${id("shape")})`} />
                  <rect className="loader-note-glow" x="0" y="0" width="240" height={NOTE_HEIGHT} clipPath={`url(#${id("shape")})`} />
                </g>
              </g>
            ))}
          </svg>
        </div>
      </div>
      <div className="loader-status"><i aria-hidden="true" /><span className="t-shimmer" data-text={message}>{message}</span></div>
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
  return <div className="privacy-lock"><div className="lock-card"><span className="lock-icon"><LockKey size={28} weight="duotone" /></span><div className="brand-mark"><BrandIcon size={32} /><span>SaveYoRupee</span></div><h2>Your ledger is locked</h2><p>Enter your ledger PIN to continue.</p><form onSubmit={submit} aria-busy={busy}><PasswordInput value={pin} disabled={busy} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="4–6 digit PIN" inputMode="numeric" autoComplete="current-password" autoFocus minLength={4} maxLength={6} required /><FormError message={error} /><button className="primary-button full-width" disabled={busy || pin.length < 4}>{busy ? <><ButtonSpinner />Checking…</> : "Unlock ledger"}</button></form></div></div>;
}
