"use client";

import { DotsThree, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { reminderBadgeText } from "../lib/reminder-badge";
import { useBackToClose } from "../lib/use-back-to-close";

/**
 * The top-right quick actions. On wide screens they sit in a row; on phones they fold behind a
 * single "…" button and pop out to its left when opened, so they stop covering page content.
 */
export function FloatingActions({ children, closeSignal, badgeCount = 0 }: { children: ReactNode; closeSignal?: unknown; /** Urgent reminders, shown on the folded "…" button so they are never hidden on phones. */ badgeCount?: number }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setOpen(false); }, [closeSignal]);
  useBackToClose(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape peels one layer at a time: an open panel (like reminders) closes first and keeps its own focus.
      if (rootRef.current?.querySelector(".floating-actions-items [aria-expanded='true']")) return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="floating-actions" data-open={open}>
      <div id="floating-actions-items" className="floating-actions-items">{children}</div>
      <button
        ref={toggleRef}
        type="button"
        className="floating-actions-toggle"
        aria-expanded={open}
        aria-controls="floating-actions-items"
        aria-label={open ? "Hide quick actions" : badgeCount > 0 ? `Show quick actions, ${badgeCount} urgent ${badgeCount === 1 ? "reminder" : "reminders"}` : "Show quick actions"}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="t-icon-swap" data-state={open ? "b" : "a"} aria-hidden="true">
          <span className="t-icon" data-icon="a"><DotsThree size={22} weight="bold" /></span>
          <span className="t-icon" data-icon="b"><X size={18} weight="bold" /></span>
        </span>
        {badgeCount > 0 && !open && <span className="floating-actions-badge" aria-hidden="true">{reminderBadgeText(badgeCount)}</span>}
      </button>
    </div>
  );
}
