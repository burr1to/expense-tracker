import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(async () => ({ currency: "NPR" })) },
    activityLog: {
      createManyAndReturn: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => data.map((row, index) => ({ id: `log-${index + 1}`, entityId: null, subject: null, amountMinor: null, changes: null, meta: null, ...row }))),
    },
    transaction: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    budget: { findMany: vi.fn() },
    recurringEntry: { findMany: vi.fn() },
    savingsGoal: { findMany: vi.fn() },
    customCategory: { findMany: vi.fn(), findFirst: vi.fn() },
    customSubcategory: { findMany: vi.fn() },
    paymentAccount: { findMany: vi.fn(), findFirst: vi.fn() },
    accountReconciliation: { findMany: vi.fn() },
    savedPlace: { findMany: vi.fn() },
    accountTransfer: { findMany: vi.fn() },
    dueItem: { findMany: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    duePayment: { findFirst: vi.fn(), findFirstOrThrow: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    receiptAttachment: { findFirst: vi.fn(async () => null) },
    householdMember: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(),
  };
  return { db };
});

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("../../../lib/auth", () => ({ getAuthenticatedSession: vi.fn(async () => ({ user: { id: "user-1" } })) }));
vi.mock("../../../lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("../../../lib/receipt-storage", () => ({ removeStoredReceipts: vi.fn(), verifyStoredReceipt: vi.fn() }));

import { POST } from "./route";

const db = mocks.db;
const action = (name: string, payload: unknown, id?: string) => new Request("http://localhost/api/ledger", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: name, payload, id }),
});
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const duplicateKey = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
const lentDue = (changes: Record<string, unknown> = {}) => ({ id: "due-1", userId: "user-1", kind: "lent", title: "Bike repair", person: "Ram", category: "loan", amountMinor: 500_000, status: "open", completedOn: null, payments: [] as { amountMinor: number }[], ...changes });
const esewa = { id: "acct-1", userId: "user-1", shared: false, type: "esewa", provider: "eSewa", label: "" };

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUniqueOrThrow.mockResolvedValue({ id: "user-1", name: "Test User", email: "test@example.com", currency: "NPR", hideAmounts: false, autoLockMinutes: 0, calendarSystem: "AD", safeToSpendBufferMinor: 0, emailReminders: false, browserReminders: false, learningProfile: null, householdMembership: null, pinHash: null });
  for (const table of [db.transaction, db.budget, db.recurringEntry, db.savingsGoal, db.customCategory, db.customSubcategory, db.paymentAccount, db.accountReconciliation, db.savedPlace, db.accountTransfer, db.dueItem]) table.findMany.mockResolvedValue([]);
  db.paymentAccount.findFirst.mockResolvedValue(esewa);
  db.transaction.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `tx-${String(data.clientRequestId ?? "new")}`, ...data }));
  db.dueItem.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "due-1", ...data }));
  db.duePayment.findFirst.mockResolvedValue(null);
  db.transaction.count.mockResolvedValue(0);
  db.$transaction.mockImplementation(async (callback: (client: typeof db) => unknown) => callback(db));
});

