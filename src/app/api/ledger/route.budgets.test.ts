import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const budgetTx = { findMany: vi.fn(), upsert: vi.fn() };
  const db = {
    user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(async () => ({ currency: "NPR" })) },
    activityLog: {
      createManyAndReturn: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => data.map((row, index) => ({ id: `log-${index + 1}`, entityId: null, subject: null, amountMinor: null, changes: null, meta: null, ...row }))),
    },
    transaction: { findMany: vi.fn() },
    budget: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), count: vi.fn(), deleteMany: vi.fn() },
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
    $transaction: vi.fn(async (callback: (client: { budget: typeof budgetTx }) => unknown) => callback({ budget: budgetTx })),
  };
  return { db, budgetTx };
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.user.findUniqueOrThrow.mockResolvedValue({ id: "user-1", name: "Test User", email: "test@example.com", currency: "NPR", hideAmounts: false, autoLockMinutes: 0, calendarSystem: "AD", safeToSpendBufferMinor: 0, emailReminders: false, browserReminders: false, learningProfile: null, householdMembership: null, pinHash: null });
  for (const table of [mocks.db.transaction, mocks.db.budget, mocks.db.recurringEntry, mocks.db.savingsGoal, mocks.db.customCategory, mocks.db.customSubcategory, mocks.db.paymentAccount, mocks.db.accountReconciliation, mocks.db.savedPlace, mocks.db.accountTransfer, mocks.db.dueItem]) table.findMany.mockResolvedValue([]);
  mocks.budgetTx.findMany.mockResolvedValue([]);
  mocks.budgetTx.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ id: `budget-${String(create.category)}`, ...create }));
  mocks.db.$transaction.mockImplementation(async (callback) => callback({ budget: mocks.budgetTx }));
});

