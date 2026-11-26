"use client";

import { PasswordInput } from "@mantine/core";
import { ArrowClockwise, Eye, EyeSlash, LockKey, MagnifyingGlass, WifiSlash } from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { useLedger } from "../context/LedgerContext";
import { LedgerWorkspaceContext } from "../context/LedgerWorkspaceContext";
import { useToasts } from "../context/ToastContext";
import { getCategory } from "../lib/categories";
import { toDateInput, todayInput } from "../lib/dates";
import { convertMonthKey, currentMonthKey, monthKeyOf, parseMonthKey, type PeriodKey } from "../lib/period";
import { buildReminderDigest } from "../lib/reminder-digest";
import { deliverNotification, readAddDeepLink, reminderNotificationText, reminderToastText, rolledOverMonth } from "../lib/app-shell";
import { shareCacheStorage, takeSharedItem } from "../lib/shared-inbox";
import { monthlyReportNotice } from "../lib/monthly-report";
import { urgentReminderCount } from "../lib/reminder-badge";
import { useToday } from "../lib/use-today";
import { BalanceUnlockDialog } from "./BalancePrivacy";
import { recurrenceLabel } from "../lib/recurrence";
import { markOnboardingStep } from "../lib/onboarding";
import { appRoutes, viewFromPathname } from "../lib/routes";
import type { AppView, LedgerTransaction, SavedPlace, TransactionDraft, TransactionKind, TransactionLocationDraft } from "../types";
import { AuthPage } from "../views/AuthPage";
import { AddEntriesSheet } from "./AddEntriesSheet";
import { navigateFromOverlay } from "../lib/use-back-to-close";
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
  const [addSheetOpen, setAddSheetOpen] = useState(false);
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
  // A receipt photo shared in from another app, handed to the scanner once it opens.
  const [sharedReceiptFile, setSharedReceiptFile] = useState<File | null>(null);
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
    } else if (link?.type === "shared") {
      void takeSharedItem(shareCacheStorage()).then((item) => {
        if (item?.type === "receipt") {
          setReceiptFallbackDate(todayInput());
          setSharedReceiptFile(item.file);
          setReceiptScanOpen(true);
        } else if (item?.type === "text") {
          setSmsInitialText(item.text);
          setSmsOpen(true);
        } else {
          pushToast({ title: "Nothing to add from that share", body: "Share a bank SMS or a JPG, PNG or WebP receipt photo.", tone: "neutral" });
        }
      }).catch(() => pushToast({ title: "Couldn’t open that share", body: "Share it to SaveYoRupee again.", tone: "danger" }));
    } else if (link?.type === "share-failed") {
      pushToast({ title: "That share didn’t come through", body: "SaveYoRupee was still setting up. Share it again and it will open here.", tone: "neutral" });
    }
  }, [deepLinkQuery, isDemo, ledger.error, ledger.loading, locked, pathname, pushToast, user]);
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
  // The global + opens the batch sheet: entries are usually logged several at a time, later. Per-day buttons use openAddForDate.
  const openAdd = () => setAddSheetOpen(true);
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
        transactionGroups={ledger.transactionGroups}
        onClose={() => { setFormOpen(false); setNewTransactionKind(undefined); }}
        onSave={saveTransaction}
        onPasteSms={() => workspace.openSms()}
        onScanReceipt={(occurredOn) => workspace.openReceiptScan(occurredOn ?? newTransactionDate)}
        onTransfer={(prefill) => workspace.openTransfer(prefill)}
        onSplitBill={(prefill) => workspace.openSplitBill(prefill)}
      />
      <AddEntriesSheet
        open={addSheetOpen}
        currency={ledger.profile.currency}
        calendarSystem={ledger.profile.calendarSystem}
        transactions={ledger.transactions}
        customCategories={ledger.customCategories}
        customSubcategories={ledger.customSubcategories}
        paymentAccounts={ledger.paymentAccounts}
        savedPlaces={ledger.savedPlaces}
        ownerId={ledger.profile.id}
        onClose={() => setAddSheetOpen(false)}
        onSave={(draft) => saveTransaction(draft)}
        onPasteSms={() => { setAddSheetOpen(false); workspace.openSms(); }}
        onScanReceipt={(occurredOn) => { setAddSheetOpen(false); workspace.openReceiptScan(occurredOn); }}
        onImportStatement={() => { navigateFromOverlay(() => router.push(`${appRoutes.transactions}?import=1`)); }}
        onTransfer={() => { setAddSheetOpen(false); workspace.openTransfer(); }}
        onSplitBill={() => { setAddSheetOpen(false); workspace.openSplitBill(); }}
        onFullForm={(occurredOn) => { setAddSheetOpen(false); openAddForDate(occurredOn); }}
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
        onOpenChange={(open) => { setReceiptScanOpen(open); if (!open) setSharedReceiptFile(null); }}
        sharedFile={sharedReceiptFile}
        onSharedFileTaken={() => setSharedReceiptFile(null)}
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

function AppLoader({ className, message }: { className: "boot-screen" | "page-loading"; message: string }) {
  if (className === "boot-screen") {
    return <div className="boot-screen" role="status" aria-live="polite">
      <div className="v2-boot">
        <span className="v2-boot-mark" aria-hidden="true"><i className="v2-boot-coin">₹</i><BrandIcon size={64} /></span>
        <strong>SaveYoRupee</strong>
        <span className="t-shimmer" data-text={message}>{message}</span>
      </div>
    </div>;
  }
  // Inside the app shell: a small card where entries write themselves in, one by one.
  return <div className="page-loading" role="status" aria-live="polite">
    <div className="v2-write" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div className={`v2-write-row r${i}`} key={i}>
          <span className="v2-write-tile" />
          <span className="v2-write-lines"><i /><i /></span>
          <span className="v2-write-amount" />
        </div>
      ))}
    </div>
    <span className="t-shimmer" data-text={message}>{message}</span>
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
