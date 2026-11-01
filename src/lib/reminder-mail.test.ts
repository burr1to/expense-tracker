import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    dueItem: { findMany: vi.fn() },
    recurringEntry: { findMany: vi.fn() },
    customCategory: { findMany: vi.fn(async () => []) },
  },
  send: vi.fn(),
}));

vi.mock("./prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("./receipt-storage", () => ({ removeStoredReceipts: vi.fn() }));
vi.mock("./outbound-mail", async (importOriginal) => ({ ...await importOriginal<typeof import("./outbound-mail")>(), sendLedgerEmail: mocks.send }));

import { reminderEmailHtml, sendReminderEmail } from "./reminder-mail";

const db = mocks.db;
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const openDue = { id: "due-1", userId: "user-1", kind: "payment", title: "Internet <fiber>", person: "WorldLink", amountMinor: 150_000, category: "utilities", occurredOn: null, dueOn: day("2026-10-08"), remindOn: null, snoozedUntil: null, note: "", status: "open", annualRatePercent: null, completedOn: null, createdAt: day("2026-10-01"), payments: [{ amountMinor: 50_000 }] };

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue({ email: "me@example.com", emailReminders: true, lastReminderEmailOn: day("2026-10-06"), currency: "NPR" });
  db.dueItem.findMany.mockResolvedValue([openDue]);
  db.recurringEntry.findMany.mockResolvedValue([]);
  mocks.send.mockResolvedValue("sent");
});

describe("sendReminderEmail", () => {
  it("sends the digest with currency amounts, then records the day", async () => {
    await expect(sendReminderEmail("user-1", { today: "2026-10-07", appUrl: "https://syr.example/" })).resolves.toBe("sent");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const [to, subject, html] = mocks.send.mock.calls[0];
    expect([to, subject]).toEqual(["me@example.com", "SaveYoRupee reminder"]);
    expect(html).toMatch(/Internet &lt;fiber&gt;<\/strong> — WorldLink · NPR\s1,000 due tomorrow/);
    expect(html).toContain('href="https://syr.example/"');
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { lastReminderEmailOn: day("2026-10-07") } });
    expect(db.user.update.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.send.mock.invocationCallOrder[0]);
    expect(db.dueItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1", status: "open" } }));
  });

  it("leaves the day open when the send fails, so the next trigger retries", async () => {
    mocks.send.mockRejectedValue(new Error("Could not send email."));
    await expect(sendReminderEmail("user-1", { today: "2026-10-07" })).resolves.toBe("failed");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("leaves the day open when mail is not configured", async () => {
    mocks.send.mockResolvedValue("unconfigured");
    await expect(sendReminderEmail("user-1", { today: "2026-10-07" })).resolves.toBe("unconfigured");
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("sends at most once a day and only when switched on", async () => {
    db.user.findUnique.mockResolvedValueOnce({ email: "me@example.com", emailReminders: true, lastReminderEmailOn: day("2026-10-07"), currency: "NPR" });
    await expect(sendReminderEmail("user-1", { today: "2026-10-07" })).resolves.toBe("already-sent");
    db.user.findUnique.mockResolvedValueOnce({ email: "me@example.com", emailReminders: false, lastReminderEmailOn: null, currency: "NPR" });
    await expect(sendReminderEmail("user-1", { today: "2026-10-07" })).resolves.toBe("off");
    db.user.findUnique.mockResolvedValueOnce(null);
    await expect(sendReminderEmail("user-1", { today: "2026-10-07" })).resolves.toBe("off");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("records a quiet day without sending anything", async () => {
    db.dueItem.findMany.mockResolvedValue([{ ...openDue, dueOn: day("2026-11-30") }]);
    await expect(sendReminderEmail("user-1", { today: "2026-10-07" })).resolves.toBe("nothing-due");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });

  it("names a recurring entry without a note by its category", async () => {
    db.dueItem.findMany.mockResolvedValue([]);
    db.recurringEntry.findMany.mockResolvedValue([{ id: "r1", active: true, kind: "expense", note: "", category: "custom-1", amountMinor: 2_000_000, nextDueOn: day("2026-10-07") }]);
    db.customCategory.findMany.mockResolvedValue([{ id: "custom-1", name: "Hostel fee" }] as never);
    await sendReminderEmail("user-1", { today: "2026-10-07" });
    expect(mocks.send.mock.calls[0][2]).toMatch(/Hostel fee<\/strong> — NPR\s20,000 expense is due today/);
  });
});

describe("reminderEmailHtml", () => {
  it("escapes the app link", () => {
    expect(reminderEmailHtml([], "https://a.example/\"x")).toContain('href="https://a.example/&quot;x/"');
  });
});
