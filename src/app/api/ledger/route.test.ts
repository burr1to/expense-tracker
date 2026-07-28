import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const receiptScanCreate = vi.fn();
  const transactionCreateMany = vi.fn();
  const transactionClient = {
    receiptScan: { create: receiptScanCreate },
    transaction: { createMany: transactionCreateMany },
  };
  const db = {
    user: { findUniqueOrThrow: vi.fn() },
    transaction: { findMany: vi.fn() },
    budget: { findMany: vi.fn() },
    recurringEntry: { findMany: vi.fn() },
    savingsGoal: { findMany: vi.fn() },
    customCategory: { findMany: vi.fn() },
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
    mocks.db.paymentAccount.findMany.mockResolvedValue([]);
    mocks.db.paymentAccount.count.mockResolvedValue(0);
    mocks.db.accountReconciliation.findMany.mockResolvedValue([]);
    mocks.db.savedPlace.findMany.mockResolvedValue([]);
    mocks.db.accountTransfer.findMany.mockResolvedValue([]);
    mocks.db.dueItem.findMany.mockResolvedValue([]);
    mocks.db.receiptScan.count.mockResolvedValue(0);
    mocks.receiptScanCreate.mockResolvedValue({ id: "scan-1" });
    mocks.transactionCreateMany.mockResolvedValue({ count: 2 });
    mocks.verifyStoredReceipt.mockResolvedValue(undefined);
    mocks.db.$transaction.mockImplementation(async (callback) => callback({
      receiptScan: { create: mocks.receiptScanCreate },
      transaction: { createMany: mocks.transactionCreateMany },
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
