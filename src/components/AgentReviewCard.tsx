"use client";

import { ChatCircleText, X } from "@phosphor-icons/react";
import { useState } from "react";
import type { AgentDraftItem } from "../lib/use-agent-drafts";

const SHOWN = 3;

function receivedLabel(iso: string, now = Date.now()) {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));
}

/**
 * Messages a connected app (Muse) sent for review. Review opens the usual SMS review sheet,
 * already read; only saving there adds an entry.
 */
export function AgentReviewCard({ drafts, onReview, onDismiss }: { drafts: AgentDraftItem[]; onReview: (draft: AgentDraftItem) => void; onDismiss: (draft: AgentDraftItem) => Promise<void> }) {
  const [showAll, setShowAll] = useState(false);
  const [dismissing, setDismissing] = useState<string | null>(null);
  if (drafts.length === 0) return null;
  const agents = [...new Set(drafts.map((draft) => draft.agent))];
  const from = agents.length === 1 ? agents[0] : "your apps";
  const visible = showAll ? drafts : drafts.slice(0, SHOWN);
  return (
    <section className="v2-card agent-review" aria-labelledby="agent-review-title">
      <header className="v2-card-head">
        <h2 id="agent-review-title">{drafts.length === 1 ? `1 message from ${from}` : `${drafts.length} messages from ${from}`}</h2>
        <span className="agent-review-hint">Not saved until you review</span>
      </header>
      <ul className="agent-review-list">
        {visible.map((draft) => (
          <li key={draft.id} className="agent-review-item">
            <span className="agent-review-icon" aria-hidden="true"><ChatCircleText size={18} weight="duotone" /></span>
            <div className="agent-review-copy">
              <span className="agent-review-meta">{draft.sourceApp ?? (draft.source === "conversation" ? `Told ${draft.agent}` : "Notification")} · {receivedLabel(draft.receivedAt)}</span>
              <p className="agent-review-text">{draft.text}</p>
            </div>
            <div className="agent-review-actions">
              <button type="button" className="v2-button is-primary" onClick={() => onReview(draft)}>Review</button>
              <button
                type="button"
                className="v2-icon-btn"
                aria-label={`Dismiss message${draft.sourceApp ? ` from ${draft.sourceApp}` : ""}`}
                disabled={dismissing === draft.id}
                onClick={async () => { setDismissing(draft.id); try { await onDismiss(draft); } finally { setDismissing(null); } }}
              ><X size={16} weight="bold" /></button>
            </div>
          </li>
        ))}
      </ul>
      {drafts.length > SHOWN && <button type="button" className="text-button agent-review-more" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show fewer" : `Show all ${drafts.length}`}</button>}
    </section>
  );
}
