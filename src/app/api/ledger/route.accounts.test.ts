import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const accounts: Record<string, { id: string; userId: string; type: string; provider: string; label: string; accountTail: string | null; shared: boolean; balanceMinor: number }> = {
    nabil: { id: "nabil", userId: "user-1", type: "mobile_banking", provider: "Nabil Bank Limited", label: "", accountTail: null, shared: false, balanceMinor: 0 },
    esewa: { id: "esewa", userId: "user-1", type: "esewa", provider: "esewa", label: "", accountTail: null, shared: false, balanceMinor: 0 },
    cash: { id: "cash", userId: "user-1", type: "cash", provider: "Cash", label: "", accountTail: null, shared: false, balanceMinor: 0 },
  };
  const tx = {
    paymentAccount: { count: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    transaction: { updateMany: vi.fn() },
    accountTransfer: { deleteMany: vi.fn() },
  };
  const db = {
    user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(async () => ({ currency: "NPR" })) },
    activityLog: {
      createManyAndReturn: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => data.map((row, index) => ({ id: `log-${index + 1}`, entityId: null, subject: null, amountMinor: null, changes: null, meta: null, ...row }))),
    },
    transaction: { findMany: vi.fn() },
    budget: { findMany: vi.fn() },
    recurringEntry: { findMany: vi.fn() },
    savingsGoal: { findMany: vi.fn() },
    customCategory: { findMany: vi.fn() },
    customSubcategory: { findMany: vi.fn() },
    paymentAccount: {
      findMany: vi.fn(),
      findFirst: vi.fn(async ({ where }: { where: { id: string; userId?: string } }) => {
        const account = accounts[where.id];
        return account && (!where.userId || account.userId === where.userId) ? account : null;
      }),
      findFirstOrThrow: vi.fn(async ({ where }: { where: { id: string; userId?: string } }) => {
        const account = accounts[where.id];
        if (!account || (where.userId && account.userId !== where.userId)) throw new Error("No PaymentAccount found");
        return account;
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    accountReconciliation: { findMany: vi.fn(), count: vi.fn(async () => 0) },
    savedPlace: { findMany: vi.fn() },
    accountTransfer: { findMany: vi.fn(), findFirst: vi.fn(), count:vi.fn(async () => 0), create: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    dueItem: { findMany: vi.fn() },
    householdMember: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { db, tx, accounts };
});

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("../../../lib/auth", () => ({ getAuthenticatedSession: vi.fn(async () => ({ user: { id: "user-1" } })) }));
vi.mock("../../../lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("../../../lib/receipt-storage", () => ({ removeStoredReceipts: vi.fn(), verifyStoredReceipt: vi.fn() }));

import { POST } from "./route";

const action = (name: string, payload: unknown, id?: string) => new Request("http://localhost/api/ledger", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: name, payload, id }),
});

const transfer = { fromAccountId: "nabil", toAccountId: "esewa", amountMinor: 100_000, occurredOn: "2026-10-05", note: "eSewa load" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.user.findUniqueOrThrow.mockResolvedValue({ id: "user-1", name: "Test User", email: "test@example.com", currency: "NPR", hideAmounts: false, autoLockMinutes: 0, calendarSystem: "AD", safeToSpendBufferMinor: 0, emailReminders: false, browserReminders: false, learningProfile: null, householdMembership: null, pinHash: "hash" });
  for (const table of [mocks.db.transaction, mocks.db.budget, mocks.db.recurringEntry, mocks.db.savingsGoal, mocks.db.customCategory, mocks.db.customSubcategory, mocks.db.paymentAccount, mocks.db.accountReconciliation, mocks.db.savedPlace, mocks.db.accountTransfer, mocks.db.dueItem]) table.findMany.mockResolvedValue([]);
  mocks.db.paymentAccount.findMany.mockImplementation(async (query?: { where?: { id?: { in: string[] } } }) => query?.where?.id ? query.where.id.in.filter((id) => mocks.accounts[id]).map((id) => ({ id })) : []);
  mocks.db.accountReconciliation.count.mockResolvedValue(0);
  mocks.db.accountTransfer.count.mockResolvedValue(0);
  mocks.db.$transaction.mockImplementation(async (callback) => callback(mocks.tx));
  mocks.tx.transaction.updateMany.mockResolvedValue({ count: 0 });
  mocks.tx.accountTransfer.deleteMany.mockResolvedValue({ count: 0 });
  mocks.tx.paymentAccount.deleteMany.mockResolvedValue({ count: 1 });
  mocks.tx.paymentAccount.count.mockResolvedValue(0);
  mocks.tx.paymentAccount.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "new-account", ...data }));
});

