import { describe, expect, it } from "vitest";
import { actionableDues, duePaid, dueRemaining, groupActionableDues, urgentDueCount } from "./dues";
import type { DueItem } from "../types";

const item = (changes: Partial<DueItem> = {}): DueItem => ({ id: "d1", userId: "u1", kind: "lent", title: "Lunch", person: "Mina", amountMinor: 10_000, category: "other", occurredOn: "2026-07-01", dueOn: "2026-07-10", remindOn: "2026-07-08", snoozedUntil: null, note: "", status: "open", completedOn: null, createdAt: "2026-07-01T00:00:00.000Z", payments: [], receipt: null, ...changes });

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
});
