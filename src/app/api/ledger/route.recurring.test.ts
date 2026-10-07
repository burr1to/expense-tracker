import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    recurringEntry: { findFirstOrThrow: vi.fn(), updateMany: vi.fn() },
    paymentAccount: { findFirstOrThrow: vi.fn() },
    transaction: { create: vi.fn(), updateMany: vi.fn() },
  };
  const db = {
    user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(async () => ({ currency: "NPR" })) },
    activityLog: {
      createManyAndReturn: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => data.map((row, index) => ({ id: `log-${index + 1}`, entityId: null, subject: null, amountMinor: null, changes: null, meta: null, ...row }))),
    },
    transaction: { findMany: vi.fn(), findFirst: vi.fn() },
    budget: { findMany: vi.fn() },
    recurringEntry: { findMany: vi.fn(), findFirstOrThrow: vi.fn(), updateMany: vi.fn() },
    savingsGoal: { findMany: vi.fn() },
    customCategory: { findMany: vi.fn() },
    customSubcategory: { findMany: vi.fn() },
    paymentAccount: { findMany: vi.fn(), findFirst: vi.fn(async () => null), findFirstOrThrow: vi.fn() },
    accountReconciliation: { findMany: vi.fn() },
    savedPlace: { findMany: vi.fn() },
    accountTransfer: { findMany: vi.fn() },
    dueItem: { findMany: vi.fn() },
    householdMember: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { db, tx };
});

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("../../../lib/auth", () => ({ getAuthenticatedSession: vi.fn(async () => ({ user: { id: "user-1" } })) }));
vi.mock("../../../lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("../../../lib/receipt-storage", () => ({ removeStoredReceipts: vi.fn(), verifyStoredReceipt: vi.fn() }));

import { POST } from "./route";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const action = (name: string, payload: unknown, id?: string) => new Request("http://localhost/api/ledger", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: name, payload, id }),
});
// Electricity, due on the 7th of every month; the September bill is waiting to be confirmed.
const electricity = (overrides: Record<string, unknown> = {}) => ({
  id: "recurring-1",
  userId: "user-1",
  kind: "expense",
  category: "utilities",
  amountMinor: 250000,
  paymentAccountId: "account-1",
  note: "NEA electricity",
  tags: [],
  dayOfMonth: 7,
  recurrenceUnit: "month",
  recurrenceInterval: 1,
  anchorDate: day("2026-01-07"),
  nextDueOn: day("2026-09-07"),
  active: true,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Kathmandu date 2026-10-07; only Date is faked so promises still resolve.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T06:00:00.000Z"));
  mocks.db.user.findUniqueOrThrow.mockResolvedValue({ id: "user-1", name: "Test User", email: "test@example.com", currency: "NPR", hideAmounts: false, autoLockMinutes: 0, calendarSystem: "AD", safeToSpendBufferMinor: 0, emailReminders: false, browserReminders: false, learningProfile: null, householdMembership: null, pinHash: null });
  for (const table of [mocks.db.transaction, mocks.db.budget, mocks.db.recurringEntry, mocks.db.savingsGoal, mocks.db.customCategory, mocks.db.customSubcategory, mocks.db.paymentAccount, mocks.db.accountReconciliation, mocks.db.savedPlace, mocks.db.accountTransfer, mocks.db.dueItem]) table.findMany.mockResolvedValue([]);
  mocks.db.$transaction.mockImplementation(async (callback) => callback(mocks.tx));
  mocks.tx.recurringEntry.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.transaction.create.mockResolvedValue({ id: "transaction-9" });
  mocks.tx.transaction.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.recurringEntry.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("confirmRecurring with adjustments", () => {
  it("records this occurrence at the adjusted amount, date and account, and keeps what Undo needs", async () => {
    mocks.tx.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity());
    mocks.tx.paymentAccount.findFirstOrThrow.mockResolvedValueOnce({ id: "account-2" });

    const response = await POST(action("confirmRecurring", { dueOn: "2026-09-07", amountMinor: 318000, occurredOn: "2026-09-09", paymentMode: "online", paymentAccountId: "account-2" }, "recurring-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.tx.recurringEntry.findFirstOrThrow).toHaveBeenCalledWith({ where: { id: "recurring-1", userId: "user-1" } });
    expect(mocks.tx.paymentAccount.findFirstOrThrow).toHaveBeenCalledWith({ where: { id: "account-2", userId: "user-1" } });
    expect(mocks.db.accountReconciliation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { paymentAccountId: { in: ["account-2"] } } }));
    expect(mocks.tx.recurringEntry.updateMany).toHaveBeenCalledWith({ where: { id: "recurring-1", userId: "user-1", nextDueOn: day("2026-09-07") }, data: { nextDueOn: day("2026-10-07") } });
    expect(mocks.tx.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "user-1", kind: "expense", category: "utilities", amountMinor: 318000, occurredOn: day("2026-09-09"), paymentMode: "online", paymentAccountId: "account-2" }) });
    expect(body.activity).toEqual([expect.objectContaining({
      action: "recurring.recorded", entityId: "transaction-9", amountMinor: 318000,
      meta: { kind: "expense", recurringId: "recurring-1", previousDueOn: "2026-09-07", nextDueOn: "2026-10-07" },
    })]);
  });

  it("records in cash when the payment method is changed to cash", async () => {
    mocks.tx.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity());

    await POST(action("confirmRecurring", { paymentMode: "cash", paymentAccountId: null }, "recurring-1"));

    expect(mocks.tx.paymentAccount.findFirstOrThrow).not.toHaveBeenCalled();
    expect(mocks.tx.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amountMinor: 250000, occurredOn: day("2026-09-07"), paymentMode: "cash", paymentAccountId: null }) });
  });

  it("records a schedule linked to Cash in hand as a cash entry without an account, like the confirm sheet", async () => {
    mocks.tx.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity({ paymentAccountId: "cash-account" }));
    mocks.tx.paymentAccount.findFirstOrThrow.mockResolvedValueOnce({ id: "cash-account", userId: "user-1", type: "cash" });

    const response = await POST(action("confirmRecurring", { dueOn: "2026-09-07" }, "recurring-1"));

    expect(response.status).toBe(200);
    expect(mocks.tx.paymentAccount.findFirstOrThrow).toHaveBeenCalledTimes(1);
    expect(mocks.tx.paymentAccount.findFirstOrThrow).toHaveBeenCalledWith({ where: { id: "cash-account", userId: "user-1" } });
    expect(mocks.tx.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amountMinor: 250000, occurredOn: day("2026-09-07"), paymentMode: "cash", paymentAccountId: null }) });
  });

  it("records a schedule linked to an online account in that account when nothing is adjusted", async () => {
    mocks.tx.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity());
    mocks.tx.paymentAccount.findFirstOrThrow.mockResolvedValueOnce({ id: "account-1", userId: "user-1", type: "esewa" });

    const response = await POST(action("confirmRecurring", { dueOn: "2026-09-07" }, "recurring-1"));

    expect(response.status).toBe(200);
    expect(mocks.tx.paymentAccount.findFirstOrThrow).toHaveBeenCalledTimes(1);
    expect(mocks.tx.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ paymentMode: "online", paymentAccountId: "account-1" }) });
  });

  it("refuses a default confirm whose linked account is not the user's", async () => {
    mocks.tx.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity());
    mocks.tx.paymentAccount.findFirstOrThrow.mockRejectedValueOnce(new Error("No PaymentAccount found"));

    const response = await POST(action("confirmRecurring", { dueOn: "2026-09-07" }, "recurring-1"));

    expect(response.status).toBe(400);
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
  });

  it("refuses an occurrence that was already recorded or skipped elsewhere", async () => {
    mocks.tx.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity({ nextDueOn: day("2026-10-07") }));

    const response = await POST(action("confirmRecurring", { dueOn: "2026-09-07" }, "recurring-1"));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("This occurrence was already recorded or skipped.");
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
  });

  it("validates the payment method like a saved transaction", async () => {
    const response = await POST(action("confirmRecurring", { paymentMode: "online" }, "recurring-1"));
    const cashWithAccount = await POST(action("confirmRecurring", { paymentMode: "cash", paymentAccountId: "account-1" }, "recurring-1"));
    const zero = await POST(action("confirmRecurring", { amountMinor: 0 }, "recurring-1"));

    expect((await response.json()).error).toBe("Choose an online payment account.");
    expect((await cashWithAccount.json()).error).toBe("Payment accounts can only be used with online payments.");
    expect(zero.status).toBe(400);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("keeps an approved reconciliation closed to an adjusted date", async () => {
    mocks.tx.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity());
    mocks.tx.paymentAccount.findFirstOrThrow.mockResolvedValueOnce({ id: "account-1" });
    mocks.db.accountReconciliation.findMany.mockResolvedValueOnce([{ paymentAccountId: "account-1", checkedOn: day("2026-09-30"), approvedAt: new Date("2026-10-01T00:00:00.000Z") }]);

    const response = await POST(action("confirmRecurring", { occurredOn: "2026-09-08" }, "recurring-1"));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("approved reconciliation through 2026-09-30");
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
  });
});

