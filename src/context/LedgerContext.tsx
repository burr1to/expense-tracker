/* eslint-disable react-refresh/only-export-components */
"use client";

import { addDays, format } from "date-fns";
import { todayInput } from "../lib/dates";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { majorToMinor } from "../lib/currency";
import { ASYNC_IMPORT_THRESHOLD, IMPORT_POLL_INTERVAL_MS } from "../lib/import-job";
import type { AccountReconciliation, AccountTransfer, AccountTransferDraft, Budget,CategoryIconName, CustomCategory, CustomSubcategory, DueDraft, DueItem, ImportJob, LearningState, LedgerTransaction, PaymentAccount, PaymentAccountType, Profile, ReceiptUpload, RecurringDraft, RecurringEntry, SavedPlace, SavedPlaceDraft, SavingsGoal, TransactionDraft, TransactionKind } from "../types";
import type { CsvCategoryDraft, CsvSubcategoryDraft } from "../lib/csv";
import type { SplitBillDraft } from "../lib/split-bill";

/** Where a repayment landed or left (null/omitted means cash), and an id generated per open form so a retried save records once. */
export interface DueSettlementOptions { paymentAccountId?: string | null; clientRequestId?: string }
import { useAuth } from "./AuthContext";
import { useToasts, type ToastInput } from "./ToastContext";
import { activityToast } from "../components/ActivityIcon";
import type { ActivityEntry } from "../lib/activity-log";
import { CANT_REACH_MESSAGE, isConnectionError, readResponse, responseMessage, retrySafeAction as retrySafe, timeoutSignal, toUserMessage, unconfirmedMessage, type ParsedResponse } from "../lib/user-messages";

/** A save that has not answered in this long is reported as unconfirmed; the first load waits as long as it takes. */
const ACTION_TIMEOUT_MS = 20_000;
/** A tab hidden at least this long refreshes quietly when it comes back. */
const STALE_AFTER_HIDDEN_MS = 5 * 60_000;

