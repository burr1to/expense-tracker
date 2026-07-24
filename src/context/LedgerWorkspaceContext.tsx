"use client";

import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
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
  setHomeSelectedDate: Dispatch<SetStateAction<string>>;
  openAdd: () => void;
  openAddAtPlace: (place: SavedPlace) => void;
  openAddForDate: (occurredOn: string) => void;
  openDuplicate: (transaction: LedgerTransaction) => void;
  openEdit: (transaction: LedgerTransaction) => void;
  removeTransaction: (transaction: LedgerTransaction) => Promise<void>;
  navigate: (view: import("../types").AppView) => void;
  lock: () => void;
}

export const LedgerWorkspaceContext = createContext<LedgerWorkspaceContextValue | null>(null);

export function useLedgerWorkspace() {
  const context = useContext(LedgerWorkspaceContext);
  if (!context) throw new Error("useLedgerWorkspace must be used within LedgerAppLayout");
  return context;
}
