"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "../context/AuthContext";
import { LedgerProvider } from "../context/LedgerContext";
import { ToastProvider } from "../context/ToastContext";

export function AppProviders({ children }: { children: ReactNode }) {
  return <AuthProvider><ToastProvider><LedgerProvider>{children}</LedgerProvider></ToastProvider></AuthProvider>;
}
