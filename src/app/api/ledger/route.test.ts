import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const receiptScanCreate = vi.fn();
  const transactionCreateMany = vi.fn();
  const customCategoryUpsert = vi.fn();
  const customSubcategoryFindFirst = vi.fn();
  const customSubcategoryCreate = vi.fn();
  const resetAccountFindFirstOrThrow = vi.fn();
  const resetAccountUpdate = vi.fn();
  const resetReconciliationFindFirst = vi.fn();
  const resetReconciliationDeleteMany = vi.fn();
  const transactionClient = {
    receiptScan: { create: receiptScanCreate },
    transaction: { createMany: transactionCreateMany },
    customCategory: { upsert: customCategoryUpsert },
    customSubcategory: { findFirst: customSubcategoryFindFirst, create: customSubcategoryCreate },
    paymentAccount: { findFirstOrThrow: resetAccountFindFirstOrThrow, update: resetAccountUpdate },
    accountReconciliation: { findFirst: resetReconciliationFindFirst, deleteMany: resetReconciliationDeleteMany },
  };
  const db = {
    user: { findUniqueOrThrow: vi.fn() },
    transaction: { findMany: vi.fn(), findFirstOrThrow: vi.fn(), update: vi.fn() },
    budget: { findMany: vi.fn() },
    recurringEntry: { findMany: vi.fn() },
    savingsGoal: { findMany: vi.fn() },
    customCategory: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    customSubcategory: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    paymentAccount: { count: vi.fn(), findMany: vi.fn() },
    accountReconciliation: { findFirst: vi.fn(), findMany: vi.fn() },
    savedPlace: { findMany: vi.fn() },
    accountTransfer: { findMany: vi.fn() },
    dueItem: { findMany: vi.fn() },
    receiptScan: { count: vi.fn() },
    $transaction: vi.fn(async (callback: (client: typeof transactionClient) => unknown) => callback(transactionClient)),
  };
  return {
    db,
    receiptScanCreate,
    transactionCreateMany,
    customCategoryUpsert,
    customSubcategoryFindFirst,
    customSubcategoryCreate,
    resetAccountFindFirstOrThrow,
    resetAccountUpdate,
    resetReconciliationFindFirst,
    resetReconciliationDeleteMany,
    verifyStoredReceipt: vi.fn(),
  };
});

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("../../../lib/auth", () => ({ getBetaSession: vi.fn(async () => ({ user: { id: "user-1" } })) }));
vi.mock("../../../lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("../../../lib/receipt-storage", () => ({
  removeStoredReceipts: vi.fn(),
  verifyStoredReceipt: mocks.verifyStoredReceipt,
}));

import { POST } from "./route";

const receipt = {
  name: "synthetic-receipt.jpg",
  mimeType: "image/jpeg",
  size: 1024,
  storagePath: "user-1/synthetic.jpg",
};

const split = (category: string, amountMinor: number, note: string) => ({
  kind: "expense",
  category,
  amountMinor,
  occurredOn: "2026-07-26",
  note,
  subcategory: null,
  area: null,
  paymentMode: "cash",
  paymentAccountId: null,
});

function request(totalMinor: number, transactions = [
  split("food", 700, "Synthetic shop · Food"),
  split("other", 300, "Synthetic shop · Household"),
]) {
  return new Request("http://localhost/api/ledger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "saveReceiptSplit", payload: { receipt, totalMinor, transactions } }),
  });
}