describe("saveDueItem loan movements", () => {
  const lent = { kind: "lent", title: "Bike repair", person: "Ram", amountMinor: 500_000, category: "food", occurredOn: "2026-10-01", dueOn: "2026-10-31", remindOn: null, note: "", annualRatePercent: null };

  it("records money lent in cash as a loan movement on the lend date, never as spending", async () => {
    const response = await POST(action("saveDueItem", { ...lent, movement: "cash" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(db.dueItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "user-1", kind: "lent", category: "loan" }) });
    expect(db.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "user-1", kind: "expense", category: "loan", subcategory: "Lent", amountMinor: 500_000, occurredOn: day("2026-10-01"), paymentMode: "cash", paymentAccountId: null, clientRequestId: "due-open:due-1" }) });
    expect(body.activity).toEqual([expect.objectContaining({ action: "due.created", meta: expect.objectContaining({ movement: "Cash" }) })]);
  });

  it("takes borrowed money into one of your accounts as loan income", async () => {
    await POST(action("saveDueItem", { ...lent, kind: "borrowed", movement: "acct-1" }));

    expect(db.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "income", category: "loan", subcategory: "Borrowed", paymentMode: "online", paymentAccountId: "acct-1" }) });
  });

  it("records no movement when asked not to, or for an ordinary bill", async () => {
    await POST(action("saveDueItem", { ...lent, movement: "none" }));
    await POST(action("saveDueItem", { ...lent, kind: "payment", person: "", occurredOn: null, category: "utilities", movement: "cash" }));

    expect(db.transaction.create).not.toHaveBeenCalled();
    expect(db.dueItem.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ kind: "payment", category: "utilities" }) });
  });

  it("refuses someone else's account and a date inside an approved reconciliation", async () => {
    db.paymentAccount.findFirst.mockResolvedValueOnce({ ...esewa, userId: "user-2", shared: true });
    const foreign = await POST(action("saveDueItem", { ...lent, movement: "acct-1" }));
    db.accountReconciliation.findMany.mockResolvedValueOnce([{ paymentAccountId: "acct-1", checkedOn: day("2026-10-05"), approvedAt: new Date() }]);
    const locked = await POST(action("saveDueItem", { ...lent, movement: "acct-1" }));

    expect(foreign.status).toBe(400);
    expect(locked.status).toBe(400);
    expect((await locked.json()).error).toMatch(/approved reconciliation/);
    expect(db.dueItem.create).not.toHaveBeenCalled();
  });
});

describe("editing a loan", () => {
  const lent = { kind: "lent", title: "Bike repair", person: "Ram", amountMinor: 600_000, category: "loan", occurredOn: "2026-10-02", dueOn: "2026-10-31", remindOn: null, note: "", annualRatePercent: null };
  const existing = { id: "due-1", userId: "user-1", kind: "lent", title: "Bike repair", person: "Ram", amountMinor: 500_000, category: "loan", occurredOn: day("2026-10-01"), dueOn: day("2026-10-31"), remindOn: null, note: "", annualRatePercent: null, payments: [] };
  const opening = { id: "tx-open", kind: "expense", amountMinor: 500_000, occurredOn: day("2026-10-01"), paymentAccountId: "acct-1", note: "Lent to Ram · Bike repair", createdAt: new Date(), deletedAt: null };

  it("keeps the opening movement on its account while it follows the new amount and date", async () => {
    db.dueItem.findFirstOrThrow.mockResolvedValueOnce(existing);
    db.transaction.findFirst.mockResolvedValueOnce(opening);

    await POST(action("saveDueItem", lent, "due-1"));

    expect(db.transaction.update).toHaveBeenCalledWith({ where: { id: "tx-open" }, data: expect.objectContaining({ amountMinor: 600_000, occurredOn: day("2026-10-02"), paymentAccountId: "acct-1", paymentMode: "online", category: "loan", deletedAt: null }) });
    expect(db.transaction.create).not.toHaveBeenCalled();
  });

  it("removes the opening movement when the loan should no longer record one", async () => {
    db.dueItem.findFirstOrThrow.mockResolvedValueOnce(existing);
    db.transaction.findFirst.mockResolvedValueOnce(opening);

    const body = await (await POST(action("saveDueItem", { ...lent, movement: "none" }, "due-1"))).json();

    expect(db.transaction.update).toHaveBeenCalledWith({ where: { id: "tx-open" }, data: { deletedAt: expect.any(Date) } });
    expect(body.activity).toEqual([expect.objectContaining({ action: "due.edited", changes: expect.arrayContaining([{ field: "Money left from", from: "eSewa", to: "Not recorded" }]) })]);
  });
});

