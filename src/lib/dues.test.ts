import { describe, expect, it } from "vitest";
import { calculateCurrentAccountBalance } from "./account-balances";
import { actionableDues, dueDateLabel, dueOpeningMovement, dueOpeningRequestId, duePaid, duePaymentHistory, dueRemaining, dueRepaymentMovement, dueCategoryForKind, dueDirection, dueKindForTab, dueOpeningMovementsByDue, findDueOpeningMovement, groupActionableDues, isDebtKind, latestDuePayment, urgentDueCount } from "./dues";
import { monthlySeries, summarizeLedger } from "./ledger";
import { buildMonthlyReport } from "./monthly-report";
import { adToBs, formatBs } from "./nepali-date";
import type { DueItem, LedgerTransaction, PaymentAccount } from "../types";

const item = (changes: Partial<DueItem> = {}): DueItem => ({ id: "d1", userId: "u1", kind: "lent", title: "Lunch", person: "Mina", amountMinor: 10_000, category: "other", occurredOn: "2026-07-01", dueOn: "2026-07-10", remindOn: "2026-07-08", snoozedUntil: null, note: "", status: "open", annualRatePercent: null, completedOn: null, createdAt: "2026-07-01T00:00:00.000Z", payments: [], receipt: null, ...changes });

describe("dues", () => {
  it("calculates partial repayments and remaining balance", () => {
    const due = item({ payments: [{ id: "p1", userId: "u1", dueItemId: "d1", amountMinor: 2_500, occurredOn: "2026-07-05", note: "", transactionId: null, createdAt: "2026-07-05T00:00:00.000Z" }] });
    expect(duePaid(due)).toBe(2_500);
    expect(dueRemaining(due)).toBe(7_500);
  });

  it("shows open reminders once their reminder date arrives", () => {
    const upcoming = item({ id: "future", dueOn: "2026-07-20", remindOn: "2026-07-18" });
    const settled = item({ id: "settled", status: "completed" });
    expect(actionableDues([upcoming, settled, item()], "2026-07-09").map((due) => due.id)).toEqual(["d1"]);
  });

  it("hides snoozed reminders until their snooze date arrives", () => {
    const snoozed = item({ snoozedUntil: "2026-07-12" });
    expect(actionableDues([snoozed], "2026-07-11")).toEqual([]);
    expect(actionableDues([snoozed], "2026-07-12")).toEqual([snoozed]);
  });

  it("groups reminders by urgency and counts only overdue and today as urgent", () => {
    const overdue = item({ id: "overdue", dueOn: "2026-07-10" });
    const today = item({ id: "today", dueOn: "2026-07-11" });
    const later = item({ id: "later", dueOn: "2026-07-15", remindOn: "2026-07-11" });
    const groups = groupActionableDues([later, today, overdue], "2026-07-11");
    expect(groups.overdue.map((due) => due.id)).toEqual(["overdue"]);
    expect(groups.today.map((due) => due.id)).toEqual(["today"]);
    expect(groups.later.map((due) => due.id)).toEqual(["later"]);
    expect(urgentDueCount([later, today, overdue], "2026-07-11")).toBe(2);
  });

  it("shows far-off due dates in the user's calendar", () => {
    const today = new Date(2026, 9, 7);
    expect(dueDateLabel("2026-10-30", today)).toBe("Due Oct 30");
    expect(dueDateLabel("2026-10-30", today, "BS")).toBe(`Due ${formatBs(adToBs("2026-10-30"), "short").replace(/, \d+$/, "")}`);
    expect(dueDateLabel("2026-10-09", today, "BS")).toBe("Due in 2 days");
  });

  it("finds the latest repayment for Undo and lists history oldest first", () => {
    const first = { id: "p1", userId: "u1", dueItemId: "d1", amountMinor: 1_000, occurredOn: "2026-07-05", note: "", transactionId: null, createdAt: "2026-07-05T00:00:00.000Z" };
    const second = { ...first, id: "p2", occurredOn: "2026-07-03", createdAt: "2026-07-06T00:00:00.000Z" };
    expect(latestDuePayment(item({ payments: [first, second] }))?.id).toBe("p2");
    expect(duePaymentHistory(item({ payments: [first, second] })).map((payment) => payment.id)).toEqual(["p2", "p1"]);
    expect(latestDuePayment(item())).toBeUndefined();
  });
});

