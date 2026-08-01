/* eslint-disable react-refresh/only-export-components */
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authClient, signOutClient } from "../lib/auth-client";
import type { RecoverySetup, RecoveryVerification } from "../lib/recovery";

interface AppUser { id: string; name: string; email: string; emailVerified: boolean; image?: string | null }
interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  isDemo: false;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string, recoverySetup?: RecoverySetup) => Promise<string>;
  resetPassword: (email: string) => Promise<void>;
  completePasswordReset: (token: string, password: string) => Promise<void>;
  setupRecovery: (setup: RecoverySetup) => Promise<void>;
  getRecoveryStatus: () => Promise<boolean>;
  verifyRecovery: (verification: RecoveryVerification) => Promise<string>;
  resetRecoveryPassword: (token: string, newPassword: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  verifyPassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    const response = await fetch("/api/auth/beta-access", { cache: "no-store", credentials: "include" });
    if (response.status === 401 || response.status === 403) {
      setUser(null);
      return;
    }
    if (!response.ok) throw new Error("Could not check your session.");
    const session = await response.json();
    setUser(session.user as AppUser);
  }, []);

  useEffect(() => {
    let active = true;
    void refreshSession().finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await authClient.signIn.email({ email, password });
    if (result.error) throw new Error(result.error.message ?? "Could not sign in.");
    await refreshSession();
  }, [refreshSession]);

  const setupRecovery = useCallback(async (setup: RecoverySetup) => {
    const response = await fetch("/api/auth/recovery/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(setup),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? "Could not save your recovery details.");
    }
  }, []);

  const getRecoveryStatus = useCallback(async () => {
    const response = await fetch("/api/auth/recovery/status", { cache: "no-store", credentials: "include" });
    if (!response.ok) throw new Error("Could not check recovery setup.");
    const payload = await response.json() as { configured?: boolean };
    return Boolean(payload.configured);
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string, recoverySetup?: RecoverySetup) => {
    const result = await authClient.signUp.email({ name, email, password });
    if (result.error) throw new Error(result.error.message ?? "Could not create your account.");
    try {
      if (recoverySetup) await setupRecovery(recoverySetup);
    } finally {
      await refreshSession();
    }
    return "Account created. Your private ledger is ready.";
  }, [refreshSession, setupRecovery]);

  const resetPassword = useCallback(async (email: string) => {
    const result = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/?reset=1` });
    if (result.error) throw new Error(result.error.message ?? "Could not request a password reset.");
  }, []);

  const completePasswordReset = useCallback(async (token: string, password: string) => {
    const result = await authClient.resetPassword({ token, newPassword: password });
    if (result.error) throw new Error(result.error.message ?? "That reset link is invalid or expired.");
  }, []);

  const verifyRecovery = useCallback(async (verification: RecoveryVerification) => {
    const response = await fetch("/api/auth/recovery/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(verification),
    });
    const payload = await response.json().catch(() => null) as { token?: string; error?: string } | null;
    if (!response.ok || !payload?.token) throw new Error(payload?.error ?? "Those recovery details did not match.");
    return payload.token;
  }, []);

  const resetRecoveryPassword = useCallback(async (token: string, newPassword: string) => {
    const response = await fetch("/api/auth/recovery/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(payload?.error ?? "Could not update your password.");
  }, []);

  const verifyPassword = useCallback(async (password: string) => {
    const response = await fetch("/api/auth/verify-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (!response.ok) throw new Error("That password did not match.");
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    if (result.error) throw new Error(result.error.message ?? "Could not change your password.");
  }, []);

  const deleteAccount = useCallback(async (password: string) => {
    const result = await authClient.deleteUser({ password, callbackURL: "/" });
    if (result.error) throw new Error(result.error.message ?? "Could not delete your account.");
    setUser(null);
  }, []);

  const signOut = useCallback(async () => {
    await signOutClient();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ user, loading, isDemo: false, signIn, signUp, resetPassword, completePasswordReset, setupRecovery, getRecoveryStatus, verifyRecovery, resetRecoveryPassword, changePassword, deleteAccount, verifyPassword, signOut }), [user, loading, signIn, signUp, resetPassword, completePasswordReset, setupRecovery, getRecoveryStatus, verifyRecovery, resetRecoveryPassword, changePassword, deleteAccount, verifyPassword, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
