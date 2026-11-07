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
    transactionGroup: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    dueItem: { findMany: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), aggregate: vi.fn() },
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
const lentDue = (changes: Record<string, unknown> = {}) => ({ id: "due-1", userId: "user-1", kind: "lent", title: "Bike repair", person: "Ram", category: "loan", amountMinor: 500_000, status: "open", completedOn: null, payments: [] as { amountMinor: number }[], ...changes });
const esewa = { id: "acct-1", userId: "user-1", shared: false, type: "esewa", provider: "eSewa", label: "" };

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUniqueOrThrow.mockResolvedValue({ id: "user-1", name: "Test User", email: "test@example.com", currency: "NPR", hideAmounts: false, autoLockMinutes: 0, calendarSystem: "AD", safeToSpendBufferMinor: 0, emailReminders: false, browserReminders: false, learningProfile: null, householdMembership: null, pinHash: null });
  for (const table of [db.transaction, db.budget, db.recurringEntry, db.savingsGoal, db.customCategory, db.customSubcategory, db.paymentAccount, db.accountReconciliation, db.savedPlace, db.accountTransfer, db.dueItem, db.transactionGroup]) table.findMany.mockResolvedValue([]);
  db.paymentAccount.findFirst.mockResolvedValue(esewa);
  db.transaction.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `tx-${String(data.clientRequestId ?? "new")}`, ...data }));
  db.dueItem.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "due-1", ...data }));
  db.duePayment.findFirst.mockResolvedValue(null);
  db.transaction.count.mockResolvedValue(0);
  db.dueItem.aggregate.mockResolvedValue({ _sum: { amountMinor: null } });
  db.$transaction.mockImplementation(async (callback: (client: typeof db) => unknown) => callback(db));
});

// An entry already in the ledger, as the route reads it.
const dinner = (changes: Record<string, unknown> = {}) => ({ id: "tx-dinner", kind: "expense", category: "food", subcategory: "Restaurant", amountMinor: 300_000, occurredOn: day("2026-10-01"), note: "Thakali dinner", clientRequestId: null, ...changes });