describe("saveTransfer", () => {
  it("stores the request id and logs one entry", async () => {
    mocks.db.accountTransfer.create.mockResolvedValueOnce({ id: "transfer-1" });

    const body = await (await POST(action("saveTransfer", { ...transfer, clientRequestId: "request-0001" }))).json();

    expect(mocks.db.accountTransfer.create).toHaveBeenCalledWith({ data: expect.objectContaining({ fromAccountId: "nabil", toAccountId: "esewa", amountMinor: 100_000, clientRequestId: "request-0001", userId: "user-1" }) });
    expect(body.activity).toEqual([expect.objectContaining({ action: "transfer.created", amountMinor: 100_000 })]);
  });

  it("returns the transfer a lost response already saved instead of saving it twice", async () => {
    mocks.db.accountTransfer.create.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    mocks.db.accountTransfer.findFirst.mockResolvedValueOnce({ id: "transfer-1" });

    const response = await POST(action("saveTransfer", { ...transfer, clientRequestId: "request-0001" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.db.accountTransfer.findFirst).toHaveBeenCalledWith({ where: { userId: "user-1", clientRequestId: "request-0001" }, select: { id: true } });
    expect(body.activity).toEqual([]);
  });

  it("refuses a transfer to an account that is not the user's", async () => {
    const response = await POST(action("saveTransfer", { ...transfer, toAccountId: "someone-elses" }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Both transfer accounts must belong to you.");
    expect(mocks.db.accountTransfer.create).not.toHaveBeenCalled();
    // Another person's reconciliation dates are never looked up for them.
    expect(mocks.db.accountReconciliation.findMany).not.toHaveBeenCalled();
  });

  it("edits a transfer by id and logs what changed", async () => {
    mocks.db.accountTransfer.findFirst.mockResolvedValueOnce({ id: "transfer-1", userId: "user-1", fromAccountId: "nabil", toAccountId: "esewa", amountMinor: 50_000, occurredOn: new Date("2026-10-05T00:00:00.000Z"), note: "eSewa load", createdAt: new Date("2026-10-05T08:00:00.000Z") });

    const body = await (await POST(action("saveTransfer", { ...transfer, toAccountId: "cash", clientRequestId: "ignored-on-edit" }, "transfer-1"))).json();

    expect(mocks.db.accountTransfer.findFirst).toHaveBeenCalledWith({ where: { id: "transfer-1", userId: "user-1" } });
    expect(mocks.db.accountTransfer.updateMany).toHaveBeenCalledWith({ where: { id: "transfer-1", userId: "user-1" }, data: { fromAccountId: "nabil", toAccountId: "cash", amountMinor: 100_000, occurredOn: new Date("2026-10-05T00:00:00.000Z"), note: "eSewa load" } });
    expect(mocks.db.accountTransfer.create).not.toHaveBeenCalled();
    expect(body.activity).toEqual([expect.objectContaining({ action: "transfer.edited", entityId: "transfer-1", changes: expect.arrayContaining([expect.objectContaining({ field: "To" }), expect.objectContaining({ field: "Amount" })]) })]);
  });

  it("refuses to edit a transfer that sits inside an approved reconciliation", async () => {
    mocks.db.accountTransfer.findFirst.mockResolvedValueOnce({ id: "transfer-1", userId: "user-1", fromAccountId: "nabil", toAccountId: "esewa", amountMinor: 50_000, occurredOn: new Date("2026-09-10T00:00:00.000Z"), note: "", createdAt: new Date("2026-09-10T08:00:00.000Z") });
    mocks.db.accountReconciliation.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ paymentAccountId: "nabil", checkedOn: new Date("2026-09-30T00:00:00.000Z"), approvedAt: new Date("2026-10-01T00:00:00.000Z") }]);

    const response = await POST(action("saveTransfer", transfer, "transfer-1"));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/approved reconciliation through 2026-09-30/);
    expect(mocks.db.accountTransfer.updateMany).not.toHaveBeenCalled();
  });

  it("says so when the transfer being edited is gone or someone else's", async () => {
    mocks.db.accountTransfer.findFirst.mockResolvedValueOnce(null);

    const response = await POST(action("saveTransfer", transfer, "transfer-of-partner"));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("That transfer no longer exists.");
    expect(mocks.db.accountTransfer.updateMany).not.toHaveBeenCalled();
  });
});

