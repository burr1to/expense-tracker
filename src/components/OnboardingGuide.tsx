"use client";

import { Bank, CaretDown, Check, Flag, ListBullets, LockKey, Sparkle, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ONBOARDING_EVENT, onboardingStorageKey } from "../lib/onboarding";

export type OnboardingStepId = "pin" | "account" | "transaction" | "budget";

interface OnboardingGuideProps {
  userId: string;
  hasPin: boolean;
  hasAccount: boolean;
  hasTransaction: boolean;
  hasBudget: boolean;
  onAction: (step: OnboardingStepId) => void;
}

export function OnboardingGuide({ userId, hasPin, hasAccount, hasTransaction, hasBudget, onAction }: OnboardingGuideProps) {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const steps = useMemo(() => [
    { id: "pin" as const, title: "Protect your ledger", detail: "Create a short PIN for balances and private entries.", complete: hasPin, icon: LockKey, action: "Set PIN" },
    { id: "account" as const, title: "Add an account", detail: "Track the balance of a bank or digital wallet.", complete: hasAccount, icon: Bank, action: "Add account" },
    { id: "transaction" as const, title: "Record your first transaction", detail: "Add real income or spending to start your monthly story.", complete: hasTransaction, icon: ListBullets, action: "Add transaction" },
    { id: "budget" as const, title: "Set a monthly guardrail", detail: "Choose one category and give it a comfortable limit.", complete: hasBudget, icon: Flag, action: "Create budget" },
  ], [hasAccount, hasBudget, hasPin, hasTransaction]);
  const completed = steps.filter((step) => step.complete).length;
  const allComplete = completed === steps.length;
  const pristine = completed === 0;

  useEffect(() => {
    if (!userId) return;
    const key = onboardingStorageKey(userId);
    const saved = window.localStorage.getItem(key);
    if (saved === "active" || (!saved && pristine)) {
      window.localStorage.setItem(key, "active");
      setVisible(true);
    }
    const reopen = () => {
      setVisible(true);
      setExpanded(true);
    };
    window.addEventListener(ONBOARDING_EVENT, reopen);
    return () => window.removeEventListener(ONBOARDING_EVENT, reopen);
  }, [pristine, userId]);

  if (!visible) return null;

  const dismiss = (status: "dismissed" | "completed") => {
    window.localStorage.setItem(onboardingStorageKey(userId), status);
    setVisible(false);
  };
  const runAction = (step: OnboardingStepId) => {
    setExpanded(false);
    onAction(step);
  };

  return (
    <div className="onboarding-guide-shell">
      <section className={`onboarding-guide${expanded ? " expanded" : ""}${allComplete ? " complete" : ""}`} aria-labelledby="onboarding-title">
        <div className="onboarding-guide-heading">
          <span className="onboarding-guide-mark" aria-hidden="true">{allComplete ? <Check size={18} weight="bold" /> : <Sparkle size={18} weight="fill" />}</span>
          <button className="onboarding-guide-summary" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
            <span>
              <strong id="onboarding-title">{allComplete ? "Your ledger is ready" : "Set up your ledger"}</strong>
              <small>{allComplete ? "You finished the essentials." : `${completed} of ${steps.length} essentials complete`}</small>
            </span>
            <CaretDown size={17} className={expanded ? "rotated" : undefined} />
          </button>
          <button className="onboarding-guide-close" type="button" onClick={() => dismiss(allComplete ? "completed" : "dismissed")} aria-label={allComplete ? "Finish setup guide" : "Dismiss setup guide"}><X size={17} /></button>
        </div>

        <div className="onboarding-progress" aria-label={`${completed} of ${steps.length} setup steps complete`}>
          <span style={{ "--onboarding-progress": completed / steps.length } as CSSProperties} />
        </div>

        {expanded && (
          <div className="onboarding-guide-body">
            <p>{allComplete ? "Your first money system is in place. Keep recording transactions and the dashboard will become more useful over time." : "Four real actions, about three minutes. You can keep using the app while you finish."}</p>
            {!allComplete && <ol className="onboarding-steps">
              {steps.map((step) => {
                const Icon = step.icon;
                const current = !step.complete && steps.find((candidate) => !candidate.complete)?.id === step.id;
                return <li key={step.id} className={`${step.complete ? "done" : ""}${current ? " current" : ""}`}>
                  <span className="onboarding-step-icon" aria-hidden="true">{step.complete ? <Check size={16} weight="bold" /> : <Icon size={18} weight="duotone" />}</span>
                  <span className="onboarding-step-copy"><strong>{step.title}</strong><small>{step.detail}</small></span>
                  {!step.complete && <button type="button" className={current ? "primary-button small" : "text-button"} onClick={() => runAction(step.id)}>{step.action}</button>}
                </li>;
              })}
            </ol>}
            <div className="onboarding-guide-actions">
              {allComplete
                ? <button type="button" className="primary-button small" onClick={() => dismiss("completed")}>Start using my ledger</button>
                : <button type="button" className="text-button" onClick={() => dismiss("dismissed")}>I’ll explore on my own</button>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