describe("skipRecurring", () => {
  it("moves past one occurrence without recording anything", async () => {
    mocks.db.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity());

    const body = await (await POST(action("skipRecurring", { dueOn: "2026-09-07" }, "recurring-1"))).json();

    expect(mocks.db.recurringEntry.findFirstOrThrow).toHaveBeenCalledWith({ where: { id: "recurring-1", userId: "user-1" } });
    expect(mocks.db.recurringEntry.updateMany).toHaveBeenCalledWith({ where: { id: "recurring-1", userId: "user-1", nextDueOn: day("2026-09-07") }, data: { nextDueOn: day("2026-10-07") } });
    expect(mocks.tx.transaction.create).not.toHaveBeenCalled();
    expect(body.activity).toEqual([expect.objectContaining({ action: "recurring.skipped", entityId: "recurring-1", meta: { kind: "expense", previousDueOn: "2026-09-07", nextDueOn: "2026-10-07" } })]);
  });

  it("refuses a stale skip and a paused schedule", async () => {
    mocks.db.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity({ nextDueOn: day("2026-10-07") }));
    const stale = await POST(action("skipRecurring", { dueOn: "2026-09-07" }, "recurring-1"));
    mocks.db.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity({ active: false }));
    const paused = await POST(action("skipRecurring", { dueOn: "2026-09-07" }, "recurring-1"));

    expect((await stale.json()).error).toBe("This occurrence was already recorded or skipped.");
    expect((await paused.json()).error).toBe("This recurring entry is paused.");
    expect(mocks.db.recurringEntry.updateMany).not.toHaveBeenCalled();
  });
});

