import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(async () => ({ currency: "NPR" })), update: vi.fn() },
    activityLog: {
      createManyAndReturn: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => data.map((row, index) => ({ id: `log-${index + 1}`, entityId: null, subject: null, amountMinor: null, changes: null, meta: null, ...row }))),
    },
    transaction: { findMany: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
    budget: { findMany: vi.fn() },
    recurringEntry: { findMany: vi.fn() },
    savingsGoal: { findMany: vi.fn() },
    customCategory: { findMany: vi.fn() },
    customSubcategory: { findMany: vi.fn() },
    paymentAccount: { findMany: vi.fn(), findFirst: vi.fn() },
    accountReconciliation: { findMany: vi.fn() },
    savedPlace: { findMany: vi.fn() },
    accountTransfer: { findMany: vi.fn() },
    dueItem: { findMany: vi.fn() },
    receiptAttachment: { findFirst: vi.fn(async () => null), deleteMany: vi.fn(), upsert: vi.fn() },
    householdMember: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(),
  };
  return { db, removeStoredReceipts: vi.fn(async () => undefined), verifyStoredReceipt: vi.fn(async () => undefined) };
});

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("../../../lib/auth", () => ({ getAuthenticatedSession: vi.fn(async () => ({ user: { id: "user-1" } })) }));
vi.mock("../../../lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("../../../lib/receipt-storage", () => ({ removeStoredReceipts: mocks.removeStoredReceipts, verifyStoredReceipt: mocks.verifyStoredReceipt }));

import { POST } from "./route";

const db = mocks.db;
const action = (name: string, payload: unknown, id?: string) => new Request("http://localhost/api/ledger", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: name, payload, id }),
});
const duplicateKey = () => Object.assign(new Error("Unique constraint failed on the fields: (`userId`,`clientRequestId`)"), { code: "P2002" });
const requestId = "3b0f6a8e-5c1d-4f7e-9a2b-0c4d6e8f1a2b";
const lunch = { kind: "expense", category: "food", amountMinor: 45_000, occurredOn: "2026-10-07", note: "Momo", subcategory: null, area: null, paymentMode: "cash", paymentAccountId: null, shared: false, location: null };
const user = { id: "user-1", name: "Asha", email: "asha@example.com", currency: "NPR", hideAmounts: false, autoLockMinutes: 0, calendarSystem: "AD", safeToSpendBufferMinor: 0, emailReminders: false, browserReminders: false, learningProfile: null, householdMembership: null, pinHash: null };

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUniqueOrThrow.mockResolvedValue(user);
  for (const table of [db.transaction, db.budget, db.recurringEntry, db.savingsGoal, db.customCategory, db.customSubcategory, db.paymentAccount, db.accountReconciliation, db.savedPlace, db.accountTransfer, db.dueItem]) table.findMany.mockResolvedValue([]);
  db.transaction.findFirst.mockResolvedValue(null);
  db.transaction.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "tx-new", ...data }));
  db.$transaction.mockImplementation(async (callback: (client: typeof db) => unknown) => callback(db));
});

