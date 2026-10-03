/* eslint-disable react-refresh/only-export-components */
"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ToastStack } from "../components/ToastStack";

export type ToastTone = "success" | "neutral" | "danger" | "security";

export interface ToastInput {
  title: string;
  body?: string | null;
  /** Shown as a separate, maskable figure, e.g. "−NPR 3,240". */
  amount?: string | null;
  tone?: ToastTone;
  icon?: ReactNode;
  action?: { label: string; run: () => Promise<void> };
  /** Milliseconds before the toast closes on its own while nobody is looking at the stack. */
  duration?: number;
}

export interface ToastItem extends ToastInput {
  id: string;
  leaving: boolean;
  actionPending: boolean;
  actionError: string | null;
  /** Restarts the countdown bar when the timer is reset. */
  revision: number;
}

interface ToastContextValue {
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
}

export const TOAST_DURATION_MS = 5_000;
export const TOAST_ACTION_DURATION_MS = 8_000;
const TOAST_LEAVE_MS = 260;
const MAX_TOASTS = 5;

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.map((toast) => toast.id === id ? { ...toast, leaving: true } : toast));
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), TOAST_LEAVE_MS);
  }, []);

  const push = useCallback((input: ToastInput) => {
    counter.current += 1;
    const id = `toast-${counter.current}`;
    const evicted = new Set<string>();
    setToasts((current) => {
      const next = [{ ...input, id, leaving: false, actionPending: false, actionError: null, revision: 0 }, ...current];
      // The oldest toasts beyond the cap close the same way a dismissed one does.
      return next.map((toast, index) => {
        if (index < MAX_TOASTS || toast.leaving) return toast;
        evicted.add(toast.id);
        return { ...toast, leaving: true };
      });
    });
    window.setTimeout(() => setToasts((current) => current.filter((toast) => !evicted.has(toast.id))), TOAST_LEAVE_MS);
    return id;
  }, []);

  const runAction = useCallback(async (id: string) => {
    const toast = toasts.find((item) => item.id === id);
    if (!toast?.action || toast.actionPending) return;
    setToasts((current) => current.map((item) => item.id === id ? { ...item, actionPending: true, actionError: null } : item));
    try {
      await toast.action.run();
      dismiss(id);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "That didn’t work.";
      setToasts((current) => current.map((item) => item.id === id ? { ...item, actionPending: false, actionError: message, tone: "danger", revision: item.revision + 1 } : item));
    }
  }, [dismiss, toasts]);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} onAction={(id) => void runAction(id)} />
    </ToastContext.Provider>
  );
}

export function useToasts() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToasts must be used within ToastProvider");
  return context;
}
