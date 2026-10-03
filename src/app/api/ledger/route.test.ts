import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const receiptScanCreate = vi.fn();
  const transactionCreateMany = vi.fn();
  const customCategoryCreateMany = vi.fn();
  const customCategoryFindMany = vi.fn();
  const customSubcategoryFindMany = vi.fn();
  const customSubcategoryCreateMany = vi.fn();
  const importJobCreate = vi.fn();
  const importJobFindFirst = vi.fn();
  const importJobFindFirstOrThrow = vi.fn();
  const importJobFindMany = vi.fn();
  const importJobUpdate = vi.fn();
  const importJobUpdateMany = vi.fn();
  const resetAccountFindFirstOrThrow = vi.fn();
  const resetAccountUpdate = vi.fn();
  const resetReconciliationFindFirst = vi.fn();
  const resetReconciliationDeleteMany = vi.fn();
  const recurringEntryFindFirstOrThrow = vi.fn();
  const recurringEntryCreate = vi.fn();
  const recurringEntryUpdateMany = vi.fn();
  const recurringPaymentAccountFindFirstOrThrow = vi.fn();
  const recurringTransactionCreate = vi.fn();
  const transactionClient = {
    receiptScan: { create: receiptScanCreate },
    transaction: { createMany: transactionCreateMany, create: recurringTransactionCreate },
    customCategory: { createMany: customCategoryCreateMany, findMany: customCategoryFindMany },
    customSubcategory: { findMany: customSubcategoryFindMany, createMany: customSubcategoryCreateMany },
    importJob: { findFirstOrThrow: importJobFindFirstOrThrow, update: importJobUpdate },
    paymentAccount: { findFirstOrThrow: resetAccountFindFirstOrThrow, update: resetAccountUpdate },
    accountReconciliation: { findFirst: resetReconciliationFindFirst, deleteMany: resetReconciliationDeleteMany },
    recurringEntry: { findFirstOrThrow: recurringEntryFindFirstOrThrow, updateMany: recurringEntryUpdateMany },
  };
  const db = {
    user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(async () => ({ currency: "NPR" })) },
    activityLog: {
      createManyAndReturn: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => data.map((row, index) => ({ id: `log-${index + 1}`, entityId: null, subject: null, amountMinor: null, changes: null, meta: null, ...row }))),
    },
    transaction: { findMany: vi.fn(), findFirstOrThrow: vi.fn(), update: vi.fn() },
    budget: { findMany: vi.fn() },
    recurringEntry: { findMany: vi.fn(), findFirstOrThrow: recurringEntryFindFirstOrThrow, create: recurringEntryCreate },
    savingsGoal: { findMany: vi.fn() },
    customCategory: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    customSubcategory: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    importJob: { create: importJobCreate, findFirst: importJobFindFirst, findFirstOrThrow: importJobFindFirstOrThrow, findMany: importJobFindMany, update: importJobUpdate, updateMany: importJobUpdateMany },
    paymentAccount: { count: vi.fn(), findMany: vi.fn(), findFirstOrThrow: recurringPaymentAccountFindFirstOrThrow },
    accountReconciliation: { findFirst: vi.fn(), findMany: vi.fn() },
    savedPlace: { findMany: vi.fn() },
    accountTransfer: { findMany: vi.fn() },
    dueItem: { findMany: vi.fn() },
    householdMember: { findFirst: vi.fn(async () => null) },
    receiptScan: { count: vi.fn() },
    $transaction: vi.fn(async (callback: (client: typeof transactionClient) => unknown) => callback(transactionClient)),
  };
  return {
    db,
    transactionClient,
    receiptScanCreate,
    transactionCreateMany,
    customCategoryCreateMany,
    customCategoryFindMany,
    customSubcategoryFindMany,
    customSubcategoryCreateMany,
    importJobCreate,
    importJobFindFirst,
    importJobFindFirstOrThrow,
    importJobFindMany,
    importJobUpdate,
    importJobUpdateMany,
    resetAccountFindFirstOrThrow,
    resetAccountUpdate,
    resetReconciliationFindFirst,
    resetReconciliationDeleteMany,
    recurringEntryFindFirstOrThrow,
    recurringEntryCreate,
    recurringEntryUpdateMany,
    recurringPaymentAccountFindFirstOrThrow,
    recurringTransactionCreate,
    verifyStoredReceipt: vi.fn(),
  };
});

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("../../../lib/auth", () => ({ getAuthenticatedSession: vi.fn(async () => ({ user: { id: "user-1" } })) }));
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
      email: "test@example.com",
      currency: "NPR",
      hideAmounts: false,
      autoLockMinutes: 0,
      calendarSystem: "AD",
      safeToSpendBufferMinor: 0,
      emailReminders: false,
      browserReminders: false,
      learningProfile: null,
      householdMembership: null,
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
    mocks.customCategoryCreateMany.mockResolvedValue({ count: 1 });
    mocks.customCategoryFindMany.mockResolvedValue([{ id: "category-investments", name: "Investments" }]);
    mocks.customSubcategoryFindMany.mockResolvedValue([]);
    mocks.customSubcategoryCreateMany.mockResolvedValue({ count: 1 });
    mocks.importJobFindMany.mockResolvedValue([]);
    mocks.importJobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.resetAccountFindFirstOrThrow.mockResolvedValue({ id: "account-1", createdAt: new Date("2026-07-01T08:00:00.000Z") });
    mocks.resetAccountUpdate.mockResolvedValue({ id: "account-1" });
    mocks.resetReconciliationFindFirst.mockResolvedValue({ startingBalanceMinor: 100000, startingBalanceAsOf: new Date("2026-07-01T00:00:00.000Z") });
    mocks.resetReconciliationDeleteMany.mockResolvedValue({ count: 1 });
    mocks.verifyStoredReceipt.mockResolvedValue(undefined);
    mocks.db.$transaction.mockImplementation(async (callback) => callback({
      receiptScan: { create: mocks.receiptScanCreate },
      transaction: { createMany: mocks.transactionCreateMany, create: mocks.recurringTransactionCreate },
      customCategory: { createMany: mocks.customCategoryCreateMany, findMany: mocks.customCategoryFindMany },
      customSubcategory: { findMany: mocks.customSubcategoryFindMany, createMany: mocks.customSubcategoryCreateMany },
      importJob: { findFirstOrThrow: mocks.importJobFindFirstOrThrow, update: mocks.importJobUpdate },
      paymentAccount: { findFirstOrThrow: mocks.resetAccountFindFirstOrThrow, update: mocks.resetAccountUpdate },
      accountReconciliation: { findFirst: mocks.resetReconciliationFindFirst, deleteMany: mocks.resetReconciliationDeleteMany },
      recurringEntry: { findFirstOrThrow: mocks.recurringEntryFindFirstOrThrow, updateMany: mocks.recurringEntryUpdateMany },
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
    expect(mocks.customCategoryCreateMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ name: "Investments", icon: "money" })], skipDuplicates: true });
    expect(mocks.customCategoryFindMany).toHaveBeenCalledTimes(2);
    expect(mocks.customSubcategoryFindMany).toHaveBeenCalledTimes(2);
    expect(mocks.customSubcategoryCreateMany).toHaveBeenCalledWith({ data: [{ userId: "user-1", categoryId: "category-investments", name: "Index funds", icon: "money" }], skipDuplicates: true });
    expect(mocks.transactionCreateMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ category: "category-investments", userId: "user-1" })] });
    expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 15_000 });
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

  it("queues a CSV import without loading the full ledger", async () => {
    const createdAt = new Date("2026-08-03T04:00:00.000Z");
    mocks.importJobCreate.mockResolvedValue({ id: "import-1", status: "queued", totalRows: 300, processedRows: 0, error: null, createdAt, completedAt: null });
    const response = await POST(new Request("http://localhost/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "startImportJob", payload: { newCategories: [], newSubcategories: [], transactions: [split("food", 1250, "Lunch")] } }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: { id: "import-1", status: "queued", totalRows: 300, processedRows: 0, error: null, createdAt: createdAt.toISOString(), completedAt: null } });
    expect(mocks.importJobCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "user-1", totalRows: 1 }) });
    expect(mocks.db.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("processes a queued import batch and marks the job complete", async () => {
    const createdAt = new Date("2026-08-03T04:00:00.000Z");
    const job = { id: "import-1", status: "queued", totalRows: 1, processedRows: 0, payload: { newCategories: [], newSubcategories: [], transactions: [split("food", 1250, "Lunch")] }, createdCategoryIds: [], createdSubcategoryIds: [], error: null, lockExpiresAt: null, createdAt, completedAt: null };
    const completed = { ...job, status: "completed", processedRows: 1, completedAt: new Date("2026-08-03T04:00:02.000Z") };
    mocks.importJobFindFirst.mockResolvedValue(job);
    mocks.importJobFindFirstOrThrow.mockResolvedValue(job);
    mocks.importJobUpdate.mockResolvedValue(completed);
    const response = await POST(new Request("http://localhost/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "processImportJob", payload: { jobId: "import-1" } }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      job: { id: "import-1", status: "completed", totalRows: 1, processedRows: 1, error: null, createdAt: createdAt.toISOString(), completedAt: completed.completedAt.toISOString() },
      activity: [expect.objectContaining({ action: "transactions.imported", area: "data", title: "Imported 1 transaction", entityId: "import-1" })],
    });
    expect(mocks.transactionCreateMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ importJobId: "import-1", category: "food" })] });
    expect(mocks.importJobUpdate).toHaveBeenCalledWith({ where: { id: "import-1" }, data: expect.objectContaining({ status: "completed", processedRows: 1 }) });
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
      email: "test@example.com",
      currency: "NPR",
      hideAmounts: false,
      autoLockMinutes: 0,
      calendarSystem: "AD",
      safeToSpendBufferMinor: 0,
      emailReminders: false,
      browserReminders: false,
      learningProfile: null,
      householdMembership: null,
      pinHash: null,
    });

    const response = await POST(new Request("http://localhost/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resetAccountReconciliation", id: "account-1", payload: { confirmation: "RESET" } }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.resetAccountFindFirstOrThrow).toHaveBeenCalledWith({ where: { id: "account-1", userId: "user-1" }, select: { id: true, createdAt: true, type: true, provider: true, label: true } });
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
      email: "test@example.com",
      currency: "NPR",
      hideAmounts: false,
      autoLockMinutes: 0,
      calendarSystem: "AD",
      safeToSpendBufferMinor: 0,
      emailReminders: false,
      browserReminders: false,
      learningProfile: null,
      householdMembership: null,
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