describe("undoRecurring", () => {
  const recorded = { id: "transaction-9", kind: "expense", category: "utilities", amountMinor: 318000, paymentAccountId: "account-1", occurredOn: day("2026-09-09"), createdAt: new Date("2026-10-07T05:59:00.000Z") };

  it("takes back a recorded occurrence: the schedule steps back and the entry is soft-deleted", async () => {
    mocks.db.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity({ nextDueOn: day("2026-10-07") }));
    mocks.db.transaction.findFirst.mockResolvedValueOnce(recorded);

    const body = await (await POST(action("undoRecurring", { previousDueOn: "2026-09-07", transactionId: "transaction-9" }, "recurring-1"))).json();

    expect(mocks.db.transaction.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "transaction-9", userId: "user-1", deletedAt: null } }));
    expect(mocks.tx.recurringEntry.updateMany).toHaveBeenCalledWith({ where: { id: "recurring-1", userId: "user-1", nextDueOn: day("2026-10-07") }, data: { nextDueOn: day("2026-09-07") } });
    expect(mocks.tx.transaction.updateMany).toHaveBeenCalledWith({ where: { id: "transaction-9", userId: "user-1", deletedAt: null }, data: { deletedAt: expect.any(Date) } });
    expect(body.activity).toEqual([expect.objectContaining({ action: "recurring.unrecorded", entityId: "transaction-9", amountMinor: 318000 })]);
  });

  it("brings back a skipped occurrence without touching any transaction", async () => {
    mocks.db.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity({ nextDueOn: day("2026-10-07") }));

    const body = await (await POST(action("undoRecurring", { previousDueOn: "2026-09-07" }, "recurring-1"))).json();

    expect(mocks.db.transaction.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.transaction.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.recurringEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { nextDueOn: day("2026-09-07") } }));
    expect(body.activity).toEqual([expect.objectContaining({ action: "recurring.unskipped", entityId: "recurring-1" })]);
  });

  it("refuses once the schedule has moved on, so a later occurrence is never rewound", async () => {
    mocks.db.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity({ nextDueOn: day("2026-11-07") }));

    const response = await POST(action("undoRecurring", { previousDueOn: "2026-09-07", transactionId: "transaction-9" }, "recurring-1"));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("can’t be undone here");
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a transaction that does not belong to this schedule", async () => {
    mocks.db.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity({ nextDueOn: day("2026-10-07") }));
    mocks.db.transaction.findFirst.mockResolvedValueOnce({ ...recorded, category: "food" });

    const response = await POST(action("undoRecurring", { previousDueOn: "2026-09-07", transactionId: "transaction-9" }, "recurring-1"));

    expect((await response.json()).error).toBe("The recorded entry was already changed or removed.");
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});

describe("pausing and resuming with saveRecurring", () => {
  const payload = (active: boolean) => ({ kind: "expense", category: "utilities", amountMinor: 250000, paymentAccountId: "account-1", note: "NEA electricity", tags: [], recurrenceUnit: "month", recurrenceInterval: 1, startOn: "2026-01-07", active });

  it("pauses without moving the schedule and logs it as a pause", async () => {
    mocks.db.paymentAccount.findFirstOrThrow.mockResolvedValueOnce({ id: "account-1" });
    mocks.db.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity());

    const body = await (await POST(action("saveRecurring", payload(false), "recurring-1"))).json();

    expect(mocks.db.recurringEntry.updateMany).toHaveBeenCalledWith({ where: { id: "recurring-1", userId: "user-1" }, data: expect.objectContaining({ active: false, nextDueOn: day("2026-09-07") }) });
    expect(body.activity).toEqual([expect.objectContaining({ action: "recurring.paused", title: "Paused a recurring entry" })]);
  });

  it("resumes a long pause at the latest occurrence already due", async () => {
    mocks.db.paymentAccount.findFirstOrThrow.mockResolvedValueOnce({ id: "account-1" });
    mocks.db.recurringEntry.findFirstOrThrow.mockResolvedValueOnce(electricity({ active: false, nextDueOn: day("2026-05-07") }));

    const body = await (await POST(action("saveRecurring", payload(true), "recurring-1"))).json();

    expect(mocks.db.recurringEntry.updateMany).toHaveBeenCalledWith({ where: { id: "recurring-1", userId: "user-1" }, data: expect.objectContaining({ active: true, nextDueOn: day("2026-10-07") }) });
    expect(body.activity).toEqual([expect.objectContaining({ action: "recurring.resumed" })]);
  });
});