describe("saving a new entry exactly once", () => {
  it("stores the request id with the new entry and logs it once", async () => {
    const response = await POST(action("saveTransaction", { ...lunch, clientRequestId: requestId }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(db.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "user-1", amountMinor: 45_000, clientRequestId: requestId }) });
    expect(body.activity).toEqual([expect.objectContaining({ action: "transaction.created" })]);
  });

  it("answers a retry with the entry the first attempt saved, without a second row or log", async () => {
    db.transaction.findFirst.mockResolvedValueOnce({ id: "tx-first" });

    const response = await POST(action("saveTransaction", { ...lunch, clientRequestId: requestId }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(db.transaction.findFirst).toHaveBeenCalledWith({ where: { userId: "user-1", clientRequestId: requestId }, select: { id: true } });
    expect(db.transaction.create).not.toHaveBeenCalled();
    expect(body.activity).toEqual([]);
    expect(body).toHaveProperty("transactions");
  });

  it("treats a racing duplicate (P2002 on the request id) as already saved", async () => {
    db.transaction.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "tx-first" });
    db.transaction.create.mockRejectedValueOnce(duplicateKey());

    const response = await POST(action("saveTransaction", { ...lunch, clientRequestId: requestId }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.activity).toEqual([]);
    expect(db.activityLog.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("still fails a duplicate that is not this save", async () => {
    db.transaction.create.mockRejectedValueOnce(duplicateKey());

    const response = await POST(action("saveTransaction", { ...lunch, clientRequestId: requestId }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("That already exists. Refresh to see the latest.");
  });

  it("never looks up or writes a request id when editing", async () => {
    db.transaction.findFirstOrThrow.mockResolvedValue({ id: "tx-1", paymentAccountId: null, occurredOn: new Date("2026-10-06T00:00:00.000Z"), createdAt: new Date(), kind: "expense", category: "food", amountMinor: 40_000, note: "Momo", subcategory: null, paymentMode: "cash", shared: false, locationLabel: null, receiptScanId: null, receipt: null });

    const response = await POST(action("saveTransaction", { ...lunch, clientRequestId: requestId }, "tx-1"));

    expect(response.status).toBe(200);
    expect(db.transaction.findFirst).not.toHaveBeenCalled();
    expect(db.transaction.update).toHaveBeenCalledWith({ where: { id: "tx-1" }, data: expect.not.objectContaining({ clientRequestId: expect.anything() }) });
  });

  it("refuses request ids the server reserves for loans and split bills", async () => {
    const response = await POST(action("saveTransaction", { ...lunch, clientRequestId: "due-open:due-1" }));

    expect(response.status).toBe(400);
    expect(db.transaction.create).not.toHaveBeenCalled();
  });

  it("reports a committed save as saved even when removing a replaced receipt file fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    db.transaction.findFirstOrThrow.mockResolvedValue({ id: "tx-1", paymentAccountId: null, occurredOn: new Date("2026-10-06T00:00:00.000Z"), createdAt: new Date(), kind: "expense", category: "food", amountMinor: 40_000, note: "Momo", subcategory: null, paymentMode: "cash", shared: false, locationLabel: null, receiptScanId: null, receipt: { id: "receipt-1" } });
    db.receiptAttachment.findFirst.mockResolvedValueOnce({ storagePath: "user-1/old.png" } as never);
    mocks.removeStoredReceipts.mockRejectedValueOnce(new Error("Could not remove receipt storage: timeout"));

    const response = await POST(action("saveTransaction", { ...lunch, removeReceipt: true }, "tx-1"));

    expect(response.status).toBe(200);
    expect(mocks.removeStoredReceipts).toHaveBeenCalledWith(["user-1/old.png", null]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("error answers", () => {
  it("says an entry changed elsewhere when it is gone (P2025)", async () => {
    db.transaction.findFirstOrThrow.mockRejectedValueOnce(Object.assign(new Error("No record was found for a query."), { code: "P2025" }));

    const response = await POST(action("saveTransaction", lunch, "tx-gone"));

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("This entry was changed or deleted on another device. Refresh to see the latest.");
  });

  it("keeps validation messages at 400", async () => {
    const response = await POST(action("saveTransaction", { ...lunch, paymentMode: "online", paymentAccountId: null }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Choose an online payment account.");
  });

  it("logs a database failure and never echoes its text", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    class PrismaClientInitializationError extends Error {}
    db.$transaction.mockRejectedValueOnce(new PrismaClientInitializationError("Can't reach database server at `db.abcdefgh.supabase.co:5432`"));

    const response = await POST(action("saveTransaction", lunch));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Something went wrong on our side. Refresh to check your latest entries, then try again.");
    expect(JSON.stringify(body)).not.toContain("supabase");
    expect(consoleError).toHaveBeenCalledWith("Ledger action failed.", expect.any(Error));
    consoleError.mockRestore();
  });

  it("answers an unreadable body with 400", async () => {
    const response = await POST(new Request("http://localhost/api/ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" }));

    expect(response.status).toBe(400);
  });
});

describe("updateProfile", () => {
  it("writes and logs only the settings that were sent", async () => {
    const response = await POST(action("updateProfile", { calendarSystem: "BS" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { calendarSystem: "BS" } });
    expect(body.activity).toEqual([expect.objectContaining({ action: "settings.updated", changes: [{ field: "Calendar", from: "Gregorian", to: "Bikram Sambat" }] })]);
  });

  it("keeps auto-lock off without a PIN and ignores an empty change", async () => {
    await POST(action("updateProfile", { autoLockMinutes: 5, hideAmounts: true }));
    expect(db.user.update).toHaveBeenLastCalledWith({ where: { id: "user-1" }, data: { autoLockMinutes: 0, hideAmounts: true } });

    db.user.update.mockClear();
    const response = await POST(action("updateProfile", {}));
    expect(response.status).toBe(200);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("still accepts the whole profile from an older client", async () => {
    await POST(action("updateProfile", { displayName: "Asha", currency: "NPR", hideAmounts: false, autoLockMinutes: 0, calendarSystem: "AD", safeToSpendBufferMinor: 500_000, emailReminders: false, browserReminders: false }));

    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: expect.objectContaining({ name: "Asha", safeToSpendBufferMinor: 500_000 }) });
  });

  it("rejects an invalid value", async () => {
    const response = await POST(action("updateProfile", { currency: "EUR" }));

    expect(response.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