describe("recurring account ledger actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.user.findUniqueOrThrow.mockResolvedValue({ id: "user-1", name: "Test User", email: "test@example.com", currency: "NPR", hideAmounts: false, autoLockMinutes: 0, calendarSystem: "AD", safeToSpendBufferMinor: 0, emailReminders: false, browserReminders: false, learningProfile: null, householdMembership: null, pinHash: null });
    mocks.db.transaction.findMany.mockResolvedValue([]);
    mocks.db.budget.findMany.mockResolvedValue([]);
    mocks.db.recurringEntry.findMany.mockResolvedValue([]);
    mocks.db.savingsGoal.findMany.mockResolvedValue([]);
    mocks.db.customCategory.findMany.mockResolvedValue([]);
    mocks.db.customSubcategory.findMany.mockResolvedValue([]);
    mocks.db.paymentAccount.findMany.mockResolvedValue([]);
    mocks.db.accountReconciliation.findMany.mockResolvedValue([]);
    mocks.db.savedPlace.findMany.mockResolvedValue([]);
    mocks.db.accountTransfer.findMany.mockResolvedValue([]);
    mocks.db.dueItem.findMany.mockResolvedValue([]);
    mocks.db.$transaction.mockImplementation(async (callback) => callback(mocks.transactionClient));
  });

  it("stores the selected account on a recurring entry", async () => {
    mocks.recurringPaymentAccountFindFirstOrThrow.mockResolvedValue({ id: "account-1" });
    mocks.recurringEntryCreate.mockResolvedValue({});

    const response = await POST(new Request("http://localhost/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "saveRecurring", payload: { kind: "expense", category: "housing", amountMinor: 380000, paymentAccountId: "account-1", note: "Monthly EMI", tags: [], recurrenceUnit: "month", recurrenceInterval: 1, startOn: "2026-08-10" } }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.recurringPaymentAccountFindFirstOrThrow).toHaveBeenCalledWith({ where: { id: "account-1", userId: "user-1" } });
    expect(mocks.recurringEntryCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "user-1", paymentAccountId: "account-1" }) });
  });

  it("uses the selected account when confirming a recurring entry", async () => {
    mocks.recurringEntryFindFirstOrThrow.mockResolvedValue({
      id: "recurring-1",
      userId: "user-1",
      kind: "expense",
      category: "housing",
      amountMinor: 380000,
      paymentAccountId: "account-1",
      note: "Monthly EMI",
      recurrenceUnit: "month",
      recurrenceInterval: 1,
      anchorDate: new Date("2026-08-07T00:00:00.000Z"),
      nextDueOn: new Date("2026-08-07T00:00:00.000Z"),
      active: true,
    });
    mocks.resetAccountFindFirstOrThrow.mockResolvedValue({ id: "account-1" });
    mocks.recurringEntryUpdateMany.mockResolvedValue({ count: 1 });
    mocks.recurringTransactionCreate.mockResolvedValue({});

    const response = await POST(new Request("http://localhost/api/ledger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirmRecurring", id: "recurring-1" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.recurringTransactionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ paymentMode: "online", paymentAccountId: "account-1" }) });
  });
});

