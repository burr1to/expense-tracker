import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(async () => ({ currency: "NPR" })) },
    activityLog: {
      createManyAndReturn: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => data.map((row, index) => ({ id: `log-${index + 1}`, entityId: null, subject: null, amountMinor: null, changes: null, meta: null, ...row }))),
    },
    transaction: { findMany: vi.fn(), updateMany: vi.fn() },
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
    dueItem: { findMany: vi.fn() },
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
const user = { id: "user-1", name: "Asha", email: "asha@example.com", currency: "NPR", hideAmounts: false, autoLockMinutes: 0, calendarSystem: "AD", safeToSpendBufferMinor: 0, emailReminders: false, browserReminders: false, learningProfile: null, householdMembership: null, pinHash: null };
const edit = (payload: unknown) => new Request("http://localhost/api/ledger", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "updateTransactions", payload }),
});
const row = (over: Record<string, unknown>) => ({ id: "tx-1", kind: "expense", category: "food", subcategory: null, occurredOn: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-10-01T08:00:00Z"), paymentMode: "cash", paymentAccountId: null, shared: false, ...over });
// The bulk lookup selects only the edited rows; the ledger reload after the action reads everything else.
const editedRows = (rows: Record<string, unknown>[]) => db.transaction.findMany.mockImplementation(async ({ where }: { where?: { id?: { in: string[] } } }) => where?.id ? rows : []);

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUniqueOrThrow.mockResolvedValue(user);
  for (const table of [db.transaction, db.budget, db.recurringEntry, db.savingsGoal, db.customCategory, db.customSubcategory, db.paymentAccount, db.accountReconciliation, db.savedPlace, db.accountTransfer, db.dueItem, db.transactionGroup]) table.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (callback: (client: typeof db) => unknown) => callback(db));
});

describe("editing several transactions at once", () => {
  it("writes one change set to the changed entries in a single database transaction and logs it once", async () => {
    editedRows([row({ id: "tx-1", category: "food" }), row({ id: "tx-2", category: "transport", subcategory: "Taxi" }), row({ id: "tx-3", category: "transport" })]);
    db.transaction.updateMany.mockResolvedValue({ count: 2 });
    const response = await POST(edit({ ids: ["tx-1", "tx-2", "tx-3"], changes: { category: { kind: "expense", category: "transport", subcategory: null } } }));
    expect(response.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.transaction.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["tx-1", "tx-2"] }, userId: "user-1", deletedAt: null }, data: { kind: "expense", category: "transport", subcategory: null } });
    const { activity } = await response.json();
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ action: "transactions.bulk_edited", title: "Edited 2 transactions", meta: { count: 2 } });
    expect(activity[0].changes).toContainEqual({ field: "Category", from: "Various", to: "Transport" });
  });

  it("never touches location, notes or amounts", async () => {
    editedRows([row({})]);
    db.transaction.updateMany.mockResolvedValue({ count: 1 });
    await POST(edit({ ids: ["tx-1"], changes: { occurredOn: "2026-10-04" } }));
    const { data } = db.transaction.updateMany.mock.calls[0][0];
    expect(Object.keys(data)).toEqual(["occurredOn"]);
  });

  it("refuses the whole edit when an entry is missing or belongs to someone else", async () => {
    editedRows([row({ id: "tx-1" })]);
    const response = await POST(edit({ ids: ["tx-1", "tx-partner"], changes: { occurredOn: "2026-10-04" } }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/changed or removed elsewhere/);
    expect(db.transaction.updateMany).not.toHaveBeenCalled();
  });

  it("rolls back when an entry disappears between the check and the write", async () => {
    editedRows([row({ id: "tx-1" }), row({ id: "tx-2" })]);
    db.transaction.updateMany.mockResolvedValue({ count: 1 });
    const response = await POST(edit({ ids: ["tx-1", "tx-2"], changes: { occurredOn: "2026-10-04" } }));
    expect(response.status).toBe(400);
    expect(db.activityLog.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("rejects a category that does not fit the chosen type", async () => {
    editedRows([row({})]);
    db.customCategory.findFirst.mockResolvedValue(null);
    const response = await POST(edit({ ids: ["tx-1"], changes: { category: { kind: "income", category: "food", subcategory: null } } }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/cannot be used for income/);
  });

  it("refuses to move entries into an approved reconciliation", async () => {
    editedRows([row({ paymentMode: "online", paymentAccountId: "acc-1", occurredOn: new Date("2026-10-20T00:00:00Z") })]);
    db.accountReconciliation.findMany.mockResolvedValue([{ paymentAccountId: "acc-1", checkedOn: new Date("2026-10-15T00:00:00Z"), approvedAt: new Date("2026-10-15T12:00:00Z") }]);
    const response = await POST(edit({ ids: ["tx-1"], changes: { occurredOn: "2026-10-10" } }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/approved reconciliation/);
    expect(db.transaction.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing and logs nothing when a retry finds the entries already changed", async () => {
    editedRows([row({ occurredOn: new Date("2026-10-04T00:00:00Z") })]);
    const response = await POST(edit({ ids: ["tx-1"], changes: { occurredOn: "2026-10-04" } }));
    expect(response.status).toBe(200);
    expect(db.transaction.updateMany).not.toHaveBeenCalled();
    expect((await response.json()).activity).toEqual([]);
  });

  it("needs at least one change and online payments need an account", async () => {
    expect((await POST(edit({ ids: ["tx-1"], changes: {} }))).status).toBe(400);
    expect((await POST(edit({ ids: ["tx-1"], changes: { payment: { paymentMode: "online", paymentAccountId: null } } }))).status).toBe(400);
  });
});
