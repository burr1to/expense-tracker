"use client";

import { useEffect, useState } from "react";
import { todayInput } from "./dates";

/**
 * Today's date in Kathmandu ('YYYY-MM-DD'), kept current in a tab left open overnight:
 * it re-reads the clock when the page becomes visible or focused, and once a minute.
 */
export function useToday(): string {
  const [today, setToday] = useState(todayInput);
  useEffect(() => {
    const check = () => setToday((current) => {
      const next = todayInput();
      return next === current ? current : next;
    });
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    const interval = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, []);
  return today;
}
