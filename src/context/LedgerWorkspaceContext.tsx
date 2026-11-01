"use client";

import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
import type { OnboardingStepId } from "../lib/onboarding";
import type { PeriodKey } from "../lib/period";
import type { LedgerTransaction, SavedPlace } from "../types";
import { useLedger } from "./LedgerContext";

export interface DashboardFocus {
  date: string;
  revision: number;
}

interface LedgerWorkspaceContextValue {
  ledger: ReturnType<typeof useLedger>;
  /** The month every view shows, in the user's calendar (`AD:2026-10`, `BS:2083-06`). */
  period: PeriodKey;
  setPeriod: Dispatch<SetStateAction<PeriodKey>>;
  homeFocus: DashboardFocus | null;
  recentlyAddedTransactionId: string | null;
  setHomeSelectedDate: Dispatch<SetStateAction<string>>;
  openAdd: () => void;
  openAddAtPlace: (place: SavedPlace) => void;
  openAddForDate: (occurredOn: string) => void;
  openDuplicate: (transaction: LedgerTransaction) => void;
  openEdit: (transaction: LedgerTransaction) => void;
  removeTransaction: (transaction: LedgerTransaction) => Promise<void>;
  navigate: (view: import("../types").AppView) => void;
  completeOnboardingStep: (step: OnboardingStepId) => void;
  lock: () => void;
  /** Opens the bank-SMS capture sheet from anywhere, optionally prefilled (share target). */
  openSms: (initialText?: string) => void;
  /** Opens the AI receipt scanner from anywhere; `fallbackDate` dates a receipt with no readable date (default today). */
  openReceiptScan: (fallbackDate?: string) => void;
  /** Opens the move-money sheet; `fromAccountId` preselects the source account, `transferId` edits that transfer. */
  openTransfer: (options?: { fromAccountId?: string; toAccountId?: string; amount?: string; occurredOn?: string; note?: string; transferId?: string }) => void;
  /** Opens the split-a-bill sheet, optionally prefilled from the bill-split calculator. */
  openSplitBill: (options?: { amount?: string; people?: string[]; note?: string }) => void;
  /** Whether balances, safe-to-spend and forecasts may show: always without a PIN, otherwise once unlocked this session. */
  balancesVisible: boolean;
  /** True once the PIN was entered this session; cleared by Lock now, auto-lock, sign-out and reload. */
  balancesUnlocked: boolean;
  /** Checks the PIN, then shows balances on every page until the app locks again. Throws when the PIN does not match. */
  unlockBalances: (pin: string) => Promise<void>;
  /** Opens the shared PIN prompt that unlocks balances. */
  requestBalanceUnlock: () => void;
}

export const LedgerWorkspaceContext = createContext<LedgerWorkspaceContextValue | null>(null);

export function useLedgerWorkspace() {
  const context = useContext(LedgerWorkspaceContext);
  if (!context) throw new Error("useLedgerWorkspace must be used within LedgerAppLayout");
  return context;
}

/**
 * The one balance-privacy session every page reads. Outside LedgerAppLayout
 * there is no session to unlock, so balances show only when there is no PIN.
 */
export function useBalancePrivacy(hasPin: boolean) {
  const context = useContext(LedgerWorkspaceContext);
  return {
    visible: context ? context.balancesVisible : !hasPin,
    requestUnlock: () => context?.requestBalanceUnlock(),
  };
}
