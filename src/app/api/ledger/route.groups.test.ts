import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(async () => ({ currency: "NPR" })) },
    activityLog: {
      createManyAndReturn: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => data.map((row, index) => ({ id: `log-${index + 1}`, entityId: null, subject: null, amountMinor: null, changes: null, meta: null, ...row }))),
    },
    transaction: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    transactionGroup: { findMany: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    budget: { findMany: vi.fn() },
    recurringEntry: { findMany: vi.fn() },
    savingsGoal: { findMany: vi.fn() },
    customCategory: { findMany: vi.fn() },
    customSubcategory: { findMany: vi.fn() },
    paymentAccount: { findMany: vi.fn() },
    accountReconciliation: { findMany: vi.fn() },
    savedPlace: { findMany: vi.fn() },
    accountTransfer: { findMany: vi.fn() },
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
const post = (action: string, payload: unknown, id?: string) => new Request("http://localhost/api/ledger", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action, payload, id }),
});
// Each group lookup is scoped to the signed-in user; only "g-pokhara" and "g-wedding" are theirs.
const ownGroups: Record<string, string> = { "g-pokhara": "Pokhara trip", "g-wedding": "Sita's wedding" };
// The assignment lookup selects only the listed rows; the ledger reload after the action reads everything else.
const listedRows = (rows: { id: string; groupId: string | null }[]) => db.transaction.findMany.mockImplementation(async ({ where }: { where?: { id?: { in: string[] } } }) => where?.id ? rows : []);

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUniqueOrThrow.mockResolvedValue(user);
  for (const table of [db.transaction, db.transactionGroup, db.budget, db.recurringEntry, db.savingsGoal, db.customCategory, db.customSubcategory, db.paymentAccount, db.accountReconciliation, db.savedPlace, db.accountTransfer, db.dueItem]) table.findMany.mockResolvedValue([]);
  db.transactionGroup.findFirst.mockImplementation(async ({ where }: { where: { id: string; userId: string } }) => where.userId === "user-1" && ownGroups[where.id] ? { id: where.id, name: ownGroups[where.id], _count: { transactions: 3 } } : null);
  db.$transaction.mockImplementation(async (callback: (client: typeof db) => unknown) => callback(db));
});

describe("putting transactions into a group", () => {
  it("moves only the entries not already there, in one database transaction, and logs it once", async () => {
    listedRows([{ id: "tx-1", groupId: null }, { id: "tx-2", groupId: "g-pokhara" }, { id: "tx-3", groupId: null }]);
    db.transaction.updateMany.mockResolvedValue({ count: 2 });
    const response = await POST(post("setTransactionGroup", { groupId: "g-pokhara", ids: ["tx-1", "tx-2", "tx-3"] }));
    expect(response.status).toBe(200);
    expect(db.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["tx-1", "tx-2", "tx-3"] }, userId: "user-1", deletedAt: null } }));
    expect(db.transaction.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["tx-1", "tx-3"] }, userId: "user-1", deletedAt: null }, data: { groupId: "g-pokhara" } });
    const { activity } = await response.json();
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ action: "transactions.grouped", title: "Added 2 transactions to Pokhara trip", meta: { count: 2 } });
  });

  it("says where entries moved from when they were in another group", async () => {
    listedRows([{ id: "tx-1", groupId: "g-wedding" }]);
    db.transaction.updateMany.mockResolvedValue({ count: 1 });
    const { activity } = await (await POST(post("setTransactionGroup", { groupId: "g-pokhara", ids: ["tx-1"] }))).json();
    expect(activity[0].changes).toEqual([{ field: "Group", from: "Sita's wedding", to: "Pokhara trip" }]);
  });

  it("takes entries out of their group with null", async () => {
    listedRows([{ id: "tx-1", groupId: "g-pokhara" }, { id: "tx-2", groupId: "g-pokhara" }]);
    db.transaction.updateMany.mockResolvedValue({ count: 2 });
    const response = await POST(post("setTransactionGroup", { groupId: null, ids: ["tx-1", "tx-2"] }));
    expect(db.transaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { groupId: null } }));
    expect((await response.json()).activity[0]).toMatchObject({ action: "transactions.ungrouped", title: "Removed 2 transactions from Pokhara trip" });
  });

  it("refuses someone else's group before touching any entry", async () => {
    const response = await POST(post("setTransactionGroup", { groupId: "g-partner", ids: ["tx-1"] }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/group no longer exists/);
    expect(db.transaction.updateMany).not.toHaveBeenCalled();
  });

  it("refuses the whole move when an entry is missing or belongs to someone else", async () => {
    listedRows([{ id: "tx-1", groupId: null }]);
    const response = await POST(post("setTransactionGroup", { groupId: "g-pokhara", ids: ["tx-1", "tx-partner"] }));
    expect(response.status).toBe(400);
    expect(db.transaction.updateMany).not.toHaveBeenCalled();
  });

  it("rolls back when an entry disappears between the check and the write", async () => {
    listedRows([{ id: "tx-1", groupId: null }, { id: "tx-2", groupId: null }]);
    db.transaction.updateMany.mockResolvedValue({ count: 1 });
    const response = await POST(post("setTransactionGroup", { groupId: "g-pokhara", ids: ["tx-1", "tx-2"] }));
    expect(response.status).toBe(400);
    expect((await response.json()).activity).toBeUndefined();
  });

  it("does nothing and logs nothing when a retry finds the entries already moved", async () => {
    listedRows([{ id: "tx-1", groupId: "g-pokhara" }]);
    const response = await POST(post("setTransactionGroup", { groupId: "g-pokhara", ids: ["tx-1"] }));
    expect(response.status).toBe(200);
    expect(db.transaction.updateMany).not.toHaveBeenCalled();
    expect((await response.json()).activity).toEqual([]);
  });
});

