"use client";

import { useEffect, useRef } from "react";

/**
 * Phone back gesture closes the top-most sheet, drawer or panel instead of leaving the page.
 *
 * Each open overlay owns one same-URL history entry marked with its depth. Next's App Router
 * reads `history.state` too: entries are pushed with the current state spread in (so `__NA` and
 * the router tree stay, and Next's patched `pushState` passes them straight through), and Next
 * keeps custom state on back/forward, so its own traversal to the same URL changes nothing.
 *
 * Entries are counted, not named: closing one sheet and opening another in the same tick reuses
 * the entry, and the history is reconciled once per tick.
 */

export const OVERLAY_MARKER = "__syrOverlay";

export interface OverlayHistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string): void;
  replaceState(data: unknown, unused: string): void;
  go(delta: number): void;
}

interface NavigateEventLike { navigationType?: string; destination?: { index?: number } }
interface NavigationLike {
  currentEntry?: { index?: number } | null;
  addEventListener(type: "navigate", listener: (event: NavigateEventLike) => void): void;
}

export interface OverlayWindowLike {
  history: OverlayHistoryLike;
  navigation?: NavigationLike;
  addEventListener(type: "popstate", listener: (event: { state: unknown }) => void): void;
  setTimeout(callback: () => void, ms: number): unknown;
}

interface OverlayEntry {
  close: () => void;
  leaveOnNavigate: boolean;
  /** Asked to close by a back press; not counted until it closes or refuses. */
  closing: boolean;
}