describe("saveReceiptSplit ledger action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.user.findUniqueOrThrow.mockResolvedValue({
      id: "user-1",
      name: "Test User",
      currency: "NPR",
      hideAmounts: false,
      autoLockMinutes: 0,
      pinHash: null,
    });
    mocks.db.transaction.findMany.mockResolvedValue([]);
    mocks.db.budget.findMany.mockResolvedValue([]);
    mocks.db.recurringEntry.findMany.mockResolvedValue([]);
    mocks.db.savingsGoal.findMany.mockResolvedValue([]);
    mocks.db.customCategory.findMany.mockResolvedValue([]);
    mocks.db.customSubcategory.findMany.mockResolvedValue([]);
    mocks.db.paymentAccount.findMany.mockResolvedValue([]);
    mocks.db.paymentAccount.count.mockResolvedValue(0);
    mocks.db.accountReconciliation.findMany.mockResolvedValue([]);
    mocks.db.accountReconciliation.findFirst.mockResolvedValue(null);
    mocks.db.savedPlace.findMany.mockResolvedValue([]);
    mocks.db.accountTransfer.findMany.mockResolvedValue([]);
    mocks.db.dueItem.findMany.mockResolvedValue([]);
    mocks.db.receiptScan.count.mockResolvedValue(0);
    mocks.receiptScanCreate.mockResolvedValue({ id: "scan-1" });
    mocks.transactionCreateMany.mockResolvedValue({ count: 2 });
    mocks.customCategoryUpsert.mockResolvedValue({ id: "category-investments" });
    mocks.customSubcategoryFindFirst.mockResolvedValue(null);
    mocks.customSubcategoryCreate.mockResolvedValue({ id: "subcategory-index-funds" });
    mocks.resetAccountFindFirstOrThrow.mockResolvedValue({ id: "account-1", createdAt: new Date("2026-07-01T08:00:00.000Z") });
    mocks.resetAccountUpdate.mockResolvedValue({ id: "account-1" });
    mocks.resetReconciliationFindFirst.mockResolvedValue({ startingBalanceMinor: 100000, startingBalanceAsOf: new Date("2026-07-01T00:00:00.000Z") });
    mocks.resetReconciliationDeleteMany.mockResolvedValue({ count: 1 });
    mocks.verifyStoredReceipt.mockResolvedValue(undefined);
    mocks.db.$transaction.mockImplementation(async (callback) => callback({
      receiptScan: { create: mocks.receiptScanCreate },
      transaction: { createMany: mocks.transactionCreateMany },
      customCategory: { upsert: mocks.customCategoryUpsert },
      customSubcategory: { findFirst: mocks.customSubcategoryFindFirst, create: mocks.customSubcategoryCreate },
      paymentAccount: { findFirstOrThrow: mocks.resetAccountFindFirstOrThrow, update: mocks.resetAccountUpdate },
      accountReconciliation: { findFirst: mocks.resetReconciliationFindFirst, deleteMany: mocks.resetReconciliationDeleteMany },
    }));
  });

  it("creates the shared receipt and every split inside one database transaction", async () => {
    const response = await POST(request(1000));

    expect(response.status).toBe(200);
    expect(mocks.verifyStoredReceipt).toHaveBeenCalledWith(receipt.storagePath, "user-1", receipt.mimeType, receipt.size);
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.receiptScanCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: "user-1",
      storagePath: receipt.storagePath,
    }) });
    expect(mocks.transactionCreateMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ userId: "user-1", receiptScanId: "scan-1", category: "food", amountMinor: 700 }),
      expect.objectContaining({ userId: "user-1", receiptScanId: "scan-1", category: "other", amountMinor: 300 }),
    ] });
  });

  it("creates unknown CSV categories and their transactions atomically", async () => {
    const response = await POST(new Request("http://localhost/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "importTransactions",
        payload: {
          newCategories: [{ key: "csv:investments", name: "Investments", kind: "expense", icon: "money" }],
          newSubcategories: [{ key: "csvsub:csv:investments:index funds", category: "csv:investments", name: "Index funds", icon: "money" }],
          transactions: [{ kind: "expense", category: "csv:investments", amountMinor: 125000, occurredOn: "2026-08-01", note: "Fund", subcategory: "Index funds", area: null, paymentMode: "cash", paymentAccountId: null }],
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.customCategoryUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ name: "Investments", icon: "money" }),
    }));
    expect(mocks.customSubcategoryCreate).toHaveBeenCalledWith({ data: { userId: "user-1", categoryId: "category-investments", name: "Index funds", icon: "money" } });
    expect(mocks.transactionCreateMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ category: "category-investments", userId: "user-1" })] });
  });

  it("adds a custom subcategory to an owned category", async () => {
    mocks.db.customCategory.findFirst.mockResolvedValueOnce({ id: "category-investments" });
    mocks.db.customSubcategory.findFirst.mockResolvedValueOnce(null);
    mocks.db.customSubcategory.create.mockResolvedValueOnce({ id: "subcategory-funds" });

    const response = await POST(new Request("http://localhost/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "saveCustomSubcategory", payload: { categoryId: "category-investments", name: "Mutual funds", icon: "money" } }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.db.customSubcategory.create).toHaveBeenCalledWith({ data: {
      userId: "user-1",
      categoryId: "category-investments",
      name: "Mutual funds",
      icon: "money",
    } });
  });

  it("rejects custom subcategories that duplicate a built-in option", async () => {
    const response = await POST(new Request("http://localhost/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "saveCustomSubcategory", payload: { categoryId: "food", name: "Lunch", icon: "food" } }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "That subcategory already exists." });
    expect(mocks.db.customSubcategory.create).not.toHaveBeenCalled();
  });

  it("resets only the selected account to its earliest reconciled opening snapshot", async () => {
    mocks.db.user.findUniqueOrThrow.mockResolvedValue({
      id: "user-1",
      name: "Test User",
      currency: "NPR",
      hideAmounts: false,
      autoLockMinutes: 0,
      pinHash: null,
    });

    const response = await POST(new Request("http://localhost/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resetAccountReconciliation", id: "account-1", payload: { confirmation: "RESET" } }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.resetAccountFindFirstOrThrow).toHaveBeenCalledWith({ where: { id: "account-1", userId: "user-1" }, select: { id: true, createdAt: true } });
    expect(mocks.resetReconciliationFindFirst).toHaveBeenCalledWith({
      where: { paymentAccountId: "account-1", userId: "user-1" },
      orderBy: [{ checkedOn: "asc" }, { approvedAt: "asc" }],
      select: { startingBalanceMinor: true, startingBalanceAsOf: true },
    });
    expect(mocks.resetAccountUpdate).toHaveBeenCalledWith({
      where: { id: "account-1" },
      data: {
        balanceMinor: 100000,
        balanceAsOf: new Date("2026-07-01T00:00:00.000Z"),
        balanceRecordedAt: new Date("2026-07-01T08:00:00.000Z"),
      },
    });
    expect(mocks.resetReconciliationDeleteMany).toHaveBeenCalledWith({ where: { paymentAccountId: "account-1", userId: "user-1" } });
  });

  it("does not reset reconciliation history without the exact confirmation", async () => {
    const response = await POST(new Request("http://localhost/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resetAccountReconciliation", id: "account-1", payload: { confirmation: "reset" } }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an incomplete split before storage verification or database writes", async () => {
    const response = await POST(request(1100));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Split amounts must equal the receipt total." });
    expect(mocks.verifyStoredReceipt).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("does not report success when a batched transaction write fails", async () => {
    mocks.transactionCreateMany.mockRejectedValueOnce(new Error("write failed"));

    const response = await POST(request(1000));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "write failed" });
  });

  it("treats a retry for an already-saved receipt as idempotent", async () => {
    mocks.receiptScanCreate.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "P2002" }));
    mocks.db.receiptScan.count.mockResolvedValueOnce(1);

    const response = await POST(request(1000));

    expect(response.status).toBe(200);
    expect(mocks.db.receiptScan.count).toHaveBeenCalledWith({ where: {
      userId: "user-1",
      storagePath: receipt.storagePath,
    } });
  });
});

