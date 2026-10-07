import { describe, expect, it, vi } from "vitest";
import { browserNotificationBlocker, deliverNotification, readAddDeepLink, reminderNotificationText, reminderToastText, rolledOverMonth, SHARED_TEXT_LIMIT } from "./app-shell";

const params = (query: string) => new URLSearchParams(query);

describe("readAddDeepLink", () => {
  it("opens the Add sheet with the shortcut's kind", () => {
    expect(readAddDeepLink(params("add=expense"))).toEqual({ link: { type: "add", kind: "expense" }, rest: "" });
    expect(readAddDeepLink(params("add=income&q=rent"))).toEqual({ link: { type: "add", kind: "income" }, rest: "q=rent" });
  });

  it("opens the SMS sheet from the shortcut or a share, preferring the shared text", () => {
    expect(readAddDeepLink(params("add=sms")).link).toEqual({ type: "sms" });
    expect(readAddDeepLink(params("sms=Rs+500+debited&title=NABIL")).link).toEqual({ type: "sms", text: "Rs 500 debited" });
    expect(readAddDeepLink(params("title=Rs+500+debited&sms=")).link).toEqual({ type: "sms", text: "Rs 500 debited" });
    expect(readAddDeepLink(params("sms=" + "9".repeat(SHARED_TEXT_LIMIT + 50))).link).toEqual({ type: "sms", text: "9".repeat(SHARED_TEXT_LIMIT) });
  });

  it("ignores unknown values but still strips the keys it owns", () => {
    expect(readAddDeepLink(params("add=transfer&due=d1"))).toEqual({ link: null, rest: "due=d1" });
    expect(readAddDeepLink(params("due=d1&action=repay"))).toEqual({ link: null, rest: "due=d1&action=repay" });
  });
});

describe("rolledOverMonth", () => {
  it("moves the month on when the shown month just ended", () => {
    const next = rolledOverMonth(new Date(2026, 9, 1), "2026-10-31", "2026-11-01");
    expect(next && [next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2026, 10, 1]);
  });

  it("leaves a month the person picked, and does nothing within a month", () => {
    expect(rolledOverMonth(new Date(2026, 7, 1), "2026-10-31", "2026-11-01")).toBeNull();
    expect(rolledOverMonth(new Date(2026, 9, 1), "2026-10-07", "2026-10-08")).toBeNull();
  });

  it("handles the new year", () => {
    const next = rolledOverMonth(new Date(2026, 11, 15), "2026-12-31", "2027-01-01");
    expect(next && [next.getFullYear(), next.getMonth()]).toEqual([2027, 0]);
  });
});

const notices = [
  { id: "due:1", title: "Internet", body: "NPR 1,500 due today" },
  { id: "due:2", title: "Rent", body: "NPR 20,000 due tomorrow" },
  { id: "due:3", title: "Gym", body: "NPR 3,000 overdue" },
  { id: "due:4", title: "Water", body: "NPR 400 due today" },
];

describe("reminder text", () => {
  it("lists three reminders with amounts and counts the rest", () => {
    expect(reminderNotificationText(notices)).toEqual({ title: "SaveYoRupee reminders", body: "Internet: NPR 1,500 due today\nRent: NPR 20,000 due tomorrow\nGym: NPR 3,000 overdue\nand 1 more" });
  });

  it("drops amounts when amounts are hidden", () => {
    expect(reminderNotificationText(notices.slice(0, 1), true)).toEqual({ title: "SaveYoRupee reminder", body: "Internet" });
  });

  it("keeps the in-app toast free of amounts", () => {
    expect(reminderToastText(notices)).toEqual({ title: "4 things are due soon", body: "Internet, Rent and 2 more. Open the bell to handle them." });
    expect(reminderToastText(notices.slice(0, 1)).body).not.toMatch(/NPR/);
  });
});

describe("deliverNotification", () => {
  it("uses the service worker when one is active", async () => {
    const showNotification = vi.fn(async () => {});
    const createNotification = vi.fn();
    await expect(deliverNotification({ getRegistration: async () => ({ showNotification }), createNotification }, "Hi", { body: "x", tag: "t" })).resolves.toBe("service-worker");
    expect(showNotification).toHaveBeenCalledWith("Hi", { body: "x", tag: "t" });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("falls back to the page constructor, and never throws when Android forbids it", async () => {
    await expect(deliverNotification({ getRegistration: async () => undefined, createNotification: () => ({}) }, "Hi", {})).resolves.toBe("page");
    const illegal = () => { throw new TypeError("Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead."); };
    await expect(deliverNotification({ getRegistration: async () => undefined, createNotification: illegal }, "Hi", {})).resolves.toBe("failed");
    await expect(deliverNotification({ getRegistration: async () => { throw new Error("no"); }, createNotification: illegal }, "Hi", {})).resolves.toBe("failed");
    await expect(deliverNotification({}, "Hi", {})).resolves.toBe("failed");
  });
});

describe("browserNotificationBlocker", () => {
  const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36";
  const iPhone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

  it("asks iPhone users to add the app to the Home Screen", () => {
    expect(browserNotificationBlocker({ hasNotification: false, userAgent: iPhone, standalone: false })).toMatch(/Add SaveYoRupee to your Home Screen to get notifications/);
    expect(browserNotificationBlocker({ hasNotification: false, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5, standalone: false })).toMatch(/Home Screen/);
  });

  it("explains a missing API or a blocked permission, and allows the rest", () => {
    expect(browserNotificationBlocker({ hasNotification: false, userAgent: android, standalone: false })).toMatch(/can’t show notifications/);
    expect(browserNotificationBlocker({ hasNotification: true, permission: "denied", userAgent: android, standalone: false })).toMatch(/blocked/);
    expect(browserNotificationBlocker({ hasNotification: true, permission: "default", userAgent: android, standalone: false })).toBeNull();
    expect(browserNotificationBlocker({ hasNotification: true, permission: "granted", userAgent: iPhone, standalone: true })).toBeNull();
  });
});