interface BudgetDraft { category: string; amount: string; monthKey: string; shared?: boolean }
interface GoalDraft { name: string; target: string; saved: string; targetDate: string }
interface CategoryDraft { name: string; kind: TransactionKind | "both"; color: string; icon: CategoryIconName }
interface SubcategoryDraft { categoryId: string; name: string; icon: CategoryIconName }
interface PaymentAccountDraft { type: PaymentAccountType; provider: string; label: string; balance: string; balanceAsOf: string; shared?: boolean; accountTail?: string | null }
interface LedgerData { profile: Profile; transactions: LedgerTransaction[]; budgets: Budget[]; recurringEntries: RecurringEntry[]; goals: SavingsGoal[]; customCategories: CustomCategory[]; customSubcategories: CustomSubcategory[]; paymentAccounts: PaymentAccount[]; reconciliations: AccountReconciliation[]; savedPlaces: SavedPlace[]; transfers: AccountTransfer[]; dueItems: DueItem[] }
export interface BackupRestoreResult { restoredAt: string; exportedAt: string; counts: Record<string, number> }
/** Adjusts one recurring occurrence as it is recorded; anything left out comes from the schedule. */
export interface RecurringConfirmation { dueOn?: string; amountMinor?: number; occurredOn?: string; paymentMode?: TransactionDraft["paymentMode"]; paymentAccountId?: string | null }
interface LedgerContextValue extends LedgerData {
  loading: boolean; error: string | null;
  /** Loads the ledger again with the full-page loader, as the Retry on the load-error screen does. */
  refresh: () => Promise<void>;
  saveTransaction: (draft: TransactionDraft, id?: string) => Promise<string | undefined>; importTransactions: (drafts: TransactionDraft[], newCategories?: CsvCategoryDraft[], newSubcategories?: CsvSubcategoryDraft[]) => Promise<ImportJob | null>; importJobs: ImportJob[]; dismissImportJob: (id: string) => void; saveReceiptSplit: (drafts: TransactionDraft[], receipt: ReceiptUpload, totalMinor: number) => Promise<number>; deleteTransaction: (id: string) => Promise<void>; restoreTransaction: (id: string) => Promise<void>;
  saveSavedPlace: (draft: SavedPlaceDraft, id?: string) => Promise<void>; deleteSavedPlace: (id: string) => Promise<void>;
  saveBudget: (draft: BudgetDraft, id?: string) => Promise<void>; deleteBudget: (id: string) => Promise<void>;
  /** Saves several budgets for one period at once (carry forward, Smart budgets, festival). One log entry. */
  saveBudgets: (monthKey: string, drafts: { category: string; amount: string; shared?: boolean }[]) => Promise<void>;
  saveRecurring: (draft: RecurringDraft, id?: string) => Promise<void>; deleteRecurring: (id: string) => Promise<void>; confirmRecurring: (id: string, overrides?: RecurringConfirmation) => Promise<void>;
  /** Moves past one occurrence without recording it; `dueOn` is the occurrence being skipped. */
  skipRecurring: (id: string, dueOn: string) => Promise<void>; setRecurringActive: (id: string, active: boolean) => Promise<void>;
  saveGoal: (draft: GoalDraft, id?: string) => Promise<void>; contributeToGoal: (id: string, amount: string) => Promise<void>; deleteGoal: (id: string) => Promise<void>;
  saveCustomCategory: (draft: CategoryDraft) => Promise<void>; updateCustomCategoryIcon: (id: string, icon: CategoryIconName) => Promise<void>; deleteCustomCategory: (id: string) => Promise<void>;
  saveCustomSubcategory: (draft: SubcategoryDraft) => Promise<void>; deleteCustomSubcategory: (id: string) => Promise<void>;
  savePaymentAccount: (draft: PaymentAccountDraft) => Promise<void>; updatePaymentAccountBalance: (id: string, balance: string, balanceAsOf: string) => Promise<void>; setPaymentAccountShared: (id: string, shared: boolean) => Promise<void>; resetAccountReconciliation: (id: string) => Promise<void>;
  /** Sets or clears the last digits an SMS uses for this account. */
  updatePaymentAccountTail: (id: string, accountTail: string | null) => Promise<void>;
  /** `removeTransfers` confirms that the account's transfers go with it, changing the other accounts' balances. */
  deletePaymentAccount: (id: string, options?: { removeTransfers?: boolean }) => Promise<void>;
  approveAccountReconciliation: (paymentAccountId: string, monthKey: string, checkedOn: string, actualBalance: string, adjustmentNote: string) => Promise<void>;
  /** With `id`, edits that transfer; otherwise records a new one, deduped on `draft.clientRequestId`. */
  saveTransfer: (draft: AccountTransferDraft, id?: string) => Promise<void>; deleteTransfer: (id: string) => Promise<void>;
  saveDueItem: (draft: DueDraft, id?: string) => Promise<void>; deleteDueItem: (id: string) => Promise<void>;
  snoozeDueItem: (id: string) => Promise<void>;
  recordDuePayment: (id: string, amount: string, occurredOn: string, note: string, addToLedger: boolean, options?: DueSettlementOptions) => Promise<void>;
  completeDueItem: (id: string, addToLedger: boolean, options?: DueSettlementOptions & { amount?: string; occurredOn?: string }) => Promise<void>;
  deleteDuePayment: (paymentId: string) => Promise<void>;
  saveSplitBill: (draft: SplitBillDraft) => Promise<void>;
  savePin: (pin: string, currentPin?: string) => Promise<void>; removePin: (currentPin: string) => Promise<void>; verifyPin: (pin: string) => Promise<void>;
  restoreBackup: (file: File, password: string) => Promise<BackupRestoreResult>;
  updateProfile: (changes: Partial<Pick<Profile, "displayName" | "currency" | "hideAmounts" | "autoLockMinutes" | "calendarSystem" | "safeToSpendBufferMinor" | "emailReminders" | "browserReminders">>) => Promise<void>;
  inviteHousehold: (email: string) => Promise<void>; acceptHousehold: () => Promise<void>; removeHouseholdMember: (email: string) => Promise<void>; leaveHousehold: () => Promise<void>;
  setLearningEnabled: (enabled: boolean) => Promise<void>; runLearning: () => Promise<number>; resetLearning: () => Promise<void>;
  resetDemo: () => void;
  /** Increases whenever the server reports new activity, so Logs can refresh. */
  activityRevision: number;
}