describe("deleteDueItem", () => {
  it("removes the loan movements the due wrote and leaves other entries alone", async () => {
    db.dueItem.findFirst.mockResolvedValueOnce({ title: "Bike repair", amountMinor: 500_000, payments: [{ transactionId: "tx-repay" }] });
    db.transaction.findMany.mockResolvedValueOnce([{ id: "tx-open", paymentAccountId: null, occurredOn: day("2026-10-01"), createdAt: new Date() }, { id: "tx-repay", paymentAccountId: null, occurredOn: day("2026-10-06"), createdAt: new Date() }]);
    db.dueItem.deleteMany.mockResolvedValueOnce({ count: 1 });

    const body = await (await POST(action("deleteDueItem", undefined, "due-1"))).json();

    expect(db.transaction.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { userId: "user-1", deletedAt: null, category: "loan", OR: [{ clientRequestId: "due-open:due-1" }, { id: { in: ["tx-repay"] } }] } }));
    expect(db.transaction.updateMany).toHaveBeenCalledWith({ where: { userId: "user-1", id: { in: ["tx-open", "tx-repay"] } }, data: { deletedAt: expect.any(Date) } });
    expect(body.activity).toEqual([expect.objectContaining({ action: "due.deleted", meta: { movementsRemoved: 2 } })]);
  });
});

describe("recordDuePayment", () => {
  const repayment = { amountMinor: 300_000, occurredOn: "2026-10-06", note: "", addToLedger: true, paymentAccountId: "acct-1", clientRequestId: "repay-req-0001" };

  it("lands a repayment in the chosen account as a loan movement and settles the due once paid off", async () => {
    db.dueItem.findFirstOrThrow.mockResolvedValueOnce(lentDue({ payments: [{ amountMinor: 200_000 }] }));

    const body = await (await POST(action("recordDuePayment", repayment, "due-1"))).json();

    expect(db.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "user-1", kind: "income", category: "loan", subcategory: "Repayment", amountMinor: 300_000, paymentMode: "online", paymentAccountId: "acct-1" }) });
    expect(db.duePayment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ dueItemId: "due-1", amountMinor: 300_000, transactionId: "tx-new", clientRequestId: "repay-req-0001" }) });
    expect(db.dueItem.update).toHaveBeenCalledWith({ where: { id: "due-1" }, data: { status: "completed", completedOn: day("2026-10-06") } });
    expect(body.activity).toEqual([expect.objectContaining({ action: "due.settled", meta: expect.objectContaining({ via: "eSewa" }) })]);
  });

  it("records a retried repayment once", async () => {
    db.duePayment.findFirst.mockResolvedValueOnce({ id: "pay-1" });

    const response = await POST(action("recordDuePayment", repayment, "due-1"));

    expect(response.status).toBe(200);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect((await response.json()).activity).toEqual([]);
  });

  it("treats a racing duplicate that saved first as already recorded", async () => {
    db.dueItem.findFirstOrThrow.mockResolvedValueOnce(lentDue());
    db.duePayment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "pay-1" });
    db.$transaction.mockRejectedValueOnce(duplicateKey());

    const response = await POST(action("recordDuePayment", repayment, "due-1"));

    expect(response.status).toBe(200);
    expect((await response.json()).activity).toEqual([]);
  });
});

describe("completeDueItem", () => {
  it("settles a bill at the amount, date and account actually paid", async () => {
    db.dueItem.findFirstOrThrow.mockResolvedValueOnce(lentDue({ kind: "payment", title: "NEA electricity", person: "", category: "utilities", amountMinor: 250_000 }));

    const body = await (await POST(action("completeDueItem", { addToLedger: true, occurredOn: "2026-10-05", amountMinor: 231_000, paymentAccountId: "acct-1", clientRequestId: "settle-req-01" }, "due-1"))).json();

    expect(db.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "expense", category: "utilities", subcategory: null, amountMinor: 231_000, occurredOn: day("2026-10-05"), paymentMode: "online", paymentAccountId: "acct-1" }) });
    expect(db.dueItem.update).toHaveBeenCalledWith({ where: { id: "due-1" }, data: { status: "completed", completedOn: day("2026-10-05"), amountMinor: 231_000 } });
    expect(body.activity).toEqual([expect.objectContaining({ action: "due.settled", changes: [{ field: "Amount", from: { money: 250_000 }, to: { money: 231_000 } }] })]);
  });
});

