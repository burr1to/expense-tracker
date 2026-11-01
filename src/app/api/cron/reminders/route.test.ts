import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { user: { findMany: vi.fn() } },
  send: vi.fn(),
  configured: vi.fn(() => true),
}));

vi.mock("../../../../lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("../../../../lib/receipt-storage", () => ({ removeStoredReceipts: vi.fn() }));
vi.mock("../../../../lib/reminder-mail", () => ({ sendReminderEmail: mocks.send, reminderEmailConfigured: mocks.configured }));

import { GET } from "./route";

const call = (authorization?: string) => GET(new Request("https://syr.example/api/cron/reminders", { headers: authorization ? { authorization } : {} }));
const users = (from: number, count: number) => Array.from({ length: count }, (_, index) => ({ id: `user-${String(from + index).padStart(3, "0")}` }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.stubEnv("BETTER_AUTH_URL", "https://app.example");
  mocks.configured.mockReturnValue(true);
  mocks.send.mockResolvedValue("sent");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("GET /api/cron/reminders", () => {
  it("is unavailable until CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await call("Bearer s3cret");
    expect(response.status).toBe(503);
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong bearer token", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call("s3cret")).status).toBe(401);
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
  });

  it("does nothing when mail cannot be sent", async () => {
    mocks.configured.mockReturnValue(false);
    expect((await call("Bearer s3cret")).status).toBe(503);
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
  });

  it("walks everyone still waiting for today's email in batches", async () => {
    mocks.db.user.findMany.mockResolvedValueOnce(users(0, 25)).mockResolvedValueOnce(users(25, 3));
    mocks.send.mockImplementation(async (id: string) => id === "user-002" ? "failed" : id === "user-003" ? "nothing-due" : "sent");
    const response = await call("Bearer s3cret");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, complete: true, sent: 26, failed: 1, "nothing-due": 1 });
    expect(mocks.send).toHaveBeenCalledTimes(28);
    expect(mocks.send).toHaveBeenCalledWith("user-000", { today: body.today, appUrl: "https://app.example" });
    const [first, second] = mocks.db.user.findMany.mock.calls.map(([query]) => query);
    expect(first.where).toEqual({ emailReminders: true, OR: [{ lastReminderEmailOn: null }, { lastReminderEmailOn: { not: new Date(`${body.today}T00:00:00.000Z`) } }] });
    expect(first.take).toBe(25);
    expect(second.where.id).toEqual({ gt: "user-024" });
  });

  it("keeps going when one person's run throws", async () => {
    mocks.db.user.findMany.mockResolvedValueOnce(users(0, 2));
    mocks.send.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce("sent");
    const body = await (await call("Bearer s3cret")).json();
    expect(body).toMatchObject({ failed: 1, sent: 1, complete: true });
  });
});