describe("loan movements", () => {
  const account: PaymentAccount = { id: "esewa", importId: "i1", userId: "u1", type: "esewa", provider: "esewa", label: "", balanceMinor: 2_000_000, balanceAsOf: "2026-07-01", balanceRecordedAt: "2026-07-01T00:00:00.000Z", currentBalanceMinor: 2_000_000, createdAt: "2026-07-01T00:00:00.000Z" };
  const row = (id: string, movement: { kind: LedgerTransaction["kind"]; category: string; subcategory: string | null; note: string }, amountMinor: number, occurredOn: string): LedgerTransaction => ({
    id, userId: "u1", ...movement, amountMinor, occurredOn, area: null, paymentMode: "online", paymentAccountId: "esewa",
    locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null, locationSource: null, savedPlaceId: null, createdAt: `${occurredOn}T09:00:00.000Z`,
  });
  const lent = item({ kind: "lent", title: "Bike repair", person: "Ram", amountMinor: 500_000, category: "loan" });
  const borrowed = item({ kind: "borrowed", title: "Rent gap", person: "Sita", amountMinor: 300_000, category: "loan" });

  it("treats only Lent and Borrowed as loans", () => {
    expect(["lent", "borrowed", "payment", "receivable"].map(isDebtKind)).toEqual([true, true, false, false]);
  });

  it("records lending as money out and borrowing as money in, both in the loan category", () => {
    expect(dueOpeningMovement(lent)).toEqual({ kind: "expense", category: "loan", subcategory: "Lent", note: "Lent to Ram · Bike repair" });
    expect(dueOpeningMovement(borrowed)).toEqual({ kind: "income", category: "loan", subcategory: "Borrowed", note: "Borrowed from Sita · Rent gap" });
  });

  it("books loan repayments as loan movements and bills in their own category", () => {
    expect(dueRepaymentMovement(lent)).toEqual({ kind: "income", category: "loan", subcategory: "Repayment", note: "Repayment from Ram" });
    expect(dueRepaymentMovement(borrowed, " Paid back via eSewa ")).toEqual({ kind: "expense", category: "loan", subcategory: "Repayment", note: "Paid back via eSewa" });
    expect(dueRepaymentMovement(item({ kind: "payment", title: "NEA bill", person: "", category: "utilities" }))).toEqual({ kind: "expense", category: "utilities", subcategory: null, note: "Paid NEA bill" });
    expect(dueRepaymentMovement(item({ kind: "receivable", title: "Deposit", person: "", category: "other" })).kind).toBe("income");
  });

  it("nets a lend-then-repay cycle to zero income and spending while the account goes down and back up", () => {
    const salary = row("salary", { kind: "income", category: "salary", subcategory: null, note: "" }, 6_000_000, "2026-07-01");
    const lunch = row("lunch", { kind: "expense", category: "food", subcategory: null, note: "" }, 50_000, "2026-07-02");
    const lend = row("lend", dueOpeningMovement(lent), 500_000, "2026-07-03");
    const partial = row("repay-1", dueRepaymentMovement(lent), 200_000, "2026-07-10");
    const rest = row("repay-2", dueRepaymentMovement(lent), 300_000, "2026-08-02");
    const before = [salary, lunch];
    const afterLending = [...before, lend];
    const afterRepaying = [...afterLending, partial, rest];

    expect(summarizeLedger(afterRepaying)).toEqual(summarizeLedger(before));
    expect(summarizeLedger(afterRepaying)).toMatchObject({ income: 6_000_000, expenses: 50_000, saved: 5_950_000, savedPercentage: 99 });
    expect(summarizeLedger(afterRepaying).categories.map((category) => category.category)).toEqual(["food"]);
    expect(monthlySeries(afterRepaying).map(({ income, expenses }) => ({ income, expenses }))).toEqual([{ income: 6_000_000, expenses: 50_000 }]);

    const balance = (rows: LedgerTransaction[]) => calculateCurrentAccountBalance(account, rows, []);
    expect(balance(afterLending)).toBe(balance(before) - 500_000);
    expect(balance([...afterLending, partial])).toBe(balance(before) - 300_000);
    expect(balance(afterRepaying)).toBe(balance(before));
  });

  it("keeps a borrow-then-repay cycle out of the monthly report totals but not out of account flows", () => {
    const borrow = row("borrow", dueOpeningMovement(borrowed), 300_000, "2026-07-03");
    const repay = row("repay", dueRepaymentMovement(borrowed), 300_000, "2026-07-20");
    const food = row("food", { kind: "expense", category: "food", subcategory: null, note: "" }, 40_000, "2026-07-04");
    const reportRow = (transaction: LedgerTransaction) => ({ id: transaction.id, kind: transaction.kind, category: transaction.category, categoryLabel: transaction.category, amountMinor: transaction.amountMinor, occurredOn: transaction.occurredOn, note: transaction.note, subcategory: transaction.subcategory, paymentMode: transaction.paymentMode, paymentAccountId: transaction.paymentAccountId });
    const report = buildMonthlyReport({ monthKey: "2026-07", displayName: "Test", currency: "NPR", transactions: [borrow, repay, food].map(reportRow), previousTransactions: [], budgets: [], accounts: [{ id: "esewa", label: "eSewa", balanceMinor: 0, balanceAsOf: "2026-07-01" }], transfers: [], dues: [], recurring: [] });
    expect(report.summary).toMatchObject({ incomeMinor: 0, expenseMinor: 40_000, netMinor: -40_000 });
    expect(report.categories.map((category) => category.label)).toEqual(["food"]);
    expect(report.accounts[0]).toMatchObject({ incomeMinor: 300_000, expenseMinor: 340_000 });
  });

  it("finds the movement recorded when a loan was added", () => {
    const rows = [{ id: "a", clientRequestId: "other" }, { id: "b", clientRequestId: dueOpeningRequestId("d1") }] as unknown as LedgerTransaction[];
    expect(findDueOpeningMovement(rows, "d1")?.id).toBe("b");
    expect(findDueOpeningMovement(rows, "d2")).toBeUndefined();
  });

  it("maps every loan's opening movement to its due in one pass", () => {
    const rows = [{ id: "a", clientRequestId: "split:abc:lent" }, { id: "b", clientRequestId: dueOpeningRequestId("d1") }, { id: "c", clientRequestId: null }, { id: "d", clientRequestId: dueOpeningRequestId("d2") }, { id: "e", clientRequestId: dueOpeningRequestId("") }] as unknown as LedgerTransaction[];
    const byDue = dueOpeningMovementsByDue(rows);
    expect([...byDue.entries()].map(([dueId, row]) => [dueId, row.id])).toEqual([["d1", "b"], ["d2", "d"]]);
  });

  it("picks a category that fits the due type instead of the first in the list", () => {
    const custom = [{ id: "c-rent", userId: "u1", name: "Flat rent", kind: "expense", color: "#000", icon: "home", createdAt: "" }] as never[];
    expect(dueCategoryForKind("lent", "food")).toBe("loan");
    expect(dueCategoryForKind("borrowed", "other")).toBe("loan");
    expect(dueCategoryForKind("payment", "loan")).toBe("other");
    expect(dueCategoryForKind("receivable", "housing")).toBe("other");
    expect(dueCategoryForKind("receivable", "salary")).toBe("salary");
    expect(dueCategoryForKind("payment", "utilities")).toBe("utilities");
    expect(dueCategoryForKind("payment", "c-rent", custom)).toBe("c-rent");
    expect(dueCategoryForKind("receivable", "c-rent", custom)).toBe("other");
    expect(dueDirection("borrowed")).toBe("expense");
    expect(dueDirection("lent")).toBe("income");
  });

  it("starts a new due as the kind of the tab it was added from", () => {
    expect(dueKindForTab("lent")).toBe("lent");
    expect(dueKindForTab("borrowed")).toBe("borrowed");
    expect(dueKindForTab("upcoming")).toBe("payment");
    expect(dueKindForTab("settled")).toBe("payment");
  });
});
