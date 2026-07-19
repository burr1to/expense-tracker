"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "../context/AuthContext";
import { LedgerProvider } from "../context/LedgerContext";

export function AppProviders({ children }: { children: ReactNode }) {
  return <AuthProvider><LedgerProvider>{children}</LedgerProvider></AuthProvider>;
}
