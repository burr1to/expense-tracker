"use client";

import { CheckCircle, PlugsConnected, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { ButtonSpinner } from "../../../components/ButtonSpinner";
import { useAuth } from "../../../context/AuthContext";
import { readResponse, toUserMessage, type ParsedResponse } from "../../../lib/user-messages";
import { AuthPage } from "../../../views/AuthPage";

interface ConsentDetails {
  client: { name: string };
  scopes: { id: string; label: string }[];
  account: string;
}

type View =
  | { state: "loading" }
  | { state: "ready"; details: ConsentDetails }
  | { state: "error"; message: string }
  | { state: "leaving"; approved: boolean };

/**
 * Consent for an app (such as Muse) asking to connect. Every authorization stops here for an
 * explicit answer, even when the user approved the same app before.
 */
export default function AuthorizePage() {
  const { user, isDemo, loading } = useAuth();
  const [view, setView] = useState<View>({ state: "loading" });
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const query = typeof window === "undefined" ? "" : window.location.search;

  useEffect(() => {
    if (!user || isDemo) return;
    let active = true;
    fetch(`/api/oauth/authorize${query}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as Partial<ConsentDetails> & { error?: string; redirect?: string | null };
        if (!active) return;
        if (response.ok && body.client && body.scopes) setView({ state: "ready", details: body as ConsentDetails });
        else if (body.redirect) window.location.replace(body.redirect);
        else setView({ state: "error", message: body.error ?? "This connection request could not be read." });
      })
      .catch(() => { if (active) setView({ state: "error", message: "Can’t reach SaveYoRupee right now. Check your connection and open the link again." }); });
    return () => { active = false; };
  }, [user, isDemo, query]);

  const decide = async (decision: "approve" | "deny") => {
    if (busy) return;
    setBusy(decision);
    let parsed: ParsedResponse<{ redirect?: string | null; error?: string }> | null = null;
    try {
      const response = await fetch("/api/oauth/authorize", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, decision }),
      });
      parsed = await readResponse<{ redirect?: string | null; error?: string }>(response);
      const redirect = parsed.body?.redirect ?? null;
      if (!redirect) throw new Error("This connection request could not be completed.");
      setView({ state: "leaving", approved: parsed.ok && decision === "approve" });
      window.location.replace(redirect);
    } catch (error) {
      setView({ state: "error", message: toUserMessage(error, parsed && !parsed.ok ? parsed : null, "This connection request could not be completed.") });
      setBusy(null);
    }
  };

  if (loading) return <div className="boot-screen" aria-busy="true" />;
  if (!user && !isDemo) return <AuthPage />;
  if (isDemo) return <Screen icon={<WarningCircle size={26} weight="duotone" />} title="Sign in to connect apps">The demo ledger can’t be connected to other apps.</Screen>;
  if (view.state === "loading") return <div className="boot-screen" aria-busy="true" />;
  if (view.state === "error") return <Screen icon={<WarningCircle size={26} weight="duotone" />} title="Can’t connect this app">{view.message}</Screen>;
  if (view.state === "leaving") return <Screen icon={<CheckCircle size={26} weight="duotone" />} title={view.approved ? "Connected" : "Not connected"}>Taking you back…</Screen>;

  const { details } = view;
  return (
    <div className="boot-screen retry-screen consent-screen">
      <div className="retry-card consent-card" role="dialog" aria-labelledby="consent-title">
        <span className="retry-icon" aria-hidden="true"><PlugsConnected size={26} weight="duotone" /></span>
        <strong id="consent-title">Connect {details.client.name} to your ledger?</strong>
        <p>{details.client.name} will be able to:</p>
        <ul className="consent-scopes">
          {details.scopes.map((scope) => <li key={scope.id}><CheckCircle size={16} weight="fill" aria-hidden="true" />{scope.label}</li>)}
        </ul>
        <p className="consent-note">It can’t change or delete entries. Anything it sends waits for your review. You can disconnect it any time in Profile.</p>
        <p className="consent-account">Signed in as {details.account}</p>
        <div className="consent-actions">
          <button type="button" className="secondary-button" onClick={() => void decide("deny")} disabled={busy !== null}>{busy === "deny" ? <><ButtonSpinner />Declining…</> : "Don’t allow"}</button>
          <button type="button" className="primary-button" onClick={() => void decide("approve")} disabled={busy !== null}>{busy === "approve" ? <><ButtonSpinner />Connecting…</> : "Allow"}</button>
        </div>
      </div>
    </div>
  );
}

function Screen({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <div className="boot-screen retry-screen" role="status"><div className="retry-card"><span className="retry-icon" aria-hidden="true">{icon}</span><strong>{title}</strong><p>{children}</p></div></div>;
}
