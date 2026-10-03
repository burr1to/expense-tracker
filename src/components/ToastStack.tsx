"use client";

import { CheckCircle, Info, ShieldCheck, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TOAST_ACTION_DURATION_MS, TOAST_DURATION_MS, type ToastItem } from "../context/ToastContext";
import { ButtonSpinner } from "./ButtonSpinner";

const STACK_GAP = 8;
const PEEK = 10;
const VISIBLE_WHEN_COLLAPSED = 3;

const toneIcon = {
  success: <CheckCircle size={20} weight="fill" />,
  neutral: <Info size={20} weight="fill" />,
  danger: <Trash size={19} />,
  security: <ShieldCheck size={20} weight="fill" />,
};

export function ToastStack({ toasts, onDismiss, onAction }: { toasts: ToastItem[]; onDismiss: (id: string) => void; onAction: (id: string) => void }) {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const expanded = hovered || focused;
  const paused = expanded || pageHidden;

  useEffect(() => {
    const sync = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  useEffect(() => { if (!toasts.length) { setHovered(false); setFocused(false); } }, [toasts.length]);

  const measure = useCallback((id: string, height: number) => setHeights((current) => current[id] === height ? current : { ...current, [id]: height }), []);
  const live = toasts.filter((toast) => !toast.leaving);
  const frontHeight = heights[live[0]?.id ?? toasts[0]?.id] ?? 0;
  let offset = 0;
  const layout = toasts.map((toast) => {
    const index = live.indexOf(toast);
    const position = index === -1 ? 0 : index;
    const y = expanded ? offset : position * PEEK;
    if (index !== -1) offset += (heights[toast.id] ?? 0) + STACK_GAP;
    return { toast, position, y };
  });
  const stackHeight = expanded ? Math.max(0, offset - STACK_GAP) : frontHeight + Math.max(0, Math.min(live.length - 1, VISIBLE_WHEN_COLLAPSED - 1)) * PEEK;

  if (!toasts.length) return null;
  return (
    <section
      className="toast-stack"
      aria-label="Notifications"
      data-expanded={expanded}
      style={{ height: stackHeight, "--front-height": `${frontHeight}px` } as React.CSSProperties}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
    >
      {layout.map(({ toast, position, y }) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          position={position}
          y={y}
          expanded={expanded}
          paused={paused}
          onMeasure={measure}
          onDismiss={onDismiss}
          onAction={onAction}
        />
      ))}
    </section>
  );
}

function ToastCard({ toast, position, y, expanded, paused, onMeasure, onDismiss, onAction }: {
  toast: ToastItem; position: number; y: number; expanded: boolean; paused: boolean;
  onMeasure: (id: string, height: number) => void; onDismiss: (id: string) => void; onAction: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const duration = toast.duration ?? (toast.action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS);
  const remaining = useRef(duration);
  const holding = paused || toast.actionPending || toast.leaving;

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const report = () => onMeasure(toast.id, node.getBoundingClientRect().height);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, [onMeasure, toast.id]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  // A failed action restarts the countdown so the message stays long enough to read.
  useEffect(() => { remaining.current = duration; }, [duration, toast.revision]);
  useEffect(() => {
    if (holding) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [holding, onDismiss, toast.id, toast.revision]);

  const tone = toast.tone ?? "success";
  const hiddenBehind = !expanded && position >= VISIBLE_WHEN_COLLAPSED;
  const scale = expanded ? 1 : 1 - position * 0.05;
  return (
    <div
      ref={ref}
      className={`toast-card is-${tone}`}
      role={toast.actionError ? "alert" : "status"}
      aria-live={toast.actionError ? "assertive" : "polite"}
      aria-hidden={hiddenBehind || undefined}
      data-mounted={mounted}
      data-leaving={toast.leaving}
      data-front={position === 0}
      style={{ "--toast-y": `${-y}px`, "--toast-scale": scale, zIndex: 100 - position, opacity: hiddenBehind ? 0 : undefined } as React.CSSProperties}
    >
      <span className="toast-icon" aria-hidden="true">{toast.actionError ? <WarningCircle size={20} weight="fill" /> : toast.icon ?? toneIcon[tone]}</span>
      <span className="toast-copy">
        <strong>{toast.title}</strong>
        {(toast.actionError || toast.body || toast.amount) && (
          <small>
            {toast.actionError ?? toast.body}
            {!toast.actionError && toast.amount && <span className="toast-amount">{toast.amount}</span>}
          </small>
        )}
      </span>
      {toast.action && (
        <button type="button" className="toast-action" disabled={toast.actionPending} onClick={() => onAction(toast.id)} tabIndex={hiddenBehind ? -1 : undefined}>
          {toast.actionPending && <ButtonSpinner />}{toast.actionError ? "Try again" : toast.action.label}
        </button>
      )}
      <button type="button" className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification" tabIndex={hiddenBehind ? -1 : undefined}><X size={15} /></button>
      {toast.action && <i key={toast.revision} className="toast-progress" aria-hidden="true" style={{ "--toast-duration": `${duration}ms`, animationPlayState: holding ? "paused" : "running" } as React.CSSProperties} />}
    </div>
  );
}
