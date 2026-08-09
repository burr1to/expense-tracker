"use client";

import { ArrowRight, Bank, CaretDown, Check, DownloadSimple, ListBullets, LockKey, Sparkle, Swatches, UploadSimple, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { TRANSACTION_CSV_TEMPLATE } from "../lib/csv";
import { ONBOARDING_EVENT, markOnboardingStep, onboardingStorageKey, readOnboardingProgress, type OnboardingProgress, type OnboardingStepId } from "../lib/onboarding";

interface OnboardingGuideProps {
  userId: string;
  hasPin: boolean;
  hasAccount: boolean;
  hasTransaction: boolean;
  hasCustomizations: boolean;
  onAction: (step: OnboardingStepId) => void;
}

export function OnboardingGuide({ userId, hasPin, hasAccount, hasTransaction, hasCustomizations, onAction }: OnboardingGuideProps) {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [progress, setProgress] = useState<OnboardingProgress>({});
  const steps = useMemo(() => [
    { id: "pin" as const, title: "Protect your ledger", detail: "Create a short PIN for private balances and account setup.", complete: hasPin, icon: LockKey, action: "Set PIN", optional: false },
    { id: "account" as const, title: "Create an account", detail: "Add the bank or digital wallet you want to track.", complete: hasAccount, icon: Bank, action: "Add account", optional: false },
    { id: "import" as const, title: "Bring in past history", detail: "Import old transactions from a template, or skip this if you are starting fresh.", complete: progress.import === true, icon: UploadSimple, action: "Review import", optional: true },
    { id: "customize" as const, title: "Shape your categories", detail: "Browse built-in options, then add any custom categories or subcategories you need.", complete: progress.customize === true || hasCustomizations, icon: Swatches, action: "Open categories", optional: true },
    { id: "transaction" as const, title: "Add your first transaction", detail: "Record one real expense or income so your dashboard has a starting point.", complete: progress.transaction === true || (hasTransaction && progress.import !== true), icon: ListBullets, action: "Add transaction", optional: false },
  ], [hasAccount, hasCustomizations, hasPin, hasTransaction, progress.customize, progress.import, progress.transaction]);
  const completed = steps.filter((step) => step.complete).length;
  const allComplete = completed === steps.length;
  const pristine = completed === 0;
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${TRANSACTION_CSV_TEMPLATE}`)}`;

  useEffect(() => {
    if (!userId) return;
    setProgress(readOnboardingProgress(userId));
    const key = onboardingStorageKey(userId);
    const saved = window.localStorage.getItem(key);
    if (saved === "active" || (!saved && pristine)) {
      window.localStorage.setItem(key, "active");
      setVisible(true);
    }
    const handleEvent = (event: Event) => {
      setProgress(readOnboardingProgress(userId));
      const detail = (event as CustomEvent<{ type?: string }>).detail;
      if (detail?.type === "reopen") {
        setVisible(true);
        setExpanded(true);
      }
    };
    window.addEventListener(ONBOARDING_EVENT, handleEvent);
    return () => window.removeEventListener(ONBOARDING_EVENT, handleEvent);
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
  const skip = (step: OnboardingStepId) => markOnboardingStep(userId, step);

  return (
    <div className="onboarding-guide-shell">
      <section className={`onboarding-guide${expanded ? " expanded" : ""}${allComplete ? " complete" : ""}`} aria-labelledby="onboarding-title">
        <div className="onboarding-guide-heading">
          <span className="onboarding-guide-mark" aria-hidden="true">{allComplete ? <Check size={18} weight="bold" /> : <Sparkle size={18} weight="fill" />}</span>
          <button className="onboarding-guide-summary" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
            <span>
              <strong id="onboarding-title">{allComplete ? "Your ledger is ready" : "Set up your ledger"}</strong>
              <small>{allComplete ? "You finished the essentials." : `${completed} of ${steps.length} setup steps complete`}</small>
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
            <p>{allComplete ? "Your first money system is in place. Keep recording transactions and the dashboard will become more useful over time." : "We’ll take this one step at a time. Past imports are optional, and reconciliation comes later when you are ready to check an account."}</p>
            {!allComplete && <ol className="onboarding-steps">
              {steps.map((step) => {
                const Icon = step.icon;
                const current = !step.complete && steps.find((candidate) => !candidate.complete)?.id === step.id;
                return <li key={step.id} className={`${step.complete ? "done" : ""}${current ? " current" : ""}`}>
                  <span className="onboarding-step-icon" aria-hidden="true">{step.complete ? <Check size={16} weight="bold" /> : <Icon size={18} weight="duotone" />}</span>
                  <span className="onboarding-step-copy">
                    <strong>{step.title}</strong>
                    <small>{step.detail}</small>
                    {current && step.id === "import" && <small className="onboarding-step-note">Import adds historical transactions only. It does not reconcile or change an account balance.</small>}
                    {current && step.id === "customize" && <small className="onboarding-step-note">The next screen shows both custom categories and subcategories together.</small>}
                  </span>
                  {!step.complete && <div className="onboarding-step-actions">
                    {current ? <button type="button" className="primary-button small" onClick={() => runAction(step.id)}>{step.action}<ArrowRight size={15} /></button> : <span className="onboarding-step-waiting">Finish the step above</span>}
                    {current && step.id === "import" && <a className="text-button onboarding-template-link" href={templateHref} download="transaction-import-template.csv"><DownloadSimple size={14} />Template</a>}
                    {current && step.optional && <button type="button" className="text-button onboarding-skip" onClick={() => skip(step.id)}>Skip for now</button>}
                  </div>}
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