describe("deleteDuePayment", () => {
  const payment = { id: "pay-1", userId: "user-1", dueItemId: "due-1", amountMinor: 300_000, transactionId: "tx-1", dueItem: { id: "due-1", title: "Bike repair", status: "completed" } };

  it("undoes only the latest repayment", async () => {
    db.duePayment.findFirstOrThrow.mockResolvedValueOnce(payment);
    db.duePayment.findFirst.mockResolvedValueOnce({ id: "pay-2" });

    const response = await POST(action("deleteDuePayment", undefined, "pay-1"));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Only the latest repayment can be undone.");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("removes the repayment and its ledger entry and reopens the due", async () => {
    db.duePayment.findFirstOrThrow.mockResolvedValueOnce(payment);
    db.duePayment.findFirst.mockResolvedValueOnce({ id: "pay-1" });
    db.transaction.findFirst.mockResolvedValueOnce({ id: "tx-1", paymentAccountId: "acct-1", occurredOn: day("2026-10-06"), createdAt: new Date() });

    const body = await (await POST(action("deleteDuePayment", undefined, "pay-1"))).json();

    expect(db.duePayment.deleteMany).toHaveBeenCalledWith({ where: { id: "pay-1", userId: "user-1" } });
    expect(db.transaction.updateMany).toHaveBeenCalledWith({ where: { id: "tx-1", userId: "user-1" }, data: { deletedAt: expect.any(Date) } });
    expect(db.dueItem.updateMany).toHaveBeenCalledWith({ where: { id: "due-1", userId: "user-1" }, data: { status: "open", completedOn: null } });
    expect(body.activity).toEqual([expect.objectContaining({ action: "due.payment_deleted", title: "Undid a repayment", meta: { reopened: true, removedFromLedger: true } })]);
  });
});

describe("saveSplitBill", () => {
  const split = { clientRequestId: "split-req-001", totalMinor: 240_000, myShareMinor: 60_000, shares: [{ person: "Ram", amountMinor: 60_000 }, { person: "Sita", amountMinor: 60_000 }, { person: "Hari", amountMinor: 60_000 }], category: "food", occurredOn: "2026-10-06", note: "Momo night", paymentAccountId: "acct-1" };

  it("spends only my share, lends the rest from the same account and opens a Lent due per person", async () => {
    const body = await (await POST(action("saveSplitBill", split))).json();

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "expense", category: "food", amountMinor: 60_000, paymentAccountId: "acct-1", clientRequestId: "split:split-req-001:mine" }) });
    expect(db.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "expense", category: "loan", subcategory: "Split bill", amountMinor: 180_000, paymentAccountId: "acct-1", clientRequestId: "split:split-req-001:lent" }) });
    const dues = db.dueItem.createMany.mock.calls[0][0].data as Record<string, unknown>[];
    expect(dues).toHaveLength(3);
    expect(dues[0]).toEqual(expect.objectContaining({ userId: "user-1", kind: "lent", title: "Momo night split", person: "Ram", amountMinor: 60_000, category: "loan", occurredOn: day("2026-10-06"), dueOn: day("2026-11-05") }));
    expect(body.activity).toEqual([expect.objectContaining({ action: "due.split_created", amountMinor: 240_000 })]);
  });

  it("saves a retried split once", async () => {
    db.transaction.count.mockResolvedValueOnce(2);

    const response = await POST(action("saveSplitBill", split));

    expect(response.status).toBe(200);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects shares that do not add up, a repeated person and the loan category", async () => {
    const short = await POST(action("saveSplitBill", { ...split, myShareMinor: 50_000 }));
    const repeated = await POST(action("saveSplitBill", { ...split, shares: [{ person: "Ram", amountMinor: 90_000 }, { person: " ram ", amountMinor: 90_000 }] }));
    const loan = await POST(action("saveSplitBill", { ...split, category: "loan" }));

    expect([short.status, repeated.status, loan.status]).toEqual([400, 400, 400]);
    expect((await short.json()).error).toBe("The shares must add up to the bill total.");
    expect((await repeated.json()).error).toBe("Each person can appear only once.");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
