"use client";

import { PlugsConnected } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { AGENT_SCOPE_LABELS } from "../lib/agent-scope-labels";
import { readResponse, responseMessage, toUserMessage } from "../lib/user-messages";
import { ButtonSpinner } from "./ButtonSpinner";
import { FormError } from "./FormError";

interface Connection { id: string; name: string; scopes: string[]; connectedAt: string; lastUsedAt: string | null }

const dateLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

/** Apps such as Muse that the user allowed to read the ledger or send messages for review, with a way to cut them off. */
export function ConnectedAppsPanel({ disabled = false }: { disabled?: boolean }) {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/oauth/connections", { credentials: "same-origin", cache: "no-store" });
      const parsed = await readResponse<{ connections?: Connection[] }>(response);
      if (!parsed.ok || !parsed.body?.connections) throw new Error(responseMessage(parsed, "Could not load connected apps."));
      setConnections(parsed.body.connections);
      setError(null);
    } catch (caught) {
      setError(toUserMessage(caught, null, "Could not load connected apps."));
    }
  }, []);

  useEffect(() => { if (!disabled) void load(); }, [disabled, load]);

  const revoke = async (connection: Connection) => {
    if (revoking) return;
    setRevoking(connection.id);
    try {
      const response = await fetch("/api/oauth/connections", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: connection.id }) });
      const parsed = await readResponse(response);
      if (!parsed.ok && parsed.status !== 404) throw new Error(responseMessage(parsed, "Could not disconnect the app."));
      setConnections((current) => current?.filter((item) => item.id !== connection.id) ?? null);
      setError(null);
    } catch (caught) {
      setError(toUserMessage(caught, null, "Could not disconnect the app."));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <article className="settings-panel connected-apps">
      <div className="settings-title"><span className="settings-icon"><PlugsConnected size={23} /></span><div><h2>Connected apps</h2><p>Apps you allowed to read your ledger or send messages for review. Disconnecting stops them at once.</p></div></div>
      {disabled ? <p className="connected-apps-empty">Sign in to your own ledger to connect apps.</p>
        : connections === null && !error ? <p className="connected-apps-empty" aria-busy="true">Loading…</p>
        : connections && connections.length === 0 ? <p className="connected-apps-empty">No apps are connected.</p>
        : connections && (
          <ul className="connected-apps-list">
            {connections.map((connection) => (
              <li key={connection.id}>
                <div className="connected-apps-copy">
                  <strong>{connection.name}</strong>
                  <span>{connection.scopes.map((scope) => AGENT_SCOPE_LABELS[scope] ?? scope).join(" · ")}</span>
                  <small>Connected {dateLabel(connection.connectedAt)} · {connection.lastUsedAt ? `last used ${dateLabel(connection.lastUsedAt)}` : "not used yet"}</small>
                </div>
                <button type="button" className="v2-button is-danger" onClick={() => void revoke(connection)} disabled={revoking !== null}>{revoking === connection.id ? <><ButtonSpinner />Disconnecting…</> : "Disconnect"}</button>
              </li>
            ))}
          </ul>
        )}
      <FormError message={error} />
    </article>
  );
}
