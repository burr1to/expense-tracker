import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(async () => ({ currency: "NPR" })) },
    householdMember: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    household: { create: vi.fn() },
    activityLog: {
      findMany: vi.fn(async () => [] as { createdAt: Date }[]),
      createManyAndReturn: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => data.map((row, index) => ({ id: `log-${index}`, entityId: null, subject: null, amountMinor: null, changes: null, meta: null, ...row }))),
    },
  },
  sendLedgerEmail: vi.fn(),
  verifyPin: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("../../../lib/auth", () => ({ getAuthenticatedSession: vi.fn(async () => ({ user: { id: "user-2" } })) }));
vi.mock("../../../lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("../../../lib/receipt-storage", () => ({ removeStoredReceipts: vi.fn(), verifyStoredReceipt: vi.fn() }));
vi.mock("../../../lib/outbound-mail", async (importOriginal) => ({ ...await importOriginal<object>(), sendLedgerEmail: mocks.sendLedgerEmail }));
vi.mock("../../../lib/pin", () => ({ hashPin: vi.fn(), verifyPin: mocks.verifyPin }));
vi.mock("../../../lib/ledger-snapshot", async (importOriginal) => ({ ...await importOriginal<object>(), loadLedger: vi.fn(async () => ({})), serialize: vi.fn(() => ({})) }));

import { householdInviteToken } from "../../../lib/household-invite";
import { PIN_MAX_FAILURES } from "../../../lib/pin-attempts";
import { POST } from "./route";

const action = (name: string, payload?: unknown) => POST(new Request("https://syr.example/api/ledger", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: name, payload }),
}));

const invite = { id: "invite-1", householdId: "household-1", email: "bob@example.com", status: "invited" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BETTER_AUTH_SECRET = "test-secret";
});

describe("acceptHousehold", () => {
  beforeEach(() => {
    mocks.db.user.findUniqueOrThrow.mockResolvedValue({ email: "bob@example.com", name: "Bob", pinHash: "hash" });
    mocks.db.householdMember.findFirst.mockImplementation(async ({ where }: { where: { status: string } }) => where.status === "invited" ? invite : null);
  });

  it("refuses someone who only registered the invited address, without the emailed link", async () => {
    for (const payload of [undefined, { token: "guess" }, { token: householdInviteToken("other-invite", invite.email) }]) {
      const response = await action("acceptHousehold", payload);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "Open the invite link from your email to accept." });
    }
    expect(mocks.db.householdMember.update).not.toHaveBeenCalled();
  });

  it("joins with the token from the invite email", async () => {
    const response = await action("acceptHousehold", { token: householdInviteToken(invite.id, invite.email) });
    expect(response.status).toBe(200);
    expect(mocks.db.householdMember.update).toHaveBeenCalledWith({ where: { id: invite.id }, data: { userId: "user-2", status: "active", name: "Bob" } });
  });
});

describe("inviteHousehold", () => {
  beforeEach(() => {
    mocks.db.user.findUniqueOrThrow.mockResolvedValue({ email: "alice@example.com", name: "Alice" });
    mocks.db.householdMember.findUnique.mockResolvedValue(null);
    mocks.db.householdMember.findFirst.mockResolvedValue(null);
    mocks.db.household.create.mockResolvedValue({ id: "household-1" });
    mocks.db.householdMember.create.mockResolvedValue(invite);
  });

  it("emails a link carrying the invite's token", async () => {
    mocks.sendLedgerEmail.mockResolvedValue("sent");
    expect((await action("inviteHousehold", { email: "Bob@example.com" })).status).toBe(200);
    expect(mocks.sendLedgerEmail.mock.calls[0][2]).toContain(`https://syr.example/profile?invite=${householdInviteToken(invite.id, invite.email)}`);
  });

  it("withdraws an invite whose email could not be sent, since it could never be accepted", async () => {
    mocks.sendLedgerEmail.mockResolvedValue("unconfigured");
    expect((await action("inviteHousehold", { email: "bob@example.com" })).status).toBe(400);
    expect(mocks.db.householdMember.delete).toHaveBeenCalledWith({ where: { id: invite.id } });
  });
});

describe("removePin", () => {
  beforeEach(() => {
    mocks.db.user.findUniqueOrThrow.mockResolvedValue({ pinHash: "hash" });
  });

  it("counts a wrong current PIN toward the lock-screen limit", async () => {
    mocks.verifyPin.mockResolvedValue(false);
    expect((await action("removePin", { currentPin: "0000" })).status).toBe(401);
    expect(mocks.db.activityLog.createManyAndReturn).toHaveBeenCalledWith({ data: [expect.objectContaining({ action: "pin.failed", area: "security" })] });
  });

  it("stops checking PINs once the limit is reached", async () => {
    mocks.db.activityLog.findMany.mockResolvedValue(Array.from({ length: PIN_MAX_FAILURES }, () => ({ createdAt: new Date() })));
    expect((await action("removePin", { currentPin: "0000" })).status).toBe(429);
    expect(mocks.verifyPin).not.toHaveBeenCalled();
  });
});
