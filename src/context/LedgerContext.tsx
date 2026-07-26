/* eslint-disable react-refresh/only-export-components */
"use client";

import { addDays, addMonths, format } from "date-fns";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { majorToMinor } from "../lib/currency";
import type { AccountTransfer, Budget, CustomCategory, DueDraft, DueItem, LedgerTransaction, PaymentAccount, PaymentAccountType, Profile, RecurringEntry, SavedPlace, SavedPlaceDraft, SavingsGoal, TransactionDraft, TransactionKind } from "../types";
import { useAuth } from "./AuthContext";

interface BudgetDraft { category: string; amount: string; monthKey: string }
interface RecurringDraft { kind: TransactionKind; category: string; amount: string; note: string; tags: string; dayOfMonth: number }
interface GoalDraft { name: string; target: string; saved: string; targetDate: string }
interface CategoryDraft { name: string; kind: TransactionKind | "both"; color: string }
interface PaymentAccountDraft { type: PaymentAccountType; provider: string; label: string; balance: string; balanceAsOf: string }
interface AccountTransferDraft { fromAccountId: string; toAccountId: string; amount: string; occurredOn: string; note: string }
interface LedgerData { profile: Profile; transactions: LedgerTransaction[]; budgets: Budget[]; recurringEntries: RecurringEntry[]; goals: SavingsGoal[]; customCategories: CustomCategory[]; paymentAccounts: PaymentAccount[]; savedPlaces: SavedPlace[]; transfers: AccountTransfer[]; dueItems: DueItem[] }
interface LedgerContextValue extends LedgerData {
  loading: boolean; error: string | null;
  saveTransaction: (draft: TransactionDraft, id?: string) => Promise<string | undefined>; importTransactions: (drafts: TransactionDraft[]) => Promise<number>; deleteTransaction: (id: string) => Promise<void>;
  saveSavedPlace: (draft: SavedPlaceDraft, id?: string) => Promise<void>; deleteSavedPlace: (id: string) => Promise<void>;
  saveBudget: (draft: BudgetDraft, id?: string) => Promise<void>; deleteBudget: (id: string) => Promise<void>;
  saveRecurring: (draft: RecurringDraft, id?: string) => Promise<void>; deleteRecurring: (id: string) => Promise<void>; confirmRecurring: (id: string) => Promise<void>;
  saveGoal: (draft: GoalDraft, id?: string) => Promise<void>; contributeToGoal: (id: string, amount: string) => Promise<void>; deleteGoal: (id: string) => Promise<void>;
  saveCustomCategory: (draft: CategoryDraft) => Promise<void>; deleteCustomCategory: (id: string) => Promise<void>;
  savePaymentAccount: (draft: PaymentAccountDraft) => Promise<void>; updatePaymentAccountBalance: (id: string, balance: string, balanceAsOf: string) => Promise<void>; deletePaymentAccount: (id: string) => Promise<void>;
  saveTransfer: (draft: AccountTransferDraft) => Promise<void>; deleteTransfer: (id: string) => Promise<void>;
  saveDueItem: (draft: DueDraft, id?: string) => Promise<void>; deleteDueItem: (id: string) => Promise<void>;
  snoozeDueItem: (id: string) => Promise<void>;
  recordDuePayment: (id: string, amount: string, occurredOn: string, note: string, addToLedger: boolean) => Promise<void>;
  completeDueItem: (id: string, addToLedger: boolean) => Promise<void>;
  savePin: (pin: string, currentPin?: string) => Promise<void>; removePin: (currentPin: string) => Promise<void>; verifyPin: (pin: string) => Promise<void>;
  updateProfile: (changes: Partial<Pick<Profile, "displayName" | "currency" | "hideAmounts" | "autoLockMinutes">>) => Promise<void>; resetDemo: () => void;
}

