"use client";

import { PasswordInput } from "@mantine/core";
import { ArrowClockwise, Eye, EyeSlash, LockKey, MagnifyingGlass, WifiSlash } from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { useLedger } from "../context/LedgerContext";
import { LedgerWorkspaceContext } from "../context/LedgerWorkspaceContext";
import { useToasts } from "../context/ToastContext";
import { getCategory } from "../lib/categories";
import { toDateInput, todayInput } from "../lib/dates";
import { convertMonthKey, currentMonthKey, monthKeyOf, parseMonthKey, type PeriodKey } from "../lib/period";
import { buildReminderDigest } from "../lib/reminder-digest";
import { BRAND_MARK_PATH } from "../lib/brand-mark";
import { deliverNotification, readAddDeepLink, reminderNotificationText, reminderToastText, rolledOverMonth } from "../lib/app-shell";
import { monthlyReportNotice } from "../lib/monthly-report";
import { urgentReminderCount } from "../lib/reminder-badge";
import { useToday } from "../lib/use-today";
import { BalanceUnlockDialog } from "./BalancePrivacy";
import { recurrenceLabel } from "../lib/recurrence";
import { markOnboardingStep } from "../lib/onboarding";
import { appRoutes, viewFromPathname } from "../lib/routes";
import type { AppView, LedgerTransaction, SavedPlace, TransactionDraft, TransactionKind, TransactionLocationDraft } from "../types";
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
  const { user, isDemo, loading: authLoading, sessionError, refreshSession, signOut } = useAuth();
  const ledger = useLedger();
  const { push: pushToast } = useToasts();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const view = viewFromPathname(pathname);
  const calendarSystem = ledger.profile.calendarSystem;
  // The workspace month, in the user's own calendar: "BS:2083-06" is exactly Ashwin's days.
  const [period, setPeriod] = useState<PeriodKey>(() => currentMonthKey(calendarSystem));
  // Switching calendars keeps roughly the same stretch of time (and today's month stays today's).
  if (parseMonthKey(period).system !== calendarSystem) setPeriod(convertMonthKey(period, calendarSystem));
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LedgerTransaction | null>(null);
  const [reusing, setReusing] = useState<LedgerTransaction | null>(null);
  const [newTransactionDate, setNewTransactionDate] = useState<string | undefined>();
  const [newTransactionLocation, setNewTransactionLocation] = useState<TransactionLocationDraft | null>(null);
  // Set only by an "Add income" / "Add expense" shortcut; cleared when the sheet closes.
  const [newTransactionKind, setNewTransactionKind] = useState<TransactionKind | undefined>();
  const [, setHomeSelectedDate] = useState(toDateInput);
  const [homeFocus, setHomeFocus] = useState<{ date: string; revision: number } | null>(null);
  const [recentlyAddedTransactionId, setRecentlyAddedTransactionId] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  // One balance unlock per session: the signed-in user it was unlocked for, cleared on lock and sign-out (and by a reload).
  const [balancesUnlockedFor, setBalancesUnlockedFor] = useState<string | null>(null);
  const [balanceUnlockOpen, setBalanceUnlockOpen] = useState(false);
  const reminderToday = useToday();
  const [amountsHidden, setAmountsHidden] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsInitialText, setSmsInitialText] = useState<string | undefined>();
  const [receiptScanOpen, setReceiptScanOpen] = useState(false);
  // The day a receipt with no readable date lands on: the opener's day, or today when it was opened.
  const [receiptFallbackDate, setReceiptFallbackDate] = useState(todayInput);
  // Mounted by the transfer and split-bill sheets; null means closed.
  const [transferRequest, setTransferRequest] = useState<TransferRequest | null>(null);
  const [splitBillRequest, setSplitBillRequest] = useState<SplitBillRequest | null>(null);
  const reportNotice = user && !isDemo ? monthlyReportNotice(ledger.transactions, { viewerId: user.id }) : null;
  const urgentReminders = urgentReminderCount(ledger.dueItems, ledger.recurringEntries.filter((entry) => entry.active).map((entry) => ({ dueOn: entry.nextDueOn })), reminderToday);
  const balanceSession = user?.id ?? (isDemo ? "demo" : null);
  // Signing out keeps this layout mounted (it renders AuthPage), so the unlock must not carry over to the next sign-in.
  if (!balanceSession && balancesUnlockedFor !== null) setBalancesUnlockedFor(null);
  const balancesUnlocked = balanceSession !== null && balancesUnlockedFor === balanceSession;
  const balancesVisible = !ledger.profile.hasPin || balancesUnlocked;

  useEffect(() => { setAmountsHidden(ledger.profile.hideAmounts); }, [ledger.profile.hideAmounts]);
  // A new page starts at the top; Back and Forward land where the page was left. The popstate
  // listener runs before the pathname effect, so it records which path history traversed to.
  const poppedPath = useRef<string | null>(null);
  useEffect(() => {
    const onPopState = () => { poppedPath.current = window.location.pathname; };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    const traversed = poppedPath.current === pathname;
    poppedPath.current = null;
    if (!traversed) window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);
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
  // Once a day, the first time the app is open that day (a tab left open overnight counts: it re-runs when the date changes).
  useEffect(() => {
    if (!user || isDemo || ledger.loading || ledger.error || !ledger.profile.browserReminders) return;
    if (typeof Notification === "undefined") return;
    const key = `syr-reminder-${user.id}-${reminderToday}`;
    const storage = (() => { try { return window.localStorage; } catch { return null; } })();
    if (storage?.getItem(key)) return;
    const notices = buildReminderDigest({
      dues: ledger.dueItems,
      recurring: ledger.recurringEntries,
      today: reminderToday,
      currency: ledger.profile.currency,
      categoryLabel: (category) => getCategory(category, ledger.customCategories).label,
    });
    if (!notices.length) return;
    const notify = async () => {
      // Mark the day first: if showing it fails or throws, it must not retry on every render.
      try { storage?.setItem(key, "1"); } catch { /* private mode: at worst it shows again on the next load */ }
      const { title, body } = reminderNotificationText(notices, ledger.profile.hideAmounts);
      const delivered = await deliverNotification({
        getRegistration: "serviceWorker" in navigator ? () => navigator.serviceWorker.getRegistration() : undefined,
        createNotification: (heading, options) => new Notification(heading, options),
      }, title, { body, tag: `syr-reminders-${reminderToday}`, icon: "/icons/icon-192.png", data: { url: "/" } });
      if (delivered === "failed") pushToast({ ...reminderToastText(notices), tone: "neutral" });
    };
    if (Notification.permission === "granted") void notify();
    else if (Notification.permission === "default" && storage && !storage.getItem(`${key}:asked`)) {
      try { storage.setItem(`${key}:asked`, "1"); } catch { return; }
      void Notification.requestPermission().then((result) => { if (result === "granted") void notify(); }).catch(() => undefined);
    }
  }, [isDemo, ledger.customCategories, ledger.dueItems, ledger.error, ledger.loading, ledger.profile.browserReminders, ledger.profile.currency, ledger.profile.hideAmounts, ledger.recurringEntries, pushToast, reminderToday, user]);
  // Fallback for the 07:00 reminder email (/api/cron/reminders): the server sends at most one a day either way.
  useEffect(() => {
    if (!user || isDemo || ledger.loading || ledger.error || !ledger.profile.emailReminders) return;
    const key = `syr-email-reminder-${user.id}-${reminderToday}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch { /* storage blocked: the server's once-a-day guard still applies */ }
    const retryLater = () => { try { window.sessionStorage.removeItem(key); } catch { /* ignore */ } };
    void fetch("/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sendDueReminders" }),
    }).then((response) => { if (!response.ok) retryLater(); }).catch(retryLater);
  }, [isDemo, ledger.error, ledger.loading, ledger.profile.emailReminders, reminderToday, user]);
  // A tab left open past midnight on the last day of a month moves on to the new month,
  // unless another month was picked. The previous day is kept in a ref, so a remount starts fresh.
  const monthRolloverDay = useRef(reminderToday);
  useEffect(() => {
    const previous = monthRolloverDay.current;
    monthRolloverDay.current = reminderToday;
    if (previous === reminderToday) return;
    setPeriod((shown) => rolledOverMonth(shown, previous, reminderToday) ?? shown);
  }, [reminderToday]);
  // Home-screen shortcuts (?add=expense|income|sms) and shared text (?sms=…&title=…), once signed in and loaded.
  const deepLinkQuery = searchParams.toString();
  const handledDeepLink = useRef<string | null>(null);
  useEffect(() => {
    // Once the address is clean again, the same shortcut used later in this session must open its sheet again.
    if (!deepLinkQuery) { handledDeepLink.current = null; return; }
    if ((!user && !isDemo) || ledger.loading || ledger.error || locked || handledDeepLink.current === deepLinkQuery) return;
    const { link, rest } = readAddDeepLink(new URLSearchParams(deepLinkQuery));
    if (!link && rest === deepLinkQuery) return;
    handledDeepLink.current = deepLinkQuery;
    // Clean the address first (a shallow replace Next.js syncs), so the sheet's back-gesture entry and a reload never reopen it.
    window.history.replaceState(null, "", `${pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    if (link?.type === "add") {
      setEditing(null);
      setReusing(null);
      setNewTransactionDate(undefined);
      setNewTransactionLocation(null);
      setNewTransactionKind(link.kind);
      setFormOpen(true);
    } else if (link?.type === "sms") {
      setSmsInitialText(link.text);
      setSmsOpen(true);
    }
  }, [deepLinkQuery, isDemo, ledger.error, ledger.loading, locked, pathname, user]);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const { protocol, hostname } = window.location;
    if (protocol !== "https:" && hostname !== "localhost" && hostname !== "127.0.0.1") return;
    void navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("Could not register the service worker.", error));
  }, []);
  useEffect(() => {
    if (!ledger.profile.hasPin || !ledger.profile.autoLockMinutes || locked || (!user && !isDemo)) return;
    // Locking also hides balances again until the PIN is entered for them.
    const autoLock = () => { setLocked(true); setBalancesUnlockedFor(null); setBalanceUnlockOpen(false); };
    let timer = window.setTimeout(autoLock, ledger.profile.autoLockMinutes * 60_000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(autoLock, ledger.profile.autoLockMinutes * 60_000);
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
      setPeriod(monthKeyOf(draft.occurredOn, calendarSystem));
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
  const unlockBalances = async (pin: string) => {
    await ledger.verifyPin(pin);
    setBalancesUnlockedFor(balanceSession);
  };
  const logOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      setBalancesUnlockedFor(null);
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "Could not sign out.");
    } finally {
      setSigningOut(false);
    }
  };

  const workspace = {
    ledger,
    period,
    setPeriod,
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
    lock: () => { if (ledger.profile.hasPin) { setLocked(true); setBalancesUnlockedFor(null); setBalanceUnlockOpen(false); } },
    openSms: (initialText?: string) => { setSmsInitialText(initialText); setSmsOpen(true); },
    openReceiptScan: (fallbackDate?: string) => { setReceiptFallbackDate(fallbackDate || todayInput()); setReceiptScanOpen(true); },
    openTransfer: (options: TransferRequest = {}) => setTransferRequest(options),
    openSplitBill: (options: SplitBillRequest = {}) => setSplitBillRequest(options),
    balancesVisible,
    balancesUnlocked,
    unlockBalances,
    requestBalanceUnlock: () => { if (ledger.profile.hasPin && !balancesUnlocked) setBalanceUnlockOpen(true); },
  };

  if (authLoading) return <AppLoader className="boot-screen" message="Opening your ledger" />;
  // Only a real 401 means signed out; a weak signal or a struggling server gets a Retry instead of the sign-in page.
  if (!user && !isDemo) return sessionError ? <RetryScreen className="boot-screen" title="Can’t reach SaveYoRupee right now" message="Check your connection. We’ll try again on our own as soon as you’re back online." onRetry={refreshSession} /> : <AuthPage />;

  let content = children;
  if (ledger.loading) content = <AppLoader className="page-loading" message="Loading your entries" />;
  else if (ledger.error) content = <RetryScreen className="page-error" title="We couldn’t load your ledger." message={ledger.error} onRetry={ledger.refresh} />;

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
      <FloatingActions closeSignal={`${pathname}:${searchOpen}`} badgeCount={urgentReminders}>
        <button className="ledger-search" onClick={() => setSearchOpen(true)} aria-label="Search the ledger" title="Search (Ctrl+K)"><MagnifyingGlass size={18} /></button>
        <ReminderBell
          items={ledger.dueItems}
          currency={ledger.profile.currency}
          recurringEntries={ledger.recurringEntries.filter((entry) => entry.active).map((entry) => ({ id: entry.id, kind: entry.kind, title: entry.note || getCategory(entry.category, ledger.customCategories).label, amountMinor: entry.amountMinor, dueOn: entry.nextDueOn, scheduleLabel: recurrenceLabel(entry) }))}
          monthlyReport={reportNotice}
          onOpenDue={openDue}
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
        initialKind={newTransactionKind}
        transactions={ledger.transactions}
        customCategories={ledger.customCategories}
        customSubcategories={ledger.customSubcategories}
        paymentAccounts={onlinePaymentAccounts(ledger.paymentAccounts)}
        savedPlaces={ledger.savedPlaces}
        learning={ledger.profile.learning}
        shareWithHousehold={ledger.profile.household?.status === "active"}
        calendarSystem={ledger.profile.calendarSystem}
        ownerId={ledger.profile.id}
        onClose={() => { setFormOpen(false); setNewTransactionKind(undefined); }}
        onSave={saveTransaction}
        onPasteSms={() => workspace.openSms()}
        onScanReceipt={(occurredOn) => workspace.openReceiptScan(occurredOn ?? newTransactionDate)}
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
        transfers={ledger.transfers}
      />
      <ReceiptScanner
        open={receiptScanOpen}
        onOpenChange={setReceiptScanOpen}
        showTrigger={false}
        currency={ledger.profile.currency}
        fallbackOccurredOn={receiptFallbackDate}
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
      <BalanceUnlockDialog opened={balanceUnlockOpen && !locked && ledger.profile.hasPin} onClose={() => setBalanceUnlockOpen(false)} onUnlock={unlockBalances} />
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
                  {/* centre medallion: a Himalayan ridge over rhododendron (lali gurans), in line work */}
                  <ellipse cx="120" cy="54" rx="24" ry="24" fill="#dbe8c9" stroke="#2b4a35" strokeWidth=".8" />
                  <ellipse cx="120" cy="54" rx="21" ry="21" fill="none" stroke="#2b4a35" strokeWidth=".4" opacity=".5" />
                  <g clipPath={`url(#${id("oval")})`}>
                    <circle cx="133.5" cy="41.5" r="3.2" fill="none" stroke="#2b4a35" strokeWidth=".6" opacity=".7" />
                    <path d="M94 66 104.5 53.5l4.5 4.2 9.8-15.2 7.6 10.4 4.4-4.6L146 66Z" fill="#2b4a35" opacity=".86" />
                    <path d="M115.6 47.6 118.8 42.5l3.4 4.7-1.9-.8-1.5 1.6-1.4-1.3Z M128.6 50.1l2.3-1.8 2.2 2.3-1.3-.2-1 .8Z" fill="#dbe8c9" />
                    <path d="M95 69.5c8.5-3.6 16.5-3.8 25-.8s16.5 3 25 .2" fill="none" stroke="#2b4a35" strokeWidth=".7" opacity=".75" />
                    <path d="M104.5 75c2.4-3.4 5.6-4.6 9.4-3.6-2.2 2.4-5.4 3.6-9.4 3.6ZM134 74.6c-2.3-3.3-5.4-4.4-9-3.4 2.1 2.3 5.2 3.4 9 3.4Z" fill="#2b4a35" opacity=".8" />
                    {[{ x: 112, y: 69.4, s: 1 }, { x: 127.4, y: 70.2, s: .78 }].map((flower) => (
                      <g key={flower.x} transform={`translate(${flower.x} ${flower.y}) scale(${flower.s})`}>
                        {[0, 72, 144, 216, 288].map((angle) => <ellipse key={angle} cx="0" cy="-2.5" rx="1.65" ry="2.6" transform={`rotate(${angle})`} fill="#a8504a" stroke="#6e2f2b" strokeWidth=".25" />)}
                        <circle r=".95" fill="#f1d9a0" />
                      </g>
                    ))}
                  </g>
                  {/* seals: the SaveYoRupee mark */}
                  <g fill="none" stroke="#2f4a3a" opacity=".8">
                    <circle cx="54" cy="54" r="12.5" strokeWidth=".9" />
                    <circle cx="54" cy="54" r="10" strokeWidth=".45" strokeDasharray="1.5 1.4" />
                  </g>
                  <path d={BRAND_MARK_PATH} transform="translate(54 54) scale(.068) translate(-128 -128)" fill="#2f4a3a" opacity=".82" />
                  <g fill="none" stroke="#3f7a52" opacity=".9">
                    <circle cx="186" cy="54" r="12.5" strokeWidth=".9" />
                    <circle cx="186" cy="54" r="10" strokeWidth=".45" strokeDasharray="1.5 1.4" />
                  </g>
                  <path d={BRAND_MARK_PATH} transform="translate(186 54) scale(.068) translate(-128 -128)" fill="#3f7a52" opacity=".9" />
                  {/* corner scrollwork */}
                  <g fill="none" stroke="#33573f" strokeWidth=".5" opacity=".4">
                    <path d="M12 12h14M12 12v10M228 12h-14M228 12v10M12 90h14M12 90v-10M228 90h-14M228 90v-10" />
                  </g>
                </g>
                <rect x="9" y="9" width="222" height="84" rx="1.5" fill="none" stroke="#33573f" strokeWidth=".7" opacity=".65" />
                <rect x="11.5" y="11.5" width="217" height="79" rx="1" fill="none" stroke="#33573f" strokeWidth=".4" strokeDasharray="2 1.6" opacity=".45" />
                <text x="120" y="19" fill="#245239" fontSize="4.2" fontWeight="700" letterSpacing="1.1" textAnchor="middle">LEDGER NOTE · NOT LEGAL TENDER</text>
                <text x="120" y="28" fill="#1e3d2b" fontSize="7.4" fontWeight="800" letterSpacing="1.6" textAnchor="middle">SAVEYO RUPEE</text>
                <text x="19" y="30" fill="#1e3d2b" fontSize="10.5" fontWeight="700">रु</text>
                <text x="221" y="30" fill="#1e3d2b" fontSize="10.5" fontWeight="700" textAnchor="end">रु</text>
                <text x="19" y="88" fill="#1e3d2b" fontSize="10.5" fontWeight="700">रु</text>
                <text x="221" y="88" fill="#1e3d2b" fontSize="10.5" fontWeight="700" textAnchor="end">रु</text>
                <text x="214" y="40" fill="#3f7a52" fontSize="4.6" fontWeight="700" letterSpacing=".7" textAnchor="end">SYR 0207 2083</text>
                <text x="32" y="80" fill="#3f7a52" fontSize="4.2" fontWeight="700" letterSpacing="1">SERIES 2083</text>
                <text x="208" y="80" fill="#3f7a52" fontSize="4.2" fontWeight="700" letterSpacing="1" textAnchor="end">NO. 000001</text>
                <text x="120" y="83" fill="#245239" fontSize="4" fontWeight="700" letterSpacing=".9" textAnchor="middle">SAVE A LITTLE, EVERY DAY</text>
                <text x="120" y="91" fill="#1e3d2b" fontSize="7.4" fontWeight="800" letterSpacing="1.5" textAnchor="middle">ONE RUPEE</text>
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

function RetryScreen({ className, title, message, onRetry }: { className: "boot-screen" | "page-error"; title: string; message: string; onRetry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  // A failed retry leaves this screen up with its reason, so there is nothing more to report here.
  const retry = async () => { if (busy) return; setBusy(true); try { await onRetry(); } catch { /* still unreachable */ } finally { setBusy(false); } };
  return <div className={`${className} retry-screen`} role="alert"><div className="retry-card"><span className="retry-icon" aria-hidden="true"><WifiSlash size={26} weight="duotone" /></span><strong>{title}</strong><p>{message}</p><button type="button" className="primary-button" onClick={() => void retry()} disabled={busy} aria-busy={busy}>{busy ? <><ButtonSpinner />Trying again…</> : <><ArrowClockwise size={17} />Retry</>}</button></div></div>;
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