describe("activity logging", () => {
  const storedExpense = {
    paymentAccountId: null,
    occurredOn: new Date("2026-07-26T00:00:00.000Z"),
    createdAt: new Date("2026-07-26T08:00:00.000Z"),
    kind: "expense",
    category: "food",
    note: "Synthetic groceries",
    amountMinor: 324000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.user.findUniqueOrThrow.mockResolvedValue({ id: "user-1", name: "Test User", email: "test@example.com", currency: "NPR", hideAmounts: false, autoLockMinutes: 0, calendarSystem: "AD", safeToSpendBufferMinor: 0, emailReminders: false, browserReminders: false, learningProfile: null, householdMembership: null, pinHash: null });
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

  it("records a deletion after it succeeds and returns the same entry for the toast", async () => {
    mocks.db.transaction.findFirstOrThrow.mockResolvedValueOnce(storedExpense);

    const response = await POST(transactionAction("deleteTransaction"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.db.activityLog.createManyAndReturn).toHaveBeenCalledWith({ data: [expect.objectContaining({
      userId: "user-1", action: "transaction.deleted", area: "transactions", entityId: "transaction-1", title: "Deleted an expense", subject: "Synthetic groceries", amountMinor: 324000, currency: "NPR",
    })] });
    expect(body.activity).toEqual([expect.objectContaining({ id: "log-1", action: "transaction.deleted", title: "Deleted an expense", amountMinor: 324000 })]);
    expect(mocks.db.transaction.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.db.activityLog.createManyAndReturn.mock.invocationCallOrder[0]);
  });

  it("does not record anything when the change itself is rejected", async () => {
    mocks.db.transaction.findFirstOrThrow.mockResolvedValueOnce({ ...storedExpense, deletedAt: new Date(Date.now() - 31_000) });

    const response = await POST(transactionAction("restoreTransaction"));

    expect(response.status).toBe(400);
    expect(mocks.db.activityLog.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("keeps a successful change successful when the log cannot be written", async () => {
    mocks.db.transaction.findFirstOrThrow.mockResolvedValueOnce(storedExpense);
    mocks.db.activityLog.createManyAndReturn.mockRejectedValueOnce(new Error("log table unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(transactionAction("deleteTransaction"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.db.transaction.update).toHaveBeenCalled();
    expect(body.activity).toEqual([expect.objectContaining({ action: "transaction.deleted", id: expect.stringMatching(/^unsaved-/) })]);
    consoleError.mockRestore();
  });

  it("keeps a successful change successful when it cannot be described", async () => {
    mocks.db.transaction.findFirstOrThrow.mockResolvedValueOnce({ ...storedExpense, note: 42 });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(transactionAction("deleteTransaction"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.db.transaction.update).toHaveBeenCalled();
    expect(body.activity).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith("Could not describe a ledger change for Logs.", expect.any(TypeError));
    consoleError.mockRestore();
  });
});