function transactionAction(action: "deleteTransaction" | "restoreTransaction", id = "transaction-1") {
  return new Request("http://localhost/api/ledger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, id }),
  });
}

describe("transaction Undo ledger actions", () => {
  const storedTransaction = {
    paymentAccountId: null,
    occurredOn: new Date("2026-07-26T00:00:00.000Z"),
    createdAt: new Date("2026-07-26T08:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.user.findUniqueOrThrow.mockResolvedValue({
      id: "user-1",
      name: "Test User",
      currency: "NPR",
      hideAmounts: false,
      autoLockMinutes: 0,
      pinHash: null,
    });
    mocks.db.transaction.findMany.mockResolvedValue([]);
    mocks.db.budget.findMany.mockResolvedValue([]);
    mocks.db.recurringEntry.findMany.mockResolvedValue([]);
    mocks.db.savingsGoal.findMany.mockResolvedValue([]);
    mocks.db.customCategory.findMany.mockResolvedValue([]);
    mocks.db.customSubcategory.findMany.mockResolvedValue([]);
    mocks.db.paymentAccount.findMany.mockResolvedValue([]);
    mocks.db.accountReconciliation.findMany.mockResolvedValue([]);
    mocks.db.accountReconciliation.findFirst.mockResolvedValue(null);
    mocks.db.savedPlace.findMany.mockResolvedValue([]);
    mocks.db.accountTransfer.findMany.mockResolvedValue([]);
    mocks.db.dueItem.findMany.mockResolvedValue([]);
  });

  it("soft-deletes an owned transaction so its data remains recoverable", async () => {
    mocks.db.transaction.findFirstOrThrow.mockResolvedValueOnce(storedTransaction);

    const response = await POST(transactionAction("deleteTransaction"));

    expect(response.status).toBe(200);
    expect(mocks.db.transaction.update).toHaveBeenCalledWith({
      where: { id: "transaction-1" },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("restores a recently deleted owned transaction", async () => {
    mocks.db.transaction.findFirstOrThrow.mockResolvedValueOnce({ ...storedTransaction, deletedAt: new Date() });

    const response = await POST(transactionAction("restoreTransaction"));

    expect(response.status).toBe(200);
    expect(mocks.db.transaction.update).toHaveBeenCalledWith({
      where: { id: "transaction-1" },
      data: { deletedAt: null },
    });
  });

  it("rejects Undo after the server recovery window expires", async () => {
    mocks.db.transaction.findFirstOrThrow.mockResolvedValueOnce({ ...storedTransaction, deletedAt: new Date(Date.now() - 31_000) });

    const response = await POST(transactionAction("restoreTransaction"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "The Undo window for this transaction has expired." });
    expect(mocks.db.transaction.update).not.toHaveBeenCalled();
  });
});
