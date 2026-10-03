"use client";

import { useEffect, useRef } from "react";

/** Shakes the message when it changes, and leaves it on screen until the caller clears it. */
export function FormError({ message }: { message?: string | null }) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !message) return;
    box.classList.remove("is-shaking");
    void box.offsetWidth;
    box.classList.add("is-shaking");
  }, [message]);

  if (!message) return null;
  return (
    <div className="t-input-wrap is-error form-error" role="alert">
      <div ref={boxRef} className="t-input is-error is-shaking">{message}</div>
    </div>
  );
}
