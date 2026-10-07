import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOverlayHistory, overlayDepth, OVERLAY_MARKER, type OverlayWindowLike } from "./use-back-to-close";

/** A same-document session history: pushState truncates forward entries, go() reports back later via popstate. */
function fakeWindow(initialUrl = "/") {
  const entries: { url: string; state: unknown }[] = [{ url: initialUrl, state: { __NA: true, tree: initialUrl } }];
  let index = 0;
  const listeners: ((event: { state: unknown }) => void)[] = [];
  const win: OverlayWindowLike & { entries: typeof entries; index: () => number; back: () => void; routerPush: (url: string) => void; url: () => string } = {
    history: {
      get state() { return entries[index].state; },
      pushState(data) { entries.splice(index + 1); entries.push({ url: entries[index].url, state: data }); index += 1; },
      replaceState(data) { entries[index] = { ...entries[index], state: data }; },
      go(delta) {
        setTimeout(() => {
          const next = Math.min(entries.length - 1, Math.max(0, index + delta));
          if (next === index) return;
          index = next;
          for (const listener of listeners) listener({ state: entries[index].state });
        }, 1);
      },
    },
    addEventListener: (_type, listener) => { listeners.push(listener); },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    entries,
    index: () => index,
    back: () => win.history.go(-1),
    // Next's router.push: a fresh state without our marker.
    routerPush: (url) => { entries.splice(index + 1); entries.push({ url, state: { __NA: true, tree: url } }); index += 1; },
    url: () => entries[index].url,
  };
  return win;
}

/** An overlay whose close() unregisters it, the way a component's effect cleanup does once `open` is false. */
function overlay(history: ReturnType<typeof createOverlayHistory>, options: { leaveOnNavigate?: boolean; refuse?: boolean } = {}) {
  const item = {
    open: true,
    closeCalls: 0,
    unregister: () => {},
    close() {
      item.closeCalls += 1;
      if (options.refuse || !item.open) return;
      item.open = false;
      item.unregister();
    },
  };
  item.unregister = history.register(() => item.close(), options.leaveOnNavigate ?? true);
  return item;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const settle = () => vi.advanceTimersByTime(5);

describe("overlayDepth", () => {
  it("reads only positive whole depths", () => {
    expect(overlayDepth(null)).toBe(0);
    expect(overlayDepth({ [OVERLAY_MARKER]: 2 })).toBe(2);
    expect(overlayDepth({ [OVERLAY_MARKER]: "2" })).toBe(0);
    expect(overlayDepth({ [OVERLAY_MARKER]: -1 })).toBe(0);
  });
});

describe("createOverlayHistory", () => {
  it("pushes one same-URL entry per open overlay and keeps Next's state on it", () => {
    const win = fakeWindow();
    const history = createOverlayHistory(win);
    overlay(history);
    settle();
    expect(win.entries).toHaveLength(2);
    expect(win.entries[1]).toEqual({ url: "/", state: { __NA: true, tree: "/", [OVERLAY_MARKER]: 1 } });
  });

  it("closes the overlay on a back press without traversing again", () => {
    const win = fakeWindow();
    const history = createOverlayHistory(win);
    const sheet = overlay(history);
    settle();
    win.back();
    settle();
    expect(sheet.open).toBe(false);
    expect(win.index()).toBe(0);
    expect(win.entries).toHaveLength(2);
    expect(history.snapshot()).toEqual({ open: 0, depth: 0, traversals: 0 });
  });

  it("takes its entry back off when closed with the X", () => {
    const win = fakeWindow();
    const history = createOverlayHistory(win);
    const sheet = overlay(history);
    settle();
    sheet.close();
    settle();
    expect(win.index()).toBe(0);
    expect(sheet.closeCalls).toBe(1);
  });

  it("closes only the top-most overlay per back press", () => {
    const win = fakeWindow();
    const history = createOverlayHistory(win);
    const sheet = overlay(history);
    settle();
    const picker = overlay(history);
    settle();
    expect(win.index()).toBe(2);
    win.back();
    settle();
    expect(picker.open).toBe(false);
    expect(sheet.open).toBe(true);
    win.back();
    settle();
    expect(sheet.open).toBe(false);
    expect(win.index()).toBe(0);
  });

  it("reuses the entry when one overlay hands over to another in the same tick", () => {
    const win = fakeWindow();
    const history = createOverlayHistory(win);
    const search = overlay(history);
    settle();
    search.close();
    const sheet = overlay(history);
    settle();
    expect(win.entries).toHaveLength(2);
    expect(win.index()).toBe(1);
    win.back();
    settle();
    expect(sheet.open).toBe(false);
  });

  it("never pops a page that navigated over its entry", () => {
    const win = fakeWindow();
    const history = createOverlayHistory(win);
    const sheet = overlay(history, { leaveOnNavigate: false });
    settle();
    win.routerPush("/dues");
    sheet.close();
    settle();
    expect(win.url()).toBe("/dues");
    expect(win.index()).toBe(2);
  });

  it("unwinds closing overlays before a page change, so back returns to the page", () => {
    const win = fakeWindow();
    const history = createOverlayHistory(win);
    const menu = overlay(history);
    settle();
    const panel = overlay(history);
    settle();
    const go = vi.fn(() => win.routerPush("/dues"));
    history.navigateFrom(go);
    expect(menu.open).toBe(false);
    expect(panel.open).toBe(false);
    expect(go).not.toHaveBeenCalled();
    settle();
    expect(go).toHaveBeenCalledTimes(1);
    expect(win.entries.map((entry) => entry.url)).toEqual(["/", "/dues"]);
    settle();
    expect(win.index()).toBe(1);
  });

  it("keeps a sheet below the overlay that started the page change", () => {
    const win = fakeWindow();
    const history = createOverlayHistory(win);
    const sheet = overlay(history, { leaveOnNavigate: false });
    settle();
    overlay(history);
    settle();
    const go = vi.fn();
    history.navigateFrom(go);
    settle();
    expect(go).toHaveBeenCalledTimes(1);
    expect(sheet.open).toBe(true);
    expect(win.index()).toBe(1);
  });

  it("gives a busy sheet its entry back when it refuses a back press", () => {
    const win = fakeWindow();
    const history = createOverlayHistory(win);
    const sheet = overlay(history, { refuse: true });
    settle();
    win.back();
    settle();
    expect(sheet.closeCalls).toBe(1);
    expect(win.index()).toBe(0);
    vi.advanceTimersByTime(450);
    expect(win.index()).toBe(1);
    expect(overlayDepth(win.history.state)).toBe(1);
  });

  it("steps back past an entry left behind by a sheet open when the page changed", () => {
    const win = fakeWindow();
    const history = createOverlayHistory(win);
    const sheet = overlay(history, { leaveOnNavigate: false });
    settle();
    win.routerPush("/dues");
    sheet.close();
    settle();
    win.back();
    settle();
    settle();
    expect(win.index()).toBe(0);
    expect(win.url()).toBe("/");
  });
});
