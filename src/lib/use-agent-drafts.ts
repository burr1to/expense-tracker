"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readResponse, responseMessage } from "./user-messages";

/** A message an agent such as Muse sent for review. Nothing is in the ledger until the user saves it. */
export interface AgentDraftItem {
  id: string;
  source: "notification" | "sms" | "conversation";
  text: string;
  sourceApp: string | null;
  receivedAt: string;
  agent: string;
}

const REFRESH_INTERVAL_MS = 2 * 60 * 1000;

/** The review queue, refreshed on open, on return to the tab and every two minutes while visible. */
export function useAgentDrafts(enabled: boolean) {
  const [drafts, setDrafts] = useState<AgentDraftItem[]>([]);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/agent-drafts", { credentials: "same-origin", cache: "no-store" });
      const parsed = await readResponse<{ drafts?: AgentDraftItem[] }>(response);
      if (parsed.ok && parsed.body?.drafts) setDrafts(parsed.body.drafts);
    } catch {
      // Offline or signed out: keep what is shown; the next refresh tries again.
    } finally {
      inFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setDrafts([]); return; }
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, REFRESH_INTERVAL_MS);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.clearInterval(interval); };
  }, [enabled, refresh]);

  /** Marks a message reviewed. "saved" only records the user's own save; it never writes to the ledger. */
  const resolve = useCallback(async (id: string, outcome: "saved" | "dismissed", transactionId?: string | null) => {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
    const response = await fetch("/api/agent-drafts", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, outcome, transactionId: transactionId ?? null }),
    });
    const parsed = await readResponse(response);
    // Already reviewed on another device is the outcome we wanted.
    if (!parsed.ok && parsed.status !== 409) {
      void refresh();
      throw new Error(responseMessage(parsed, "Could not update the review list."));
    }
  }, [refresh]);

  return { drafts, refresh, resolve };
}
