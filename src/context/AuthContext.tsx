/* eslint-disable react-refresh/only-export-components */
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authClient, signOutClient } from "../lib/auth-client";
import type { RecoverySetup, RecoveryVerification } from "../lib/recovery";
import { CANT_REACH_MESSAGE, readResponse, responseMessage, toUserMessage, type ParsedResponse } from "../lib/user-messages";

interface AppUser { id: string; name: string; email: string; emailVerified: boolean; image?: string | null }
interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  /** Why the session could not be checked (offline, server down). Only a real 401 means signed out. */
  sessionError: string | null;
  /** Checks the session again; on failure it rejects and sets sessionError. */
  refreshSession: () => Promise<void>;
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
/** A request that never completed becomes a plain "no connection" message instead of "Failed to fetch". */
const unreachable = (caught: unknown): never => { throw new Error(toUserMessage(caught)); };
const send = (input: string, init?: RequestInit) => fetch(input, init).catch(unreachable);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    let parsed: ParsedResponse<{ user?: AppUser }>;
    try {
      parsed = await readResponse(await fetch("/api/auth/session", { cache: "no-store", credentials: "include" }));
    } catch {
      setSessionError(CANT_REACH_MESSAGE);
      throw new Error(CANT_REACH_MESSAGE);
    }
    if (parsed.status === 401) {
      setUser(null);
      setSessionError(null);
      return;
    }
    // A weak signal or a struggling server is not a sign-out: keep whoever is signed in and say we can't reach it.
    if (!parsed.ok || !parsed.json || !parsed.body?.user) {
      setSessionError(CANT_REACH_MESSAGE);
      throw new Error(CANT_REACH_MESSAGE);
    }
    setUser(parsed.body.user);
    setSessionError(null);
  }, []);

  useEffect(() => {
    let active = true;
    void refreshSession().catch(() => undefined).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshSession]);
  useEffect(() => {
    if (!sessionError) return;
    const retry = () => { void refreshSession().catch(() => undefined); };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [refreshSession, sessionError]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await authClient.signIn.email({ email, password }).catch(unreachable);
    if (result.error) throw new Error(result.error.message ?? "Could not sign in.");
    await refreshSession();
  }, [refreshSession]);

  const setupRecovery = useCallback(async (setup: RecoverySetup) => {
    const response = await send("/api/auth/recovery/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(setup),
    });
    if (!response.ok) throw new Error(responseMessage(await readResponse(response), "Could not save your recovery details."));
  }, []);

  const getRecoveryStatus = useCallback(async () => {
    const parsed = await readResponse<{ configured?: boolean }>(await send("/api/auth/recovery/status", { cache: "no-store", credentials: "include" }));
    if (!parsed.ok || !parsed.json) throw new Error("Could not check recovery setup.");
    return Boolean(parsed.body?.configured);
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string, recoverySetup?: RecoverySetup) => {
    const result = await authClient.signUp.email({ name, email, password }).catch(unreachable);
    if (result.error) throw new Error(result.error.message ?? "Could not create your account.");
    try {
      if (recoverySetup) await setupRecovery(recoverySetup);
    } finally {
      await refreshSession();
    }
    return "Account created. Your private ledger is ready.";
  }, [refreshSession, setupRecovery]);

  const resetPassword = useCallback(async (email: string) => {
    const result = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/?reset=1` }).catch(unreachable);
    if (result.error) throw new Error(result.error.message ?? "Could not request a password reset.");
  }, []);

  const completePasswordReset = useCallback(async (token: string, password: string) => {
    const result = await authClient.resetPassword({ token, newPassword: password }).catch(unreachable);
    if (result.error) throw new Error(result.error.message ?? "That reset link is invalid or expired.");
  }, []);

  const verifyRecovery = useCallback(async (verification: RecoveryVerification) => {
    const parsed = await readResponse<{ token?: string; error?: string }>(await send("/api/auth/recovery/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(verification),
    }));
    if (!parsed.ok || !parsed.body?.token) throw new Error(responseMessage(parsed, "Those recovery details did not match."));
    return parsed.body.token;
  }, []);

  const resetRecoveryPassword = useCallback(async (token: string, newPassword: string) => {
    const response = await send("/api/auth/recovery/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
    if (!response.ok) throw new Error(responseMessage(await readResponse(response), "Could not update your password."));
  }, []);

  const verifyPassword = useCallback(async (password: string) => {
    const response = await send("/api/auth/verify-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (!response.ok) throw new Error("That password did not match.");
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true }).catch(unreachable);
    if (result.error) throw new Error(result.error.message ?? "Could not change your password.");
  }, []);

  const deleteAccount = useCallback(async (password: string) => {
    const result = await authClient.deleteUser({ password, callbackURL: "/" }).catch(unreachable);
    if (result.error) throw new Error(result.error.message ?? "Could not delete your account.");
    setUser(null);
    setSessionError(null);
  }, []);

  const signOut = useCallback(async () => {
    await signOutClient();
    setUser(null);
    setSessionError(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ user, loading, sessionError, refreshSession, isDemo: false, signIn, signUp, resetPassword, completePasswordReset, setupRecovery, getRecoveryStatus, verifyRecovery, resetRecoveryPassword, changePassword, deleteAccount, verifyPassword, signOut }), [user, loading, sessionError, refreshSession, signIn, signUp, resetPassword, completePasswordReset, setupRecovery, getRecoveryStatus, verifyRecovery, resetRecoveryPassword, changePassword, deleteAccount, verifyPassword, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
