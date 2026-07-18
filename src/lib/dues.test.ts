import { describe, expect, it } from "vitest";
import { actionableDues, duePaid, dueRemaining } from "./dues";
import type { DueItem } from "../types";

const item = (changes: Partial<DueItem> = {}): DueItem => ({ id: "d1", userId: "u1", kind: "lent", title: "Lunch", person: "Mina", amountMinor: 10_000, category: "other", occurredOn: "2026-07-01", dueOn: "2026-07-10", remindOn: "2026-07-08", note: "", status: "open", completedOn: null, createdAt: "2026-07-01T00:00:00.000Z", payments: [], receipt: null, ...changes });

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
});