describe("linking a loan to an entry already in the ledger", () => {
  const lent = { kind: "lent", title: "Dinner", person: "Ram", amountMinor: 300_000, category: "loan", occurredOn: "2026-10-01", dueOn: "2026-10-31", remindOn: null, note: "", annualRatePercent: null, movement: "link", linkTransactionId: "tx-dinner" };

  it("files the whole entry as the loan instead of writing a second one, remembering what it was", async () => {
    db.transaction.findFirst.mockResolvedValueOnce(dinner());

    const body = await (await POST(action("saveDueItem", lent))).json();

    expect(db.transaction.create).not.toHaveBeenCalled();
    expect(db.dueItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "lent", linkedTransactionId: "tx-dinner", linkedRestoreCategory: "food", linkedRestoreSubcategory: "Restaurant" }) });
    expect(db.transaction.updateMany).toHaveBeenCalledWith({ where: { id: "tx-dinner", userId: "user-1" }, data: { category: "loan", subcategory: "Lent" } });
    expect(body.activity).toEqual([expect.objectContaining({ action: "due.created", meta: expect.objectContaining({ movement: "Linked: Thakali dinner" }) })]);
  });

  it("leaves an entry that is only partly the loan as spending", async () => {
    db.transaction.findFirst.mockResolvedValueOnce(dinner());

    await POST(action("saveDueItem", { ...lent, amountMinor: 100_000 }));

    expect(db.dueItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ linkedTransactionId: "tx-dinner", linkedRestoreCategory: null }) });
    expect(db.transaction.updateMany).not.toHaveBeenCalled();
  });

  it("refuses more than is left of an entry other dues already share", async () => {
    db.transaction.findFirst.mockResolvedValueOnce(dinner());
    db.dueItem.aggregate.mockResolvedValueOnce({ _sum: { amountMinor: 250_000 } });

    const response = await POST(action("saveDueItem", { ...lent, amountMinor: 100_000 }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/more than is left of that entry/);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses money moving the wrong way, an entry a due wrote, and a repayment already recorded", async () => {
    db.transaction.findFirst.mockResolvedValueOnce(dinner({ kind: "income" }));
    const wrongWay = await POST(action("saveDueItem", lent));
    db.transaction.findFirst.mockResolvedValueOnce(dinner({ clientRequestId: "split:abc:lent" }));
    const owned = await POST(action("saveDueItem", lent));
    db.transaction.findFirst.mockResolvedValueOnce(dinner());
    db.duePayment.findFirst.mockResolvedValueOnce({ id: "pay-9" });
    const repayment = await POST(action("saveDueItem", lent));
    db.transaction.findFirst.mockResolvedValueOnce(null);
    const gone = await POST(action("saveDueItem", lent));

    expect([wrongWay.status, owned.status, repayment.status, gone.status]).toEqual([400, 400, 400, 400]);
    expect((await wrongWay.json()).error).toBe("Choose money that went out.");
    expect(db.dueItem.create).not.toHaveBeenCalled();
  });

  it("gives the entry its category back when the loan stops being linked to it", async () => {
    const existing = { id: "due-1", userId: "user-1", kind: "lent", title: "Dinner", person: "Ram", amountMinor: 300_000, category: "loan", occurredOn: day("2026-10-01"), dueOn: day("2026-10-31"), remindOn: null, note: "", annualRatePercent: null, payments: [], linkedTransactionId: "tx-dinner", linkedRestoreCategory: "food", linkedRestoreSubcategory: "Restaurant" };
    db.dueItem.findFirstOrThrow.mockResolvedValueOnce(existing);
    db.transaction.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ note: "Thakali dinner", category: "loan" });

    const body = await (await POST(action("saveDueItem", { ...lent, movement: "cash", linkTransactionId: undefined }, "due-1"))).json();

    expect(db.dueItem.update).toHaveBeenCalledWith({ where: { id: "due-1" }, data: expect.objectContaining({ linkedTransactionId: null, linkedRestoreCategory: null }) });
    expect(db.transaction.updateMany).toHaveBeenCalledWith({ where: { id: "tx-dinner", userId: "user-1", category: "loan" }, data: { category: "food", subcategory: "Restaurant" } });
    expect(db.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ category: "loan", subcategory: "Lent", clientRequestId: "due-open:due-1" }) });
    expect(body.activity).toEqual([expect.objectContaining({ action: "due.edited", changes: expect.arrayContaining([{ field: "Money left from", from: "Linked: Thakali dinner", to: "Cash" }]) })]);
  });

  it("keeps a linked entry when its loan is deleted, with its category back", async () => {
    db.dueItem.findFirst.mockResolvedValueOnce({ title: "Dinner", amountMinor: 300_000, linkedTransactionId: "tx-dinner", linkedRestoreCategory: "food", linkedRestoreSubcategory: "Restaurant", payments: [{ transactionId: "tx-salary", linked: true, linkedRestoreCategory: "other", linkedRestoreSubcategory: null }] });
    db.transaction.findMany.mockResolvedValueOnce([]);
    db.dueItem.deleteMany.mockResolvedValueOnce({ count: 1 });

    await POST(action("deleteDueItem", undefined, "due-1"));

    expect(db.transaction.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ OR: [{ clientRequestId: "due-open:due-1" }, { id: { in: [] } }] }) }));
    expect(db.transaction.updateMany).toHaveBeenCalledWith({ where: { id: "tx-dinner", userId: "user-1", category: "loan" }, data: { category: "food", subcategory: "Restaurant" } });
    expect(db.transaction.updateMany).toHaveBeenCalledWith({ where: { id: "tx-salary", userId: "user-1", category: "loan" }, data: { category: "other", subcategory: null } });
    expect(db.transaction.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { deletedAt: expect.any(Date) } }));
  });
});