const emptyProfile: Profile = { id: "", displayName: "Personal ledger", currency: "NPR", hideAmounts: false, autoLockMinutes: 0, hasPin: false };
const emptyData: LedgerData = { profile: emptyProfile, transactions: [], budgets: [], recurringEntries: [], goals: [], customCategories: [], paymentAccounts: [], savedPlaces: [], transfers: [], dueItems: [] };
const LedgerContext = createContext<LedgerContextValue | null>(null);
const splitTags = (value: string) => [...new Set(value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 8);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [data, setData] = useState<LedgerData>(emptyData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) { setData(emptyData); return; }
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/ledger", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load your ledger.");
      setData(body as LedgerData);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load your ledger."); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  const mutate = useCallback(async (action: string, payload?: unknown, id?: string, onData?: (next: LedgerData) => void) => {
    const response = await fetch("/api/ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload, id }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not save your changes.");
    const next = body as LedgerData;
    setData(next);
    onData?.(next);
  }, []);

  const transactionPayload = (draft: TransactionDraft) => ({ kind: draft.kind, category: draft.category, amountMinor: majorToMinor(draft.amount), occurredOn: draft.occurredOn, note: draft.note.trim(), subcategory: draft.subcategory.trim() || null, area: draft.area.trim() || null, paymentMode: draft.paymentMode, paymentAccountId: draft.paymentMode === "online" ? draft.paymentAccountId || null : null, location: draft.location ?? null, receipt: draft.receipt, removeReceipt: draft.removeReceipt });
  const saveTransaction = useCallback(async (draft: TransactionDraft, id?: string) => {
    let savedId = id;
    const previousIds = new Set(data.transactions.map((transaction) => transaction.id));
    await mutate("saveTransaction", transactionPayload(draft), id, (next) => {
      savedId ??= next.transactions.find((transaction) => !previousIds.has(transaction.id))?.id;
    });
    return savedId;
  }, [data.transactions, mutate]);
  const importTransactions = useCallback(async (drafts: TransactionDraft[]) => { await mutate("importTransactions", drafts.map(transactionPayload)); return drafts.length; }, [mutate]);
  const deleteTransaction = useCallback(async (id: string) => mutate("deleteTransaction", undefined, id), [mutate]);
  const saveSavedPlace = useCallback(async (draft: SavedPlaceDraft, id?: string) => mutate("saveSavedPlace", draft, id), [mutate]);
  const deleteSavedPlace = useCallback(async (id: string) => mutate("deleteSavedPlace", undefined, id), [mutate]);
  const saveBudget = useCallback(async (draft: BudgetDraft, id?: string) => mutate("saveBudget", { monthKey: draft.monthKey, category: draft.category, amountMinor: majorToMinor(draft.amount) }, id), [mutate]);
  const deleteBudget = useCallback(async (id: string) => mutate("deleteBudget", undefined, id), [mutate]);
  const saveRecurring = useCallback(async (draft: RecurringDraft, id?: string) => { const today = new Date(); let due = new Date(today.getFullYear(), today.getMonth(), draft.dayOfMonth); if (due < today) due = addMonths(due, 1); await mutate("saveRecurring", { kind: draft.kind, category: draft.category, amountMinor: majorToMinor(draft.amount), note: draft.note.trim(), tags: splitTags(draft.tags), dayOfMonth: draft.dayOfMonth, nextDueOn: format(due, "yyyy-MM-dd") }, id); }, [mutate]);
  const deleteRecurring = useCallback(async (id: string) => mutate("deleteRecurring", undefined, id), [mutate]);
  const confirmRecurring = useCallback(async (id: string) => mutate("confirmRecurring", undefined, id), [mutate]);
  const saveGoal = useCallback(async (draft: GoalDraft, id?: string) => mutate("saveGoal", { name: draft.name, targetMinor: majorToMinor(draft.target), savedMinor: majorToMinor(draft.saved), targetDate: draft.targetDate || null }, id), [mutate]);
  const contributeToGoal = useCallback(async (id: string, amount: string) => mutate("contributeToGoal", { amountMinor: majorToMinor(amount) }, id), [mutate]);
  const deleteGoal = useCallback(async (id: string) => mutate("deleteGoal", undefined, id), [mutate]);
  const saveCustomCategory = useCallback(async (draft: CategoryDraft) => mutate("saveCustomCategory", draft), [mutate]);
  const deleteCustomCategory = useCallback(async (id: string) => mutate("deleteCustomCategory", undefined, id), [mutate]);
  const savePaymentAccount = useCallback(async (draft: PaymentAccountDraft) => mutate("savePaymentAccount", { type: draft.type, provider: draft.provider, label: draft.label, balanceMinor: majorToMinor(draft.balance), balanceAsOf: draft.balanceAsOf }), [mutate]);
  const updatePaymentAccountBalance = useCallback(async (id: string, balance: string, balanceAsOf: string) => mutate("updatePaymentAccountBalance", { balanceMinor: majorToMinor(balance), balanceAsOf }, id), [mutate]);
  const deletePaymentAccount = useCallback(async (id: string) => mutate("deletePaymentAccount", undefined, id), [mutate]);
  const saveTransfer = useCallback(async (draft: AccountTransferDraft) => mutate("saveTransfer", { fromAccountId: draft.fromAccountId, toAccountId: draft.toAccountId, amountMinor: majorToMinor(draft.amount), occurredOn: draft.occurredOn, note: draft.note.trim() }), [mutate]);
  const deleteTransfer = useCallback(async (id: string) => mutate("deleteTransfer", undefined, id), [mutate]);
  const saveDueItem = useCallback(async (draft: DueDraft, id?: string) => mutate("saveDueItem", { ...draft, amountMinor: majorToMinor(draft.amount), occurredOn: draft.occurredOn || null, remindOn: draft.remindOn || null }, id), [mutate]);
  const deleteDueItem = useCallback(async (id: string) => mutate("deleteDueItem", undefined, id), [mutate]);
  const snoozeDueItem = useCallback(async (id: string) => mutate("snoozeDueItem", { until: format(addDays(new Date(), 1), "yyyy-MM-dd") }, id), [mutate]);
  const recordDuePayment = useCallback(async (id: string, amount: string, occurredOn: string, note: string, addToLedger: boolean) => mutate("recordDuePayment", { amountMinor: majorToMinor(amount), occurredOn, note: note.trim(), addToLedger }, id), [mutate]);
  const completeDueItem = useCallback(async (id: string, addToLedger: boolean) => mutate("completeDueItem", { addToLedger, occurredOn: format(new Date(), "yyyy-MM-dd") }, id), [mutate]);
  const savePin = useCallback(async (pin: string, currentPin?: string) => mutate("savePin", { pin, currentPin }), [mutate]);
  const removePin = useCallback(async (currentPin: string) => mutate("removePin", { currentPin }), [mutate]);
  const verifyPin = useCallback(async (pin: string) => {
    const response = await fetch("/api/auth/verify-pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "That PIN did not match.");
  }, []);
  const updateProfile = useCallback(async (changes: Partial<Pick<Profile, "displayName" | "currency" | "hideAmounts" | "autoLockMinutes">>) => mutate("updateProfile", { ...data.profile, ...changes }), [data.profile, mutate]);
  const resetDemo = useCallback(() => undefined, []);

  const value = useMemo<LedgerContextValue>(() => ({ ...data, loading, error, saveTransaction, importTransactions, deleteTransaction, saveSavedPlace, deleteSavedPlace, saveBudget, deleteBudget, saveRecurring, deleteRecurring, confirmRecurring, saveGoal, contributeToGoal, deleteGoal, saveCustomCategory, deleteCustomCategory, savePaymentAccount, updatePaymentAccountBalance, deletePaymentAccount, saveTransfer, deleteTransfer, saveDueItem, deleteDueItem, snoozeDueItem, recordDuePayment, completeDueItem, savePin, removePin, verifyPin, updateProfile, resetDemo }), [data, loading, error, saveTransaction, importTransactions, deleteTransaction, saveSavedPlace, deleteSavedPlace, saveBudget, deleteBudget, saveRecurring, deleteRecurring, confirmRecurring, saveGoal, contributeToGoal, deleteGoal, saveCustomCategory, deleteCustomCategory, savePaymentAccount, updatePaymentAccountBalance, deletePaymentAccount, saveTransfer, deleteTransfer, saveDueItem, deleteDueItem, snoozeDueItem, recordDuePayment, completeDueItem, savePin, removePin, verifyPin, updateProfile, resetDemo]);
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger() { const context = useContext(LedgerContext); if (!context) throw new Error("useLedger must be used within LedgerProvider"); return context; }
