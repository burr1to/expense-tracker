"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

interface SlidingTab<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

export function SlidingTabs<T extends string>({ label, value, onChange, options, className, disabled = false }: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: readonly SlidingTab<T>[];
  className?: string;
  disabled?: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const hasPositioned = useRef(false);
  const signature = options.map((option) => option.id).join("|");

  useLayoutEffect(() => {
    const bar = barRef.current;
    const pill = pillRef.current;
    const active = bar?.querySelector<HTMLButtonElement>("[aria-pressed='true']");
    if (!pill || !active) return;
    const write = (animate: boolean) => {
      if (!animate) {
        const previous = pill.style.transition;
        pill.style.transition = "none";
        pill.style.transform = `translateX(${active.offsetLeft}px)`;
        pill.style.width = `${active.offsetWidth}px`;
        void pill.offsetWidth;
        pill.style.transition = previous;
      } else {
        pill.style.transform = `translateX(${active.offsetLeft}px)`;
        pill.style.width = `${active.offsetWidth}px`;
      }
    };
    write(hasPositioned.current);
    hasPositioned.current = true;
    const onResize = () => {
      const next = bar?.querySelector<HTMLButtonElement>("[aria-pressed='true']");
      if (!next) return;
      const previous = pill.style.transition;
      pill.style.transition = "none";
      pill.style.transform = `translateX(${next.offsetLeft}px)`;
      pill.style.width = `${next.offsetWidth}px`;
      void pill.offsetWidth;
      pill.style.transition = previous;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [signature, value]);

  return (
    <div ref={barRef} className={className ? `t-tabs ${className}` : "t-tabs"} role="group" aria-label={label}>
      <span ref={pillRef} className="t-tabs-pill" aria-hidden="true" />
      {options.map((option) => (
        <button key={option.id} type="button" className="t-tab" aria-pressed={value === option.id} disabled={disabled} onClick={() => onChange(option.id)}>
          {option.icon}{option.label}
        </button>
      ))}
    </div>
  );
}
