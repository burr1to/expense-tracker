import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: {}, send: vi.fn() }));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("../../../lib/auth", () => ({ getAuthenticatedSession: vi.fn(async () => ({ user: { id: "user-1" } })) }));
vi.mock("../../../lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("../../../lib/receipt-storage", () => ({ removeStoredReceipts: vi.fn(), verifyStoredReceipt: vi.fn() }));
vi.mock("../../../lib/reminder-mail", () => ({ sendReminderEmail: mocks.send }));

import { POST } from "./route";

const sendDueReminders = () => POST(new Request("https://syr.example/api/ledger", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "sendDueReminders" }),
}));

beforeEach(() => { vi.clearAllMocks(); });

describe("sendDueReminders (the open-app fallback)", () => {
  it("sends through the shared reminder email for the signed-in person only", async () => {
    mocks.send.mockResolvedValue("sent");
    const response = await sendDueReminders();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, result: "sent" });
    expect(mocks.send).toHaveBeenCalledWith("user-1", { appUrl: "https://syr.example" });
  });

  it("answers 502 when the send failed, so the app retries on its next open", async () => {
    mocks.send.mockResolvedValue("failed");
    expect((await sendDueReminders()).status).toBe(502);
  });

  it("is a quiet success when there was nothing to send or it already went out", async () => {
    for (const result of ["nothing-due", "already-sent", "off", "unconfigured"]) {
      mocks.send.mockResolvedValueOnce(result);
      expect((await sendDueReminders()).status).toBe(200);
    }
  });
});