describe("settling with an entry already in the ledger", () => {
  const repaid = (changes: Record<string, unknown> = {}) => dinner({ id: "tx-in", kind: "income", category: "other", subcategory: null, amountMinor: 200_000, note: "Ram eSewa", ...changes });

  it("records a whole incoming entry as the repayment, filed as a loan movement, without writing another", async () => {
    db.dueItem.findFirstOrThrow.mockResolvedValueOnce(lentDue());
    db.transaction.findFirst.mockResolvedValueOnce(repaid());

    const body = await (await POST(action("recordDuePayment", { amountMinor: 200_000, occurredOn: "2026-10-06", note: "", addToLedger: true, paymentAccountId: "acct-1", clientRequestId: "repay-link-01", linkTransactionId: "tx-in" }, "due-1"))).json();

    expect(db.transaction.create).not.toHaveBeenCalled();
    expect(db.transaction.updateMany).toHaveBeenCalledWith({ where: { id: "tx-in", userId: "user-1" }, data: { category: "loan", subcategory: "Repayment" } });
    expect(db.duePayment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amountMinor: 200_000, transactionId: "tx-in", linked: true, linkedRestoreCategory: "other", linkedRestoreSubcategory: null }) });
    expect(body.activity).toEqual([expect.objectContaining({ action: "due.payment_recorded", meta: expect.objectContaining({ addedToLedger: false, linked: "Ram eSewa" }) })]);
  });

  it("refuses an entry that is already a loan's own money, or smaller than the repayment", async () => {
    db.dueItem.findFirstOrThrow.mockResolvedValueOnce(lentDue());
    db.transaction.findFirst.mockResolvedValueOnce(repaid());
    db.dueItem.findFirst.mockResolvedValueOnce({ id: "due-2" });
    const opening = await POST(action("recordDuePayment", { amountMinor: 200_000, occurredOn: "2026-10-06", note: "", addToLedger: true, linkTransactionId: "tx-in" }, "due-1"));
    db.dueItem.findFirstOrThrow.mockResolvedValueOnce(lentDue());
    db.transaction.findFirst.mockResolvedValueOnce(repaid());
    const small = await POST(action("recordDuePayment", { amountMinor: 300_000, occurredOn: "2026-10-06", note: "", addToLedger: true, linkTransactionId: "tx-in" }, "due-1"));

    expect([opening.status, small.status]).toEqual([400, 400]);
    expect((await small.json()).error).toBe("This is more than that entry's amount.");
    expect(db.duePayment.create).not.toHaveBeenCalled();
  });

  it("marks a bill paid with an entry and leaves the entry's category as it is", async () => {
    db.dueItem.findFirstOrThrow.mockResolvedValueOnce(lentDue({ kind: "payment", title: "NEA electricity", person: "", category: "utilities", amountMinor: 250_000 }));
    db.transaction.findFirst.mockResolvedValueOnce(dinner({ id: "tx-nea", category: "utilities", subcategory: null, amountMinor: 231_000, note: "NEA" }));

    await POST(action("completeDueItem", { addToLedger: true, occurredOn: "2026-10-05", amountMinor: 231_000, clientRequestId: "settle-link-01", linkTransactionId: "tx-nea" }, "due-1"));

    expect(db.transaction.create).not.toHaveBeenCalled();
    expect(db.transaction.updateMany).not.toHaveBeenCalled();
    expect(db.duePayment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ transactionId: "tx-nea", linked: true, linkedRestoreCategory: null }) });
  });

  it("undoing a linked repayment keeps the entry and gives back its category", async () => {
    db.duePayment.findFirstOrThrow.mockResolvedValueOnce({ id: "pay-1", userId: "user-1", dueItemId: "due-1", amountMinor: 200_000, transactionId: "tx-in", linked: true, linkedRestoreCategory: "other", linkedRestoreSubcategory: null, dueItem: { id: "due-1", title: "Bike repair", status: "open" } });
    db.duePayment.findFirst.mockResolvedValueOnce({ id: "pay-1" });

    const body = await (await POST(action("deleteDuePayment", undefined, "pay-1"))).json();

    expect(db.transaction.findFirst).not.toHaveBeenCalled();
    expect(db.transaction.updateMany).toHaveBeenCalledTimes(1);
    expect(db.transaction.updateMany).toHaveBeenCalledWith({ where: { id: "tx-in", userId: "user-1", category: "loan" }, data: { category: "other", subcategory: null } });
    expect(body.activity).toEqual([expect.objectContaining({ action: "due.payment_deleted", meta: { reopened: false, removedFromLedger: false, unlinked: true } })]);
  });
});