describe("deletePaymentAccount", () => {
  it("refuses to remove an account with transfers until the user confirms the effect", async () => {
    mocks.db.accountTransfer.count.mockResolvedValueOnce(3);

    const response = await POST(action("deletePaymentAccount", undefined, "esewa"));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/has 3 transfers with your other accounts/);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("removes the transfers and moves its online entries to cash in one transaction once confirmed", async () => {
    mocks.db.accountTransfer.count.mockResolvedValueOnce(3);
    mocks.tx.transaction.updateMany.mockResolvedValueOnce({ count: 4 });
    mocks.tx.accountTransfer.deleteMany.mockResolvedValueOnce({ count: 3 });

    const body = await (await POST(action("deletePaymentAccount", { removeTransfers: true }, "esewa"))).json();

    expect(mocks.tx.transaction.updateMany).toHaveBeenCalledWith({ where: { paymentAccountId: "esewa", paymentMode: "online" }, data: { paymentMode: "cash", paymentAccountId: null } });
    expect(mocks.tx.accountTransfer.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1", OR: [{ fromAccountId: "esewa" }, { toAccountId: "esewa" }] } });
    expect(mocks.tx.paymentAccount.deleteMany).toHaveBeenCalledWith({ where: { id: "esewa", userId: "user-1" } });
    expect(body.activity).toEqual([expect.objectContaining({ action: "account.deleted", meta: { transfersRemoved: 3, entriesMovedToCash: 4 } })]);
  });

  it("refuses an account that is not the user's", async () => {
    const response = await POST(action("deletePaymentAccount", { removeTransfers: true }, "someone-elses"));

    expect(response.status).toBe(400);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});

describe("payment accounts", () => {
  const base = { label: "", balanceMinor: 250_000, balanceAsOf: "2026-10-07" };

  it("adds Cash in hand once, private and without account digits", async () => {
    await POST(action("savePaymentAccount", { ...base, type: "cash", provider: "Cash", shared: true, accountTail: "1234" }));

    expect(mocks.tx.paymentAccount.count).toHaveBeenCalledWith({ where: { userId: "user-1", type: "cash" } });
    expect(mocks.tx.paymentAccount.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "cash", provider: "Cash", shared: false, accountTail: null, userId: "user-1" }) });

    mocks.tx.paymentAccount.count.mockResolvedValueOnce(1);
    const second = await POST(action("savePaymentAccount", { ...base, type: "cash", provider: "Cash" }));
    expect(second.status).toBe(400);
    expect((await second.json()).error).toBe("You already track Cash in hand.");
  });

  it("stores the last digits of a bank account and refuses anything but 3-4 digits", async () => {
    await POST(action("savePaymentAccount", { ...base, type: "mobile_banking", provider: "Nabil Bank Limited", accountTail: "4821" }));
    expect(mocks.tx.paymentAccount.create).toHaveBeenCalledWith({ data: expect.objectContaining({ provider: "Nabil Bank Limited", accountTail: "4821" }) });

    const invalid = await POST(action("savePaymentAccount", { ...base, type: "mobile_banking", provider: "Nabil Bank Limited", accountTail: "48211" }));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toBe("Enter the last 3 or 4 digits of the account number.");
  });

  it("accepts a free-text provider only for Other, and a wallet's own id only for that wallet", async () => {
    expect((await POST(action("savePaymentAccount", { ...base, type: "other", provider: "Sahara Saving and Credit Co-op" }))).status).toBe(200);
    expect((await POST(action("savePaymentAccount", { ...base, type: "ime_pay", provider: "ime_pay" }))).status).toBe(200);
    const mismatched = await POST(action("savePaymentAccount", { ...base, type: "khalti", provider: "esewa" }));
    expect(mismatched.status).toBe(400);
    expect(mocks.tx.paymentAccount.create).toHaveBeenCalledTimes(2);
  });

  it("updates an account's last digits and logs the change", async () => {
    const body = await (await POST(action("updatePaymentAccountTail", { accountTail: "4821" }, "nabil"))).json();

    expect(mocks.db.paymentAccount.updateMany).toHaveBeenCalledWith({ where: { id: "nabil", userId: "user-1" }, data: { accountTail: "4821" } });
    expect(body.activity).toEqual([expect.objectContaining({ action: "account.tail_updated", changes: [{ field: "Last digits", from: null, to: "4821" }] })]);
  });

  it("refuses last digits on Cash in hand and sharing it", async () => {
    const tail = await POST(action("updatePaymentAccountTail", { accountTail: "1234" }, "cash"));
    const share = await POST(action("setPaymentAccountShared", { shared: true }, "cash"));

    expect(tail.status).toBe(400);
    expect((await tail.json()).error).toBe("Cash in hand has no account number.");
    expect(share.status).toBe(400);
    expect((await share.json()).error).toBe("Cash in hand stays private to you.");
    expect(mocks.db.paymentAccount.updateMany).not.toHaveBeenCalled();
  });
});
