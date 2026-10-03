"use client";

import { FocusTrap } from "@mantine/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type TransitionEvent } from "react";

const activeOverlays: HTMLDivElement[] = [];
let previousOverflow = "";
let previousPadding = "";

function modalCloseMs() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
  const token = getComputedStyle(document.documentElement).getPropertyValue("--modal-close-dur").trim();
  const value = parseFloat(token);
  return Number.isFinite(value) ? value * (token.endsWith("ms") ? 1 : 1000) : 150;
}

interface AnimatedOverlayProps {
  open: boolean;
  children: ReactNode;
  className?: string;
  dismissOnBackdrop?: boolean;
  onClose?: () => void | Promise<void>;
  onExited?: () => void;
}

/** Keeps custom dialogs mounted long enough for their exit motion to finish. */
export function AnimatedOverlay({ open, children, className, dismissOnBackdrop = false, onClose, onExited }: AnimatedOverlayProps) {
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<"pre" | "open" | "closing">("pre");
  const exitFinished = useRef(false);
  const onExitedRef = useRef(onExited);
  const onCloseRef = useRef(onClose);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const container = containerRef.current;
    if (!mounted || !container) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (activeOverlays.length === 0) {
      previousOverflow = document.body.style.overflow;
      previousPadding = document.body.style.paddingRight;
      const scrollbar = window.innerWidth - document.documentElement.clientWidth;
      if (scrollbar > 0) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbar}px`;
      document.body.style.overflow = "hidden";
    }
    activeOverlays.push(container);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || activeOverlays.at(-1) !== container || event.defaultPrevented) return;
      if (container.querySelector('[aria-busy="true"]')) return;
      if (onCloseRef.current) {
        event.preventDefault();
        void onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const index = activeOverlays.indexOf(container);
      if (index >= 0) activeOverlays.splice(index, 1);
      if (activeOverlays.length === 0) {
        document.body.style.overflow = previousOverflow;
        document.body.style.paddingRight = previousPadding;
      }
      if (trigger?.isConnected && (!activeOverlays.length || activeOverlays.at(-1)?.contains(trigger))) trigger.focus({ preventScroll: true });
    };
  }, [mounted]);

  useEffect(() => {
    onExitedRef.current = onExited;
  }, [onExited]);

  const finishExit = useCallback(() => {
    if (open || exitFinished.current) return;
    exitFinished.current = true;
    setMounted(false);
    onExitedRef.current?.();
  }, [open]);

  useEffect(() => {
    exitFinished.current = false;
    if (open) {
      setMounted(true);
      return;
    }

    setPhase("closing");
    const timer = window.setTimeout(finishExit, modalCloseMs());
    return () => window.clearTimeout(timer);
  }, [finishExit, open]);

  useLayoutEffect(() => {
    if (!open || !mounted) return;
    // Commit the resting style before entering; reopening can reverse an exit.
    void containerRef.current?.offsetWidth;
    const frame = window.requestAnimationFrame(() => setPhase("open"));
    return () => window.cancelAnimationFrame(frame);
  }, [mounted, open]);

  if (!mounted) return null;

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (dismissOnBackdrop && event.target === event.currentTarget) void onClose?.();
  };
  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (!open && phase === "closing" && event.target === event.currentTarget && event.propertyName === "opacity") finishExit();
  };

  const modalClass = phase === "open" ? "t-modal is-open" : phase === "closing" ? "t-modal is-closing" : "t-modal";

  return <div
    ref={containerRef}
    className={["modal-backdrop", className].filter(Boolean).join(" ")}
    data-state={phase === "open" ? "open" : "closed"}
    aria-hidden={phase === "pre" ? true : undefined}
    role="presentation"
    onMouseDown={handleBackdropMouseDown}
    onTransitionEnd={handleTransitionEnd}
  ><FocusTrap active={phase !== "pre"}><div className={modalClass} tabIndex={-1}>{children}</div></FocusTrap></div>;
}
