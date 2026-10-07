"use client";

import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
import type { OnboardingStepId } from "../lib/onboarding";
import type { LedgerTransaction, SavedPlace } from "../types";
import { useLedger } from "./LedgerContext";

export interface DashboardFocus {
  date: string;
  revision: number;
}

interface LedgerWorkspaceContextValue {
  ledger: ReturnType<typeof useLedger>;
  month: Date;
  setMonth: Dispatch<SetStateAction<Date>>;
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
  /** Opens the AI receipt scanner from anywhere. */
  openReceiptScan: () => void;
  /** Opens the move-money sheet; `fromAccountId` preselects the source account, `transferId` edits that transfer. */
  openTransfer: (options?: { fromAccountId?: string; toAccountId?: string; amount?: string; occurredOn?: string; note?: string; transferId?: string }) => void;
  /** Opens the split-a-bill sheet, optionally prefilled from the bill-split calculator. */
  openSplitBill: (options?: { amount?: string; people?: string[]; note?: string }) => void;
}

export const LedgerWorkspaceContext = createContext<LedgerWorkspaceContextValue | null>(null);

export function useLedgerWorkspace() {
  const context = useContext(LedgerWorkspaceContext);
  if (!context) throw new Error("useLedgerWorkspace must be used within LedgerAppLayout");
  return context;
}
