"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode, type TransitionEvent } from "react";

const EXIT_DURATION_MS = 320;

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
  const [visible, setVisible] = useState(false);
  const exitFinished = useRef(false);
  const onExitedRef = useRef(onExited);

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
      const frame = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }

    setVisible(false);
    const timer = window.setTimeout(finishExit, EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [finishExit, open]);

  if (!mounted) return null;

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (dismissOnBackdrop && event.target === event.currentTarget) void onClose?.();
  };
  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (!open && !visible && event.target === event.currentTarget && event.propertyName === "opacity") finishExit();
  };

  return <div
    className={["modal-backdrop", className].filter(Boolean).join(" ")}
    data-state={visible ? "open" : "closed"}
    aria-hidden={!visible}
    role="presentation"
    onMouseDown={handleBackdropMouseDown}
    onTransitionEnd={handleTransitionEnd}
  >{children}</div>;
}
