import { describe, expect, it } from "vitest";
import { formatMoney } from "./currency";
import { buildReminderDigest } from "./reminder-digest";
import type { DueItem, RecurringEntry } from "../types";

const due = (overrides: Partial<DueItem>): DueItem => ({
  id: "d1", userId: "user-1", kind: "payment", title: "Internet", person: "WorldLink", amountMinor: 150000, category: "utilities",
  occurredOn: null, dueOn: "2026-09-26", remindOn: null, snoozedUntil: null, note: "", status: "open", annualRatePercent: null,
  completedOn: null, createdAt: "2026-09-01T00:00:00.000Z", payments: [], ...overrides,
});

const recurring = (overrides: Partial<RecurringEntry>): Pick<RecurringEntry, "id" | "active" | "kind" | "note" | "category" | "amountMinor" | "nextDueOn"> => ({
  id: "r1", active: true, kind: "expense", note: "Rent", category: "housing", amountMinor: 2000000, nextDueOn: "2026-09-26", ...overrides,
});

describe("buildReminderDigest", () => {
  it("includes tomorrow and overdue items, and skips snoozed or later ones", () => {
    const notices = buildReminderDigest({
      today: "2026-09-25",
      currency: "NPR",
      dues: [
        due({}),
        due({ id: "later", title: "Far away", dueOn: "2026-10-20" }),
        due({ id: "quiet", title: "Snoozed", dueOn: "2026-09-25", snoozedUntil: "2026-09-28" }),
        due({ id: "late", title: "Overdue EMI", dueOn: "2026-09-20" }),
      ],
      recurring: [recurring({}), recurring({ id: "r2", note: "Salary", kind: "income", nextDueOn: "2026-10-10" })],
    });

    expect(notices.map((item) => item.title)).toEqual(["Internet", "Overdue EMI", "Rent"]);
    expect(notices[0].body).toContain("due tomorrow");
    expect(notices[1].body).toContain("overdue");
  });

  it("writes amounts in the ledger's currency and counts only what is still owed", () => {
    const [internet, rent] = buildReminderDigest({
      today: "2026-09-25",
      currency: "NPR",
      dues: [due({ payments: [{ id: "p1", userId: "user-1", dueItemId: "d1", amountMinor: 50000, occurredOn: "2026-09-20", note: "", transactionId: null, createdAt: "2026-09-20T00:00:00.000Z" }] })],
      recurring: [recurring({ nextDueOn: "2026-09-25" })],
    });
    expect(internet.body).toBe(`WorldLink · ${formatMoney(100000, "NPR")} due tomorrow`);
    expect(internet.body).toMatch(/^WorldLink · NPR\s1,000 due tomorrow$/);
    expect(rent.body).toMatch(/^NPR\s20,000 expense is due today$/);
    const [dollars] = buildReminderDigest({ today: "2026-09-25", currency: "USD", dues: [], recurring: [recurring({ amountMinor: 1250 })] });
    expect(dollars.body).toMatch(/^USD\s12\.5 expense is due tomorrow$/);
  });
});