describe("saveBudgets ledger action", () => {
  const batch = { monthKey: "2026-10", budgets: [{ category: "__total", amountMinor: 4_000_000 }, { category: "food", amountMinor: 1_500_000, shared: false }, { category: "category-festival", amountMinor: 900_000 }] };

  it("saves every budget for the month in one database transaction and logs one entry", async () => {
    mocks.db.customCategory.findMany.mockResolvedValueOnce([{ id: "category-festival" }]);

    const response = await POST(action("saveBudgets", batch));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.budgetTx.upsert).toHaveBeenCalledTimes(3);
    expect(mocks.budgetTx.upsert).toHaveBeenCalledWith({
      where: { userId_monthKey_category: { userId: "user-1", monthKey: "2026-10", category: "__total" } },
      update: { monthKey: "2026-10", scope: "month", category: "__total", amountMinor: 4_000_000 },
      create: { monthKey: "2026-10", scope: "month", category: "__total", amountMinor: 4_000_000, userId: "user-1" },
    });
    expect(mocks.budgetTx.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1", monthKey: "2026-10", category: { in: ["__total", "food", "category-festival"] } } }));
    expect(mocks.db.activityLog.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(body.activity).toEqual([expect.objectContaining({ action: "budgets.saved", area: "planning", title: "Set 3 budgets", subject: "October 2026", amountMinor: 6_400_000 })]);
    expect(body.budgets).toEqual([]);
  });

  it("counts only budgets that actually changed and stays quiet when a retry changes nothing", async () => {
    mocks.db.customCategory.findMany.mockResolvedValueOnce([{ id: "category-festival" }]);
    mocks.budgetTx.findMany.mockResolvedValueOnce(batch.budgets.map((budget) => ({ category: budget.category, amountMinor: budget.amountMinor, shared: false })));

    const body = await (await POST(action("saveBudgets", batch))).json();

    expect(body.activity).toEqual([]);
    expect(mocks.db.activityLog.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("treats a racing duplicate request that created the rows first as already saved", async () => {
    mocks.db.customCategory.findMany.mockResolvedValueOnce([{ id: "category-festival" }]);
    mocks.db.$transaction.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    mocks.db.budget.count.mockResolvedValueOnce(3);

    const response = await POST(action("saveBudgets", batch));

    expect(response.status).toBe(200);
    expect(mocks.db.budget.count).toHaveBeenCalledWith({ where: { userId: "user-1", monthKey: "2026-10", category: { in: ["__total", "food", "category-festival"] } } });
  });

  it("rejects loan, income and unknown categories before writing anything", async () => {
    for (const category of ["loan", "salary", "category-someone-elses"]) {
      const response = await POST(action("saveBudgets", { monthKey: "2026-10", budgets: [{ category, amountMinor: 100 }] }));

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("One or more budget categories are invalid.");
    }
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects the same category twice and an empty batch", async () => {
    const duplicate = await POST(action("saveBudgets", { monthKey: "2026-10", budgets: [{ category: "food", amountMinor: 100 }, { category: "food", amountMinor: 200 }] }));
    const empty = await POST(action("saveBudgets", { monthKey: "2026-10", budgets: [] }));

    expect(duplicate.status).toBe(400);
    expect((await duplicate.json()).error).toBe("Each category can only have one budget per period.");
    expect(empty.status).toBe(400);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("stores a festival season with the festival scope", async () => {
    const body = await (await POST(action("saveBudgets", { monthKey: "FEST:dashain-tihar-2083", budgets: [{ category: "__total", amountMinor: 6_000_000 }] }))).json();

    expect(mocks.budgetTx.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ monthKey: "FEST:dashain-tihar-2083", scope: "festival" }) }));
    expect(body.activity).toEqual([expect.objectContaining({ action: "budgets.saved", title: "Set 1 budget", subject: "Dashain–Tihar 2083" })]);
  });
});

describe("saveBudget ledger action", () => {
  it("accepts the reserved All spending category and names it in the log", async () => {
    mocks.db.budget.findUnique.mockResolvedValueOnce(null);
    mocks.db.budget.upsert.mockResolvedValueOnce({ id: "budget-total" });

    const body = await (await POST(action("saveBudget", { monthKey: "2026-10", category: "__total", amountMinor: 4_000_000, shared: false }))).json();

    expect(body.activity).toEqual([expect.objectContaining({ action: "budget.created", title: "Set a budget", subject: "All spending · October 2026" })]);
  });

  it("edits a budget by id and refuses one that is not the user's", async () => {
    mocks.db.budget.findFirst.mockResolvedValueOnce({ id: "budget-1", monthKey: "2026-10", category: "food", amountMinor: 1_000_000, shared: false });
    const edited = await (await POST(action("saveBudget", { monthKey: "2026-10", category: "food", amountMinor: 1_200_000 }, "budget-1"))).json();

    expect(mocks.db.budget.updateMany).toHaveBeenCalledWith({ where: { id: "budget-1", userId: "user-1" }, data: { monthKey: "2026-10", scope: "month", category: "food", amountMinor: 1_200_000 } });
    expect(edited.activity).toEqual([expect.objectContaining({ action: "budget.edited", changes: [{ field: "Limit", from: { money: 1_000_000 }, to: { money: 1_200_000 } }] })]);

    mocks.db.budget.findFirst.mockResolvedValueOnce(null);
    const refused = await POST(action("saveBudget", { monthKey: "2026-10", category: "food", amountMinor: 1_200_000 }, "budget-of-partner"));

    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe("That budget is not yours to change.");
    expect(mocks.db.budget.updateMany).toHaveBeenCalledTimes(1);
  });

  it("validates the category the same way as the batch action", async () => {
    for (const category of ["loan", "salary", "category-someone-elses"]) {
      const response = await POST(action("saveBudget", { monthKey: "2026-10", category, amountMinor: 100 }));

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("Choose a spending category for this budget.");
    }
    mocks.db.customCategory.findMany.mockResolvedValueOnce([{ id: "category-festival" }]);
    mocks.db.budget.findUnique.mockResolvedValueOnce(null);
    mocks.db.budget.upsert.mockResolvedValueOnce({ id: "budget-custom" });
    expect((await POST(action("saveBudget", { monthKey: "2026-10", category: "category-festival", amountMinor: 100 }))).status).toBe(200);
    expect(mocks.db.customCategory.findMany).toHaveBeenCalledWith({ where: { userId: "user-1", kind: { in: ["expense", "both"] } }, select: { id: true } });
    expect(mocks.db.budget.upsert).toHaveBeenCalledTimes(1);
  });

  it("accepts a known festival season and refuses a festival key no season matches", async () => {
    mocks.db.budget.findUnique.mockResolvedValueOnce(null);
    mocks.db.budget.upsert.mockResolvedValueOnce({ id: "budget-fest" });
    const saved = await (await POST(action("saveBudget", { monthKey: "FEST:dashain-tihar-2083", category: "__total", amountMinor: 6_000_000 }))).json();

    expect(mocks.db.budget.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ monthKey: "FEST:dashain-tihar-2083", scope: "festival", category: "__total" }) }));
    expect(saved.activity).toEqual([expect.objectContaining({ action: "budget.created", subject: "All spending · Dashain–Tihar 2083" })]);

    for (const monthKey of ["FEST:dashain-2083", "FEST:foo-2083", "FEST:holi"]) {
      const single = await POST(action("saveBudget", { monthKey, category: "__total", amountMinor: 100 }));
      const batch = await POST(action("saveBudgets", { monthKey, budgets: [{ category: "__total", amountMinor: 100 }] }));

      expect(single.status).toBe(400);
      expect((await single.json()).error).toBe("Choose a festival season from the list.");
      expect(batch.status).toBe(400);
    }
    expect(mocks.db.budget.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});
