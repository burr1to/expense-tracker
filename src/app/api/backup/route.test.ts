import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const createMany = () => vi.fn(async () => ({ count: 0 }));
  const deleteMany = () => vi.fn(async () => ({ count: 0 }));
  const tx = {
    receiptAttachment: { deleteMany: deleteMany(), createMany: createMany() },
    duePayment: { deleteMany: deleteMany(), createMany: createMany() },
    dueItem: { deleteMany: deleteMany(), createMany: createMany() },
    savingsGoalContribution: { deleteMany: deleteMany(), createMany: createMany() },
    savingsGoal: { deleteMany: deleteMany(), createMany: createMany() },
    accountReconciliation: { deleteMany: deleteMany(), createMany: createMany() },
    accountTransfer: { deleteMany: deleteMany(), createMany: createMany() },
    transaction: { deleteMany: deleteMany(), createMany: createMany() },
    receiptScan: { deleteMany: deleteMany(), createMany: createMany() },
    budget: { deleteMany: deleteMany(), createMany: createMany() },
    recurringEntry: { deleteMany: deleteMany(), createMany: createMany() },
    paymentAccount: { deleteMany: deleteMany(), createMany: createMany() },
    savedPlace: { deleteMany: deleteMany(), createMany: createMany() },
    customSubcategory: { deleteMany: deleteMany(), createMany: createMany() },
    customCategory: { deleteMany: deleteMany(), createMany: createMany() },
    learningProfile: { deleteMany: deleteMany(), create: vi.fn() },
    user: { update: vi.fn() },
  };
  const db = {
    user: { findUniqueOrThrow: vi.fn() },
    customCategory: { findMany: vi.fn() },
    customSubcategory: { findMany: vi.fn() },
    savedPlace: { findMany: vi.fn() },
    paymentAccount: { findMany: vi.fn() },
    accountReconciliation: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
    accountTransfer: { findMany: vi.fn() },
    budget: { findMany: vi.fn() },
    recurringEntry: { findMany: vi.fn() },
    savingsGoal: { findMany: vi.fn() },
    dueItem: { findMany: vi.fn() },
    receiptAttachment: { findMany: vi.fn() },
    receiptScan: { findMany: vi.fn() },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  let uploads = 0;
  const bucket = {
    download: vi.fn(async () => ({ data: new Blob([new TextEncoder().encode("hi")]), error: null })),
    upload: vi.fn(async () => ({ error: null })),
  };
  return {
    db,
    tx,
    bucket,
    newReceiptPath: vi.fn((userId: string) => `${userId}/restored-${++uploads}`),
    removeStoredReceipts: vi.fn(async () => undefined),
    recordActivity: vi.fn(async (_userId: string, drafts: Record<string, unknown>[]) => drafts.map((draft, index) => ({ id: `log-${index}`, ...draft }))),
  };
});

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("../../../lib/auth", () => ({
  auth: { api: { verifyPassword: vi.fn(async () => ({ status: true })) } },
  getAuthenticatedSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));
vi.mock("../../../lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("../../../lib/activity-recorder", () => ({ recordActivity: mocks.recordActivity }));
vi.mock("../../../lib/receipt-storage", () => ({
  ensureReceiptsBucket: vi.fn(async () => undefined),
  getSupabaseStorageAdmin: () => ({ storage: { from: () => mocks.bucket } }),
  newReceiptPath: mocks.newReceiptPath,
  RECEIPTS_BUCKET: "receipts",
  removeStoredReceipts: mocks.removeStoredReceipts,
}));

import { GET, POST } from "./route";

const at = (value: string) => new Date(value);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const stamp = { createdAt: at("2026-09-01T04:15:00.000Z"), updatedAt: at("2026-09-02T05:30:00.000Z") };

// One row per table with every column filled in, as Prisma returns them.
const profile = { name: "Asha", currency: "NPR", hideAmounts: true, autoLockMinutes: 5, calendarSystem: "BS", safeToSpendBufferMinor: 250_000, emailReminders: true, browserReminders: true, learningProfile: { enabled: true } };
const categories = [{ id: "cat-1", userId: "user-1", name: "Investments", kind: "both", color: "#557f69", icon: "money", ...stamp }];
const subcategories = [{ id: "sub-1", userId: "user-1", categoryId: "cat-1", name: "Mutual funds", icon: "tag", ...stamp }];
const places = [{ id: "place-1", userId: "user-1", name: "Office", icon: "work", address: "Thamel", latitude: 27.715, longitude: 85.312, ...stamp, lastUsedAt: at("2026-09-03T06:00:00.000Z") }];
const accounts = [
  { id: "acct-1", importId: "11111111-1111-4111-8111-111111111111", userId: "user-1", type: "esewa", provider: "eSewa", label: "Daily wallet", accountTail: "4321", shared: true, balanceMinor: 125_000, balanceAsOf: day("2026-09-01"), balanceRecordedAt: at("2026-09-01T07:00:00.000Z"), ...stamp },
  { id: "acct-2", importId: "22222222-2222-4222-8222-222222222222", userId: "user-1", type: "cash", provider: "Cash in hand", label: "", accountTail: null, shared: false, balanceMinor: 5_000, balanceAsOf: day("2026-09-01"), balanceRecordedAt: at("2026-09-01T07:00:00.000Z"), ...stamp },
];
const reconciliations = [{ id: "rec-1", userId: "user-1", paymentAccountId: "acct-1", monthKey: "2026-09", checkedOn: day("2026-09-30"), startingBalanceMinor: 100_000, startingBalanceAsOf: day("2026-08-31"), incomeMinor: 50_000, expenseMinor: 25_000, transfersInMinor: 1_000, transfersOutMinor: 1_000, expectedBalanceMinor: 125_000, actualBalanceMinor: 124_000, adjustmentMinor: -1_000, adjustmentNote: "Fee", approvedAt: at("2026-10-01T03:00:00.000Z"), createdAt: at("2026-10-01T03:00:00.000Z") }];
const transactions = [
  { id: "tx-1", userId: "user-1", kind: "expense", category: "cat-1", amountMinor: 75_000, occurredOn: day("2026-09-05"), note: "Lunch, \"team\"", subcategory: "Mutual funds", area: "Thamel", paymentMode: "online", paymentAccountId: "acct-1", locationLabel: "Office", locationAddress: "Thamel", locationLatitude: 27.715, locationLongitude: 85.312, locationAccuracy: 25, locationSource: "saved", savedPlaceId: "place-1", receiptScanId: "scan-1", importJobId: null, shared: true, clientRequestId: "7f9c2d1e-1111-4000-8000-000000000000", deletedAt: null, ...stamp },
  { id: "tx-2", userId: "user-1", kind: "expense", category: "loan", amountMinor: 500_000, occurredOn: day("2026-09-06"), note: "Lent to Ram · Bike repair", subcategory: "Lent", area: null, paymentMode: "cash", paymentAccountId: null, locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null, locationSource: null, savedPlaceId: null, receiptScanId: null, importJobId: null, shared: false, clientRequestId: "due-open:due-1", deletedAt: null, ...stamp },
];
const transfers = [{ id: "tr-1", userId: "user-1", fromAccountId: "acct-1", toAccountId: "acct-2", amountMinor: 1_000, occurredOn: day("2026-09-07"), note: "ATM", clientRequestId: "a-transfer-request", createdAt: stamp.createdAt }];
const budgets = [
  { id: "budget-1", userId: "user-1", monthKey: "2026-10", scope: "month", category: "food", amountMinor: 900_000, shared: true, ...stamp },
  { id: "budget-2", userId: "user-1", monthKey: "FEST:dashain-2083", scope: "festival", category: "__total", amountMinor: 3_000_000, shared: false, ...stamp },
];
const recurring = [{ id: "recurring-1", userId: "user-1", kind: "expense", category: "cat-1", amountMinor: 2_000_000, paymentAccountId: "acct-1", note: "Rent", tags: ["home"], dayOfMonth: 5, recurrenceUnit: "month", recurrenceInterval: 1, anchorDate: day("2026-09-05"), nextDueOn: day("2026-10-05"), active: true, ...stamp }];
const contributions = [{ id: "contribution-1", userId: "user-1", goalId: "goal-1", amountMinor: 10_000, isOpeningBalance: true, createdAt: stamp.createdAt }];
const goals = [{ id: "goal-1", userId: "user-1", name: "Laptop", targetMinor: 15_000_000, savedMinor: 10_000, targetDate: day("2027-03-01"), ...stamp, contributions }];
const payments = [{ id: "pay-1", userId: "user-1", dueItemId: "due-1", amountMinor: 100_000, occurredOn: day("2026-09-20"), note: "First part", transactionId: "tx-2", clientRequestId: "a-payment-request", createdAt: stamp.createdAt }];
const dues = [{ id: "due-1", userId: "user-1", kind: "lent", title: "Bike repair", person: "Ram", amountMinor: 500_000, category: "loan", occurredOn: day("2026-09-06"), dueOn: day("2026-10-06"), remindOn: day("2026-10-04"), snoozedUntil: day("2026-10-05"), note: "Pay back after Dashain", status: "open", annualRatePercent: 12.5, completedOn: null, ...stamp, payments }];
const receipts = [{ id: "receipt-1", userId: "user-1", transactionId: null, dueItemId: "due-1", name: "bill.png", mimeType: "image/png", size: 2, storagePath: "user-1/old-bill.png", data: null, createdAt: stamp.createdAt }];
const receiptScans = [{ id: "scan-1", userId: "user-1", name: "camera.jpg", mimeType: "image/jpeg", size: 2, storagePath: "user-1/old-scan.jpg", createdAt: stamp.createdAt }];

type Row = Record<string, unknown>;
const restored = (table: { createMany: { mock: { calls: unknown[][] } } }) => ((table.createMany.mock.calls[0]?.[0] as { data: Row[] } | undefined)?.data ?? []);
const idMap = (source: Row[], copies: Row[]) => new Map(source.map((row, index) => [row.id as string, copies[index]?.id as string]));
const same = (value: unknown) => value instanceof Date ? value.toISOString() : value;

/** Every column of the source row comes back, with ids following their restored rows; `skip` lists what a backup deliberately leaves out. */
function expectSurvives(entity: string, source: Row[], copies: Row[], relations: Record<string, Map<string, string>> = {}, skip: string[] = []) {
  expect(copies, entity).toHaveLength(source.length);
  source.forEach((row, index) => {
    for (const [key, value] of Object.entries(row)) {
      if (key === "id" || key === "userId" || skip.includes(key) || Array.isArray(value) && key !== "tags") continue;
      const expected = typeof value === "string" && relations[key] ? relations[key].get(value) ?? value : value;
      expect({ entity, key, value: same(copies[index][key]) }).toEqual({ entity, key, value: same(expected) });
    }
    expect(copies[index].userId, entity).toBe("user-1");
    expect(copies[index].id, entity).not.toBe(row.id);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.user.findUniqueOrThrow.mockResolvedValue(profile);
  mocks.db.customCategory.findMany.mockResolvedValue(categories);
  mocks.db.customSubcategory.findMany.mockResolvedValue(subcategories);
  mocks.db.savedPlace.findMany.mockResolvedValue(places);
  mocks.db.paymentAccount.findMany.mockResolvedValue(accounts);
  mocks.db.accountReconciliation.findMany.mockResolvedValue(reconciliations);
  mocks.db.transaction.findMany.mockResolvedValue(transactions);
  mocks.db.accountTransfer.findMany.mockResolvedValue(transfers);
  mocks.db.budget.findMany.mockResolvedValue(budgets);
  mocks.db.recurringEntry.findMany.mockResolvedValue(recurring);
  mocks.db.savingsGoal.findMany.mockResolvedValue(goals);
  mocks.db.dueItem.findMany.mockResolvedValue(dues);
  mocks.db.receiptAttachment.findMany.mockResolvedValue(receipts);
  mocks.db.receiptScan.findMany.mockResolvedValue(receiptScans);
});

async function exportThenRestore() {
  const exported = await GET();
  expect(exported.status).toBe(200);
  const csv = await exported.text();
  const form = new FormData();
  form.append("password", "correct horse");
  form.append("backup", new File([csv], "backup.csv", { type: "text/csv" }));
  const response = await POST(new Request("http://localhost/api/backup", { method: "POST", body: form }));
  return { csv, response };
}

describe("full backup round trip", () => {
  it("brings back every exported column, with relations following the new ids", async () => {
    const { response } = await exportThenRestore();
    expect(response.status).toBe(200);
    const { tx } = mocks;

    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { name: "Asha", currency: "NPR", hideAmounts: true, autoLockMinutes: 5, calendarSystem: "BS", safeToSpendBufferMinor: 250_000, emailReminders: true, browserReminders: true } });
    expect(tx.learningProfile.create).toHaveBeenCalledWith({ data: { userId: "user-1", enabled: true } });

    const restoredCategories = restored(tx.customCategory);
    const category = idMap(categories, restoredCategories);
    const account = idMap(accounts, restored(tx.paymentAccount));
    const place = idMap(places, restored(tx.savedPlace));
    const scan = idMap(receiptScans, restored(tx.receiptScan));
    const transaction = idMap(transactions, restored(tx.transaction));
    const goal = idMap(goals, restored(tx.savingsGoal));
    const due = idMap(dues, restored(tx.dueItem));

    expectSurvives("custom_category", categories, restoredCategories);
    expectSurvives("custom_subcategory", subcategories, restored(tx.customSubcategory), { categoryId: category });
    expectSurvives("saved_place", places, restored(tx.savedPlace));
    expectSurvives("payment_account", accounts, restored(tx.paymentAccount));
    expectSurvives("account_reconciliation", reconciliations, restored(tx.accountReconciliation), { paymentAccountId: account });
    // The loan's opening movement must still point at its due, whose id changed.
    expectSurvives("transaction", transactions, restored(tx.transaction), { category, paymentAccountId: account, savedPlaceId: place, receiptScanId: scan, clientRequestId: new Map([["due-open:due-1", `due-open:${due.get("due-1")}`]]) }, ["importJobId", "deletedAt"]);
    expect(restored(tx.transaction)[1].clientRequestId).toMatch(/^due-open:(?!due-1$)/);
    // Transfer and repayment request ids only dedupe a retry of the original save; a backup leaves them out.
    expectSurvives("account_transfer", transfers, restored(tx.accountTransfer), { fromAccountId: account, toAccountId: account }, ["clientRequestId"]);
    expectSurvives("budget", budgets, restored(tx.budget), { category });
    expectSurvives("recurring_entry", recurring, restored(tx.recurringEntry), { category, paymentAccountId: account });
    expectSurvives("savings_goal", goals, restored(tx.savingsGoal));
    expectSurvives("savings_goal_contribution", contributions, restored(tx.savingsGoalContribution), { goalId: goal });
    expectSurvives("due_item", dues, restored(tx.dueItem), { category });
    expectSurvives("due_payment", payments, restored(tx.duePayment), { dueItemId: due, transactionId: transaction }, ["clientRequestId"]);
    expectSurvives("receipt", receipts, restored(tx.receiptAttachment), { dueItemId: due, transactionId: transaction }, ["storagePath"]);
    expectSurvives("receipt_scan", receiptScans, restored(tx.receiptScan), {}, ["storagePath"]);
    expect(restored(tx.receiptAttachment)[0].storagePath).toMatch(/^user-1\/restored-/);
    expect(restored(tx.receiptScan)[0].storagePath).toMatch(/^user-1\/restored-/);
  });

  it("restores an older backup without the newer settings and keeps the current ones", async () => {
    mocks.db.user.findUniqueOrThrow.mockResolvedValue({ name: "Asha", currency: "NPR", hideAmounts: false, autoLockMinutes: 0, learningProfile: null });
    mocks.db.dueItem.findMany.mockResolvedValue(dues.map((item) => ({ ...item, annualRatePercent: undefined, payments: [] })));
    mocks.db.transaction.findMany.mockResolvedValue(transactions.map((item) => ({ ...item, clientRequestId: undefined })));

    const { response } = await exportThenRestore();

    expect(response.status).toBe(200);
    expect(mocks.tx.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { name: "Asha", currency: "NPR", hideAmounts: false, autoLockMinutes: 0 } });
    expect(restored(mocks.tx.dueItem)[0].annualRatePercent).toBeNull();
    expect(restored(mocks.tx.transaction).map((row) => row.clientRequestId)).toEqual([null, null]);
  });

  it("explains a database failure without echoing it, and changes nothing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.db.$transaction.mockRejectedValueOnce(Object.assign(new Error("Can't reach database server at `db.internal.supabase.co:5432`"), { code: "P1001" }));

    const { response } = await exportThenRestore();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Could not restore this backup. Nothing was changed; try again in a moment.");
    expect(JSON.stringify(body)).not.toContain("supabase.co");
    expect(mocks.removeStoredReceipts).toHaveBeenCalledWith(expect.arrayContaining([expect.stringMatching(/^user-1\/restored-/)]));
    consoleError.mockRestore();
  });
});