/** How many overlay entries sit above the page's own entry, read from a history state. */
export function overlayDepth(state: unknown): number {
  const value = state && typeof state === "object" ? (state as Record<string, unknown>)[OVERLAY_MARKER] : undefined;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

const withDepth = (state: unknown, level: number) => {
  const next: Record<string, unknown> = { ...(state && typeof state === "object" ? state : {}) };
  if (level > 0) next[OVERLAY_MARKER] = level;
  else delete next[OVERLAY_MARKER];
  return next;
};

/** A sheet that refuses a back press (busy saving) gets its entry back after this long. */
const REFUSED_CLOSE_MS = 400;
/** If one of our history.go() calls never reports back, stop waiting for it. */
const TRAVERSAL_TIMEOUT_MS = 1000;

export function createOverlayHistory(win: OverlayWindowLike) {
  const stack: OverlayEntry[] = [];
  // Overlay entries we pushed that are still on top of the page entry, as far as we know.
  let depth = 0;
  // Our own history.go() calls whose popstate has not arrived yet.
  let traversals = 0;
  let traversalToken = 0;
  let afterTraversal: (() => void) | null = null;
  let queued = false;
  let listening = false;
  let traverseForward = false;

  const wanted = () => stack.filter((entry) => !entry.closing).length;
  const schedule = () => {
    if (queued) return;
    queued = true;
    win.setTimeout(flush, 0);
  };
  const settle = () => {
    const next = afterTraversal;
    afterTraversal = null;
    next?.();
    schedule();
  };
  const traverse = (delta: number) => {
    traversals += 1;
    const token = ++traversalToken;
    win.history.go(delta);
    win.setTimeout(() => {
      if (token !== traversalToken || traversals === 0) return;
      traversals = 0;
      settle();
    }, TRAVERSAL_TIMEOUT_MS);
  };

  function flush() {
    queued = false;
    if (traversals > 0) return; // runs again when our traversal lands
    // Trust what is on top: a page navigation (or Next replacing the entry) leaves no marker,
    // so our entries are buried and must not be popped from under the new page.
    depth = overlayDepth(win.history.state);
    const target = wanted();
    if (target > depth) {
      for (let level = depth + 1; level <= target; level += 1) win.history.pushState(withDepth(win.history.state, level), "");
      depth = target;
    } else if (target < depth) {
      const steps = depth - target;
      depth = target;
      traverse(-steps);
    }
  }

  function onPopState(event: { state: unknown }) {
    const landed = overlayDepth(event.state);
    depth = landed;
    if (traversals > 0) {
      traversals -= 1;
      if (traversals === 0) settle();
      return;
    }
    const open = wanted();
    if (landed < open) {
      // Back gesture: close every overlay above the entry we landed on, top-most first.
      const above = stack.filter((entry) => !entry.closing).slice(landed).reverse();
      for (const entry of above) {
        entry.closing = true;
        entry.close();
        win.setTimeout(() => {
          if (!stack.includes(entry) || !entry.closing) return;
          entry.closing = false;
          schedule();
        }, REFUSED_CLOSE_MS);
      }
    } else if (landed > open) {
      // An entry left behind by a sheet that was open when the page changed (or before a reload).
      if (traverseForward) {
        // Going forward: keep the entry but make it a plain copy of the page, so forward still works.
        win.history.replaceState(withDepth(win.history.state, open), "");
        depth = open;
      } else {
        traverse(open - landed);
        return;
      }
    }
    schedule();
  }

  function listen() {
    if (listening) return;
    listening = true;
    win.addEventListener("popstate", onPopState);
    win.navigation?.addEventListener("navigate", (event) => {
      if (event.navigationType !== "traverse") return;
      const from = win.navigation?.currentEntry?.index;
      const to = event.destination?.index;
      traverseForward = typeof from === "number" && typeof to === "number" && to > from;
    });
  }

  return {
    /** Registers an open overlay; the returned function unregisters it. */
    register(close: () => void, leaveOnNavigate = true) {
      listen();
      const entry: OverlayEntry = { close, leaveOnNavigate, closing: false };
      stack.push(entry);
      schedule();
      return () => {
        const index = stack.indexOf(entry);
        if (index < 0) return;
        stack.splice(index, 1);
        schedule();
      };
    },
    /**
     * Leaves the page from inside an overlay: closes the overlays that should not outlive it,
     * takes their history entries back off first, then runs `go` (a router push), so the new
     * page lands where they were instead of on top of entries that no longer mean anything.
     */
    navigateFrom(go: () => void) {
      let leaving = 0;
      for (let index = stack.length - 1; index >= 0 && stack[index].leaveOnNavigate; index -= 1) leaving += 1;
      const closing = stack.splice(stack.length - leaving, leaving);
      for (const entry of closing.reverse()) entry.close();
      const current = overlayDepth(win.history.state);
      const unwind = Math.min(leaving, Math.max(0, current - wanted()));
      if (!unwind || traversals > 0) {
        go();
        return;
      }
      depth = current - unwind;
      afterTraversal = go;
      traverse(-unwind);
    },
    /** For tests. */
    snapshot: () => ({ open: stack.length, depth, traversals }),
  };
}

let shared: ReturnType<typeof createOverlayHistory> | null = null;
function overlayHistory() {
  shared ??= createOverlayHistory(window as unknown as OverlayWindowLike);
  return shared;
}

/**
 * While `open`, a back press calls `onClose` instead of leaving the page. Closing it any other
 * way (X, backdrop, Escape) takes its history entry back off, but only while that entry is on top.
 * `leaveOnNavigate: false` keeps it open when a page change starts from an overlay above it.
 */
export function useBackToClose(open: boolean, onClose: () => void, options: { leaveOnNavigate?: boolean } = {}) {
  const closeRef = useRef(onClose);
  const leaveOnNavigate = options.leaveOnNavigate ?? true;
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    return overlayHistory().register(() => closeRef.current(), leaveOnNavigate);
  }, [leaveOnNavigate, open]);
}

/** Runs a router push from inside an overlay without leaving stale back-gesture entries behind. */
export function navigateFromOverlay(go: () => void) {
  if (typeof window === "undefined") {
    go();
    return;
  }
  overlayHistory().navigateFrom(go);
}