describe("managing groups", () => {
  it("creates a group with its dates and logs it", async () => {
    db.transactionGroup.create.mockResolvedValue({ id: "g-new" });
    const response = await POST(post("saveTransactionGroup", { name: " Pokhara trip ", icon: "trip", startOn: "2026-10-12", endOn: "2026-10-16", note: "" }));
    expect(response.status).toBe(200);
    expect(db.transactionGroup.create).toHaveBeenCalledWith({ data: { name: "Pokhara trip", icon: "trip", startOn: new Date("2026-10-12T00:00:00.000Z"), endOn: new Date("2026-10-16T00:00:00.000Z"), note: "", userId: "user-1" } });
    expect((await response.json()).activity[0]).toMatchObject({ action: "group.created", subject: "Pokhara trip" });
  });

  it("refuses an end date before the start", async () => {
    const response = await POST(post("saveTransactionGroup", { name: "Trip", icon: "trip", startOn: "2026-10-16", endOn: "2026-10-12", note: "" }));
    expect(response.status).toBe(400);
    expect(db.transactionGroup.create).not.toHaveBeenCalled();
  });

  it("edits only the user's own group and logs what changed", async () => {
    db.transactionGroup.findFirstOrThrow.mockResolvedValue({ name: "Pokhara", icon: "trip", startOn: null, endOn: null, note: "" });
    const response = await POST(post("saveTransactionGroup", { name: "Pokhara trip", icon: "mountain", startOn: null, endOn: null, note: "" }, "g-pokhara"));
    expect(db.transactionGroup.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "g-pokhara", userId: "user-1" } }));
    expect((await response.json()).activity[0].changes).toEqual([{ field: "Name", from: "Pokhara", to: "Pokhara trip" }, { field: "Icon", from: "Trip", to: "Trek" }]);
  });

  it("removes a group but keeps its transactions", async () => {
    db.transactionGroup.deleteMany.mockResolvedValue({ count: 1 });
    const response = await POST(post("deleteTransactionGroup", undefined, "g-pokhara"));
    expect(db.transactionGroup.deleteMany).toHaveBeenCalledWith({ where: { id: "g-pokhara", userId: "user-1" } });
    expect(db.transaction.updateMany).not.toHaveBeenCalled();
    expect((await response.json()).activity[0]).toMatchObject({ action: "group.deleted", subject: "Pokhara trip", meta: { count: 3 } });
  });

  it("will not file a new entry under someone else's group", async () => {
    db.transaction.findFirst.mockResolvedValue(null);
    const response = await POST(post("saveTransaction", { kind: "expense", category: "food", amountMinor: 5000, occurredOn: "2026-10-12", note: "Momo", subcategory: null, area: null, paymentMode: "cash", paymentAccountId: null, groupId: "g-partner" }));
    expect(response.status).toBe(400);
    expect(db.transaction.create).not.toHaveBeenCalled();
  });
});
