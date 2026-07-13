/* eslint-disable react-refresh/only-export-components */
"use client";

import { addMonths, format } from "date-fns";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { majorToMinor } from "../lib/currency";
import type { Budget, CustomCategory, LedgerTransaction, Profile, RecurringEntry, SavingsGoal, TransactionDraft, TransactionKind } from "../types";
import { useAuth } from "./AuthContext";

interface BudgetDraft { category: string; amount: string; monthKey: string }
interface RecurringDraft { kind: TransactionKind; category: string; amount: string; note: string; tags: string; dayOfMonth: number }
interface GoalDraft { name: string; target: string; saved: string; targetDate: string }
interface CategoryDraft { name: string; kind: TransactionKind | "both"; color: string }
interface LedgerData { profile: Profile; transactions: LedgerTransaction[]; budgets: Budget[]; recurringEntries: RecurringEntry[]; goals: SavingsGoal[]; customCategories: CustomCategory[] }
interface LedgerContextValue extends LedgerData {
  loading: boolean; error: string | null;
  saveTransaction: (draft: TransactionDraft, id?: string) => Promise<void>; importTransactions: (drafts: TransactionDraft[]) => Promise<number>; deleteTransaction: (id: string) => Promise<void>;
  saveBudget: (draft: BudgetDraft, id?: string) => Promise<void>; deleteBudget: (id: string) => Promise<void>;
  saveRecurring: (draft: RecurringDraft, id?: string) => Promise<void>; deleteRecurring: (id: string) => Promise<void>; confirmRecurring: (id: string) => Promise<void>;
  saveGoal: (draft: GoalDraft, id?: string) => Promise<void>; contributeToGoal: (id: string, amount: string) => Promise<void>; deleteGoal: (id: string) => Promise<void>;
  saveCustomCategory: (draft: CategoryDraft) => Promise<void>; deleteCustomCategory: (id: string) => Promise<void>;
  updateProfile: (changes: Partial<Pick<Profile, "displayName" | "currency" | "theme" | "hideAmounts" | "autoLockMinutes">>) => Promise<void>; resetDemo: () => void;
}

const emptyProfile: Profile = { id: "", displayName: "Personal ledger", currency: "NPR", theme: "system", hideAmounts: false, autoLockMinutes: 5 };
const emptyData: LedgerData = { profile: emptyProfile, transactions: [], budgets: [], recurringEntries: [], goals: [], customCategories: [] };
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

  const mutate = useCallback(async (action: string, payload?: unknown, id?: string) => {
    const response = await fetch("/api/ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload, id }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not save your changes.");
    setData(body as LedgerData);
  }, []);

  const transactionPayload = (draft: TransactionDraft) => ({ kind: draft.kind, category: draft.category, amountMinor: majorToMinor(draft.amount), occurredOn: draft.occurredOn, note: draft.note.trim(), tags: splitTags(draft.tags) });
  const saveTransaction = useCallback(async (draft: TransactionDraft, id?: string) => mutate("saveTransaction", transactionPayload(draft), id), [mutate]);
  const importTransactions = useCallback(async (drafts: TransactionDraft[]) => { await mutate("importTransactions", drafts.map(transactionPayload)); return drafts.length; }, [mutate]);
  const deleteTransaction = useCallback(async (id: string) => mutate("deleteTransaction", undefined, id), [mutate]);
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
  const updateProfile = useCallback(async (changes: Partial<Pick<Profile, "displayName" | "currency" | "theme" | "hideAmounts" | "autoLockMinutes">>) => mutate("updateProfile", { ...data.profile, ...changes }), [data.profile, mutate]);
  const resetDemo = useCallback(() => undefined, []);

  const value = useMemo<LedgerContextValue>(() => ({ ...data, loading, error, saveTransaction, importTransactions, deleteTransaction, saveBudget, deleteBudget, saveRecurring, deleteRecurring, confirmRecurring, saveGoal, contributeToGoal, deleteGoal, saveCustomCategory, deleteCustomCategory, updateProfile, resetDemo }), [data, loading, error, saveTransaction, importTransactions, deleteTransaction, saveBudget, deleteBudget, saveRecurring, deleteRecurring, confirmRecurring, saveGoal, contributeToGoal, deleteGoal, saveCustomCategory, deleteCustomCategory, updateProfile, resetDemo]);
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger() { const context = useContext(LedgerContext); if (!context) throw new Error("useLedger must be used within LedgerProvider"); return context; }