const emptyProfile: Profile = { id: "", displayName: "Personal ledger", currency: "NPR", hideAmounts: false, autoLockMinutes: 0, calendarSystem: "AD", safeToSpendBufferMinor: 0, emailReminders: false, browserReminders: false, household: null, hasPin: false, learning: { enabled: false, suggestions: [], summary: [], lastTransactionId: null, lastRunAt: null } };
const emptyData: LedgerData = { profile: emptyProfile, transactions: [], budgets: [], recurringEntries: [], goals: [], customCategories: [], customSubcategories: [], paymentAccounts: [], reconciliations: [], savedPlaces: [], transfers: [], dueItems: [] };
const LedgerContext = createContext<LedgerContextValue | null>(null);
type WithActivity<T> = T & { activity?: ActivityEntry[] };
const splitTags = (value: string) => [...new Set(value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 8);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const { user, refreshSession } = useAuth();
  const { push: pushToast } = useToasts();
  // Saves in flight, and a counter bumped as each starts and ends, so a quiet refresh never paints over a newer save.
  const actionsInFlight = useRef(0);
  const actionRevision = useRef(0);
  const [activityRevision, setActivityRevision] = useState(0);
  const [data, setData] = useState<LedgerData>(emptyData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const importJobsRef = useRef<ImportJob[]>([]);
  const importPollInFlight = useRef(false);

  /** `showLoading: false` is a quiet refresh: no loader, and a failure keeps what is already on screen. */
  const refresh = useCallback(async (showLoading = true) => {
    if (!user) { setData(emptyData); return; }
    if (showLoading) { setLoading(true); setError(null); }
    const revision = actionRevision.current;
    try {
      const response = await fetch("/api/ledger", { cache: "no-store" });
      const parsed = await readResponse<LedgerData>(response);
      if (response.status === 401) void refreshSession().catch(() => undefined);
      if (!parsed.ok || !parsed.json || !parsed.body) throw new Error(responseMessage(parsed, "Could not load your ledger."));
      // A save that started or finished meanwhile answered with a newer ledger; this copy is older.
      if (!showLoading && actionRevision.current !== revision) return;
      setData(parsed.body);
      setError(null);
    } catch (caught) {
      if (showLoading) setError(isConnectionError(caught) ? CANT_REACH_MESSAGE : caught instanceof Error ? caught.message : "Could not load your ledger.");
    } finally { if (showLoading) setLoading(false); }
  }, [refreshSession, user]);

  const requestAction = useCallback(async (action: string, payload?: unknown, id?: string) => {
    const tracked = action !== "listImportJobs";
    if (tracked) { actionsInFlight.current += 1; actionRevision.current += 1; }
    try {
      let parsed: ParsedResponse<{ error?: string }>;
      try {
        const response = await fetch("/api/ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload, id }), signal: timeoutSignal(ACTION_TIMEOUT_MS) });
        parsed = await readResponse<{ error?: string }>(response);
      } catch (caught) {
        // Lost or too slow: the server may still have saved it, so say only what is true.
        if (isConnectionError(caught)) throw new Error(unconfirmedMessage(retrySafe(action, payload, id)));
        throw caught;
      }
      if (!parsed.ok || !parsed.json) throw new Error(responseMessage(parsed, "Could not save your changes."));
      return parsed.body as unknown;
    } finally {
      if (tracked) { actionsInFlight.current -= 1; actionRevision.current += 1; }
    }
  }, []);

  // Every confirmation toast comes from a log entry the server wrote, so toasts and Logs always agree.
  const announceRef = useRef<(entries: ActivityEntry[] | undefined, fromUndo?: boolean) => void>(() => undefined);
  const announce = useCallback((entries: ActivityEntry[] | undefined, fromUndo = false) => announceRef.current(entries, fromUndo), []);
  useEffect(() => {
    const runUndo = async (action: "deleteTransaction" | "restoreTransaction" | "undoRecurring", transactionId: string, payload?: unknown) => {
      const { activity, ...next } = await requestAction(action, payload, transactionId) as WithActivity<LedgerData>;
      setData(next);
      announceRef.current(activity, true);
    };
    const undoFor = (entry: ActivityEntry): ToastInput["action"] => {
      if (!entry.entityId) return undefined;
      const transactionId = entry.entityId;
      if (entry.action === "transaction.created") return { label: "Undo", run: () => runUndo("deleteTransaction", transactionId) };
      if (entry.action === "transaction.deleted") return { label: "Undo", run: () => runUndo("restoreTransaction", transactionId) };
      const previousDueOn = entry.meta?.previousDueOn;
      const recurringId = entry.meta?.recurringId;
      if (entry.action === "recurring.recorded" && typeof previousDueOn === "string" && typeof recurringId === "string") return { label: "Undo", run: () => runUndo("undoRecurring", recurringId, { previousDueOn, transactionId }) };
      if (entry.action === "recurring.skipped" && typeof previousDueOn === "string") return { label: "Undo", run: () => runUndo("undoRecurring", transactionId, { previousDueOn }) };
      return undefined;
    };
    announceRef.current = (entries, fromUndo = false) => {
      if (!entries?.length) return;
      for (const entry of entries) pushToast(activityToast(entry, fromUndo ? undefined : undoFor(entry)));
      setActivityRevision((revision) => revision + 1);
    };
  }, [pushToast, requestAction]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Catch up quietly after the tab sat hidden for a while or the connection came back (this also recovers a failed
  // first load); skipped while a save is in flight, whose answer carries the latest ledger anyway.
  useEffect(() => {
    if (!user) return;
    let hiddenAt = document.visibilityState === "hidden" ? Date.now() : null;
    const quietRefresh = () => { if (!actionsInFlight.current) void refresh(false); };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { hiddenAt ??= Date.now(); return; }
      const stale = hiddenAt !== null && Date.now() - hiddenAt >= STALE_AFTER_HIDDEN_MS;
      hiddenAt = null;
      if (stale) quietRefresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", quietRefresh);
    return () => { document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("online", quietRefresh); };
  }, [refresh, user]);
  useEffect(() => { importJobsRef.current = importJobs; }, [importJobs]);
  useEffect(() => {
    if (!user) { setImportJobs([]); return; }
    let cancelled = false;
    const mergeJobs = (jobs: ImportJob[]) => setImportJobs((current) => {
      const merged = new Map(current.map((job) => [job.id, job]));
      for (const job of jobs) merged.set(job.id, job);
      return [...merged.values()];
    });
    void requestAction("listImportJobs").then((body) => {
      if (!cancelled) mergeJobs((body as { jobs: ImportJob[] }).jobs);
    }).catch(() => undefined);
    const interval = window.setInterval(() => {
      if (cancelled || importPollInFlight.current) return;
      const pending = importJobsRef.current.find((job) => job.status === "queued" || job.status === "processing");
      if (!pending) return;
      importPollInFlight.current = true;
      void requestAction("processImportJob", { jobId: pending.id }).then(async (body) => {
        if (cancelled) return;
        const { job, activity } = body as { job: ImportJob; activity?: ActivityEntry[] };
        mergeJobs([job]);
        announce(activity);
        if (job.status === "completed") await refresh(false);
      }).catch(() => undefined).finally(() => { importPollInFlight.current = false; });
    }, IMPORT_POLL_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [announce, refresh, requestAction, user]);

  const mutate = useCallback(async (action: string, payload?: unknown, id?: string, onData?: (next: LedgerData) => void) => {
    const { activity, ...next } = await requestAction(action, payload, id) as WithActivity<LedgerData>;
    setData(next);
    onData?.(next);
    announce(activity);
  }, [announce, requestAction]);

  // clientRequestId (new entries only) lets the server return the first save when a retry follows a lost response.
  const transactionPayload = (draft: TransactionDraft) => ({ kind: draft.kind, category: draft.category, amountMinor: majorToMinor(draft.amount), occurredOn: draft.occurredOn, note: draft.note.trim(), subcategory: draft.subcategory.trim() || null, area: draft.area.trim() || null, paymentMode: draft.paymentMode, paymentAccountId: draft.paymentMode === "online" ? draft.paymentAccountId || null : null, shared: draft.shared ?? false, location: draft.location ?? null, receipt: draft.receipt, removeReceipt: draft.removeReceipt, clientRequestId: draft.clientRequestId || undefined });
  const saveTransaction = useCallback(async (draft: TransactionDraft, id?: string) => {
    let savedId = id;
    const previousIds = new Set(data.transactions.map((transaction) => transaction.id));
    await mutate("saveTransaction", transactionPayload(draft), id, (next) => {
      savedId ??= next.transactions.find((transaction) => !previousIds.has(transaction.id))?.id;
    });
    return savedId;
  }, [data.transactions, mutate]);
  const importTransactions = useCallback(async (drafts: TransactionDraft[], newCategories: CsvCategoryDraft[] = [], newSubcategories: CsvSubcategoryDraft[] = []) => {
    const payload = { transactions: drafts.map(transactionPayload), newCategories, newSubcategories };
    if (drafts.length > ASYNC_IMPORT_THRESHOLD) {
      const body = await requestAction("startImportJob", payload) as { job: ImportJob };
      setImportJobs((current) => [...current.filter((job) => job.id !== body.job.id), body.job]);
      return body.job;
    }
    await mutate("importTransactions", payload);
    return null;
  }, [mutate, requestAction]);
  const dismissImportJob = useCallback((id: string) => setImportJobs((current) => current.filter((job) => job.id !== id)), []);
  const saveReceiptSplit = useCallback(async (drafts: TransactionDraft[], receipt: ReceiptUpload, totalMinor: number) => {
    await mutate("saveReceiptSplit", { transactions: drafts.map(transactionPayload), receipt, totalMinor });
    return drafts.length;
  }, [mutate]);
  const deleteTransaction = useCallback(async (id: string) => mutate("deleteTransaction", undefined, id), [mutate]);
  const restoreTransaction = useCallback(async (id: string) => mutate("restoreTransaction", undefined, id), [mutate]);
  const saveSavedPlace = useCallback(async (draft: SavedPlaceDraft, id?: string) => mutate("saveSavedPlace", draft, id), [mutate]);
  const deleteSavedPlace = useCallback(async (id: string) => mutate("deleteSavedPlace", undefined, id), [mutate]);
  const saveBudget = useCallback(async (draft: BudgetDraft, id?: string) => mutate("saveBudget", { monthKey: draft.monthKey, category: draft.category, amountMinor: majorToMinor(draft.amount), shared: draft.shared ?? false }, id), [mutate]);
  const saveBudgets = useCallback(async (monthKey: string, drafts: { category: string; amount: string; shared?: boolean }[]) => mutate("saveBudgets", { monthKey, budgets: drafts.map((draft) => ({ category: draft.category, amountMinor: majorToMinor(draft.amount), ...(draft.shared === undefined ? {} : { shared: draft.shared }) })) }), [mutate]);
  const deleteBudget = useCallback(async (id: string) => mutate("deleteBudget", undefined, id), [mutate]);
  const saveRecurring = useCallback(async (draft: RecurringDraft, id?: string) => {
    await mutate("saveRecurring", {
      kind: draft.kind,
      category: draft.category,
      amountMinor: majorToMinor(draft.amount),
      paymentAccountId: draft.paymentAccountId || null,
      note: draft.note.trim(),
      tags: splitTags(draft.tags),
      recurrenceUnit: draft.recurrenceUnit,
      recurrenceInterval: draft.recurrenceInterval,
      startOn: draft.startOn,
      active: draft.active,
    }, id);
  }, [mutate]);
  const deleteRecurring = useCallback(async (id: string) => mutate("deleteRecurring", undefined, id), [mutate]);
  const confirmRecurring = useCallback(async (id: string, overrides?: RecurringConfirmation) => mutate("confirmRecurring", overrides, id), [mutate]);
  const skipRecurring = useCallback(async (id: string, dueOn: string) => mutate("skipRecurring", { dueOn }, id), [mutate]);
  const setRecurringActive = useCallback(async (id: string, active: boolean) => {
    const entry = data.recurringEntries.find((item) => item.id === id);
    if (!entry) throw new Error("This recurring entry no longer exists.");
    await mutate("saveRecurring", { kind: entry.kind, category: entry.category, amountMinor: entry.amountMinor, paymentAccountId: entry.paymentAccountId, note: entry.note, tags: entry.tags, recurrenceUnit: entry.recurrenceUnit, recurrenceInterval: entry.recurrenceInterval, startOn: entry.anchorDate, active }, id);
  }, [data.recurringEntries, mutate]);
  const saveGoal = useCallback(async (draft: GoalDraft, id?: string) => mutate("saveGoal", { name: draft.name, targetMinor: majorToMinor(draft.target), savedMinor: majorToMinor(draft.saved), targetDate: draft.targetDate || null }, id), [mutate]);
  const contributeToGoal = useCallback(async (id: string, amount: string) => mutate("contributeToGoal", { amountMinor: majorToMinor(amount) }, id), [mutate]);
  const deleteGoal = useCallback(async (id: string) => mutate("deleteGoal", undefined, id), [mutate]);
  const saveCustomCategory = useCallback(async (draft: CategoryDraft) => mutate("saveCustomCategory", draft), [mutate]);
  const updateCustomCategoryIcon = useCallback(async (id: string, icon: CategoryIconName) => mutate("updateCustomCategoryIcon", { icon }, id), [mutate]);
  const deleteCustomCategory = useCallback(async (id: string) => mutate("deleteCustomCategory", undefined, id), [mutate]);
  const saveCustomSubcategory = useCallback(async (draft: SubcategoryDraft) => mutate("saveCustomSubcategory", draft), [mutate]);
  const deleteCustomSubcategory = useCallback(async (id: string) => mutate("deleteCustomSubcategory", undefined, id), [mutate]);
  const savePaymentAccount = useCallback(async (draft: PaymentAccountDraft) => mutate("savePaymentAccount", { type: draft.type, provider: draft.provider, label: draft.label, accountTail: draft.accountTail?.trim() || null, balanceMinor: majorToMinor(draft.balance), balanceAsOf: draft.balanceAsOf, shared: draft.shared ?? false }), [mutate]);
  const updatePaymentAccountTail = useCallback(async (id: string, accountTail: string | null) => mutate("updatePaymentAccountTail", { accountTail: accountTail?.trim() || null }, id), [mutate]);
  const setPaymentAccountShared = useCallback(async (id: string, shared: boolean) => mutate("setPaymentAccountShared", { shared }, id), [mutate]);
  const inviteHousehold = useCallback(async (email: string) => mutate("inviteHousehold", { email }), [mutate]);
  const acceptHousehold = useCallback(async () => mutate("acceptHousehold"), [mutate]);
  const removeHouseholdMember = useCallback(async (email: string) => mutate("removeHouseholdMember", { email }), [mutate]);
  const leaveHousehold = useCallback(async () => mutate("leaveHousehold"), [mutate]);
  const updatePaymentAccountBalance = useCallback(async (id: string, balance: string, balanceAsOf: string) => mutate("updatePaymentAccountBalance", { balanceMinor: majorToMinor(balance), balanceAsOf }, id), [mutate]);
  const approveAccountReconciliation = useCallback(async (paymentAccountId: string, monthKey: string, checkedOn: string, actualBalance: string, adjustmentNote: string) => mutate("approveAccountReconciliation", { paymentAccountId, monthKey, checkedOn, actualBalanceMinor: majorToMinor(actualBalance), adjustmentNote: adjustmentNote.trim() }), [mutate]);
  const resetAccountReconciliation = useCallback(async (id: string) => mutate("resetAccountReconciliation", { confirmation: "RESET" }, id), [mutate]);
  const deletePaymentAccount = useCallback(async (id: string, options: { removeTransfers?: boolean } = {}) => mutate("deletePaymentAccount", options.removeTransfers ? { removeTransfers: true } : undefined, id), [mutate]);
  const saveTransfer = useCallback(async (draft: AccountTransferDraft, id?: string) => mutate("saveTransfer", { fromAccountId: draft.fromAccountId, toAccountId: draft.toAccountId, amountMinor: majorToMinor(draft.amount), occurredOn: draft.occurredOn, note: draft.note.trim(), clientRequestId: id ? undefined : draft.clientRequestId }, id), [mutate]);
  const deleteTransfer = useCallback(async (id: string) => mutate("deleteTransfer", undefined, id), [mutate]);
  const saveDueItem = useCallback(async (draft: DueDraft, id?: string) => mutate("saveDueItem", { ...draft, amountMinor: majorToMinor(draft.amount), occurredOn: draft.occurredOn || null, remindOn: draft.remindOn || null, annualRatePercent: draft.annualRatePercent.trim() ? Number(draft.annualRatePercent) : null }, id), [mutate]);
  const deleteDueItem = useCallback(async (id: string) => mutate("deleteDueItem", undefined, id), [mutate]);
  const snoozeDueItem = useCallback(async (id: string) => mutate("snoozeDueItem", { until: format(addDays(new Date(), 1), "yyyy-MM-dd") }, id), [mutate]);
  const recordDuePayment = useCallback(async (id: string, amount: string, occurredOn: string, note: string, addToLedger: boolean, options: DueSettlementOptions = {}) => mutate("recordDuePayment", { amountMinor: majorToMinor(amount), occurredOn, note: note.trim(), addToLedger, paymentAccountId: options.paymentAccountId || null, clientRequestId: options.clientRequestId }, id), [mutate]);
  const completeDueItem = useCallback(async (id: string, addToLedger: boolean, options: DueSettlementOptions & { amount?: string; occurredOn?: string } = {}) => mutate("completeDueItem", { addToLedger, occurredOn: options.occurredOn || todayInput(), amountMinor: options.amount ? majorToMinor(options.amount) : undefined, paymentAccountId: options.paymentAccountId || null, clientRequestId: options.clientRequestId }, id), [mutate]);
  const deleteDuePayment = useCallback(async (paymentId: string) => mutate("deleteDuePayment", undefined, paymentId), [mutate]);
  const saveSplitBill = useCallback(async (draft: SplitBillDraft) => mutate("saveSplitBill", { ...draft, note: draft.note.trim() }), [mutate]);
  const savePin = useCallback(async (pin: string, currentPin?: string) => mutate("savePin", { pin, currentPin }), [mutate]);
  const removePin = useCallback(async (currentPin: string) => mutate("removePin", { currentPin }), [mutate]);
  const verifyPin = useCallback(async (pin: string) => {
    let parsed: ParsedResponse<{ error?: string }>;
    try { parsed = await readResponse(await fetch("/api/auth/verify-pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) })); }
    catch (caught) { throw new Error(toUserMessage(caught)); }
    if (!parsed.ok) throw new Error(responseMessage(parsed, "That PIN did not match."));
  }, []);
  const restoreBackup = useCallback(async (file: File, password: string) => {
    const form = new FormData();
    form.append("backup", file);
    form.append("password", password);
    let parsed: ParsedResponse<WithActivity<BackupRestoreResult & { error?: string }>>;
    try { parsed = await readResponse(await fetch("/api/backup", { method: "POST", body: form })); }
    // The restore may still finish on the server; Logs will say so after a refresh.
    catch (caught) { throw new Error(isConnectionError(caught) ? "We couldn’t confirm the restore because the connection dropped. Refresh and check Logs before trying again." : toUserMessage(caught)); }
    if (!parsed.ok || !parsed.json || !parsed.body) throw new Error(responseMessage(parsed, "Could not restore this backup."));
    const { activity, ...body } = parsed.body;
    await refresh();
    announce(activity);
    return body;
  }, [announce, refresh]);
  // Only settings that differ from what this device last loaded are sent, so a stale form can't undo another device's change.
  const updateProfile = useCallback(async (changes: Partial<Pick<Profile, "displayName" | "currency" | "hideAmounts" | "autoLockMinutes" | "calendarSystem" | "safeToSpendBufferMinor" | "emailReminders" | "browserReminders">>) => {
    const changed = Object.fromEntries(Object.entries(changes).filter(([key, value]) => value !== undefined && data.profile[key as keyof typeof changes] !== value));
    if (Object.keys(changed).length) await mutate("updateProfile", changed);
  }, [data.profile, mutate]);
  const learningAction = useCallback(async (payload: { action: "setEnabled"; enabled: boolean } | { action: "run" } | { action: "reset" }) => {
    let parsed: ParsedResponse<WithActivity<{ learning?: LearningState; processed?: number; error?: string }>>;
    try { parsed = await readResponse(await fetch("/api/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })); }
    catch (caught) { throw new Error(toUserMessage(caught)); }
    const body = parsed.body;
    if (!parsed.ok || !body?.learning) throw new Error(responseMessage(parsed, "Could not update personalization."));
    setData((current) => ({ ...current, profile: { ...current.profile, learning: body.learning! } }));
    announce(body.activity);
    return body.processed ?? 0;
  }, [announce]);
  const setLearningEnabled = useCallback(async (enabled: boolean) => { await learningAction({ action: "setEnabled", enabled }); }, [learningAction]);
  const runLearning = useCallback(() => learningAction({ action: "run" }), [learningAction]);
  const resetLearning = useCallback(async () => { await learningAction({ action: "reset" }); }, [learningAction]);
  const resetDemo = useCallback(() => undefined, []);
  const reload = useCallback(() => refresh(true), [refresh]);

  const value = useMemo<LedgerContextValue>(() => ({ ...data, loading, error, refresh: reload, saveTransaction, importTransactions, importJobs, dismissImportJob, saveReceiptSplit, deleteTransaction, restoreTransaction, saveSavedPlace, deleteSavedPlace, saveBudget, saveBudgets, deleteBudget, saveRecurring, deleteRecurring, confirmRecurring, skipRecurring, setRecurringActive, saveGoal, contributeToGoal, deleteGoal, saveCustomCategory, updateCustomCategoryIcon, deleteCustomCategory, saveCustomSubcategory, deleteCustomSubcategory, savePaymentAccount, updatePaymentAccountTail, updatePaymentAccountBalance, setPaymentAccountShared, approveAccountReconciliation, resetAccountReconciliation, deletePaymentAccount, saveTransfer, deleteTransfer, saveDueItem, deleteDueItem, snoozeDueItem, recordDuePayment, completeDueItem, deleteDuePayment, saveSplitBill, savePin, removePin, verifyPin, restoreBackup, updateProfile, inviteHousehold, acceptHousehold, removeHouseholdMember, leaveHousehold, setLearningEnabled, runLearning, resetLearning, resetDemo, activityRevision }), [activityRevision, data, loading, error, reload, saveTransaction, importTransactions, importJobs, dismissImportJob, saveReceiptSplit, deleteTransaction, restoreTransaction, saveSavedPlace, deleteSavedPlace, saveBudget, saveBudgets, deleteBudget, saveRecurring, deleteRecurring, confirmRecurring, skipRecurring, setRecurringActive, saveGoal, contributeToGoal, deleteGoal, saveCustomCategory, updateCustomCategoryIcon, deleteCustomCategory, saveCustomSubcategory, deleteCustomSubcategory, savePaymentAccount, updatePaymentAccountTail, updatePaymentAccountBalance, setPaymentAccountShared, approveAccountReconciliation, resetAccountReconciliation, deletePaymentAccount, saveTransfer, deleteTransfer, saveDueItem, deleteDueItem, snoozeDueItem, recordDuePayment, completeDueItem, deleteDuePayment, saveSplitBill, savePin, removePin, verifyPin, restoreBackup, updateProfile, inviteHousehold, acceptHousehold, removeHouseholdMember, leaveHousehold, setLearningEnabled, runLearning, resetLearning, resetDemo]);
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger() { const context = useContext(LedgerContext); if (!context) throw new Error("useLedger must be used within LedgerProvider"); return context; }
