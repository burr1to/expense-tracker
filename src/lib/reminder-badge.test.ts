import { describe, expect, it } from "vitest";
import { reminderBadgeText, urgentReminderCount } from "./reminder-badge";
import type { DueItem } from "../types";

const due = (changes: Partial<DueItem> = {}): DueItem => ({ id: "d1", userId: "u1", kind: "payment", title: "Internet", person: "", amountMinor: 10_000, category: "bills", occurredOn: null, dueOn: "2026-10-07", remindOn: null, snoozedUntil: null, note: "", status: "open", annualRatePercent: null, completedOn: null, createdAt: "2026-10-01T00:00:00.000Z", payments: [], receipt: null, ...changes });

describe("urgentReminderCount", () => {
  const today = "2026-10-07";

  it("adds overdue and due-today dues to recurring entries that have arrived", () => {
    const dues = [
      due({ id: "overdue", dueOn: "2026-10-01" }),
      due({ id: "today" }),
      due({ id: "reminded-early", dueOn: "2026-10-12", remindOn: "2026-10-05" }),
      due({ id: "snoozed", dueOn: "2026-10-01", snoozedUntil: "2026-10-08" }),
      due({ id: "settled", dueOn: "2026-10-01", status: "completed" }),
    ];
    const recurring = [{ dueOn: "2026-10-03" }, { dueOn: "2026-10-07" }, { dueOn: "2026-10-08" }, { dueOn: "2026-10-01", active: false }];
    expect(urgentReminderCount(dues, recurring, today)).toBe(2 + 2);
  });

  it("is zero when only later items are waiting", () => {
    expect(urgentReminderCount([due({ dueOn: "2026-10-12", remindOn: "2026-10-05" })], [{ dueOn: "2026-10-20" }], today)).toBe(0);
  });

  it("moves with the day", () => {
    const recurring = [{ dueOn: "2026-10-08" }];
    expect(urgentReminderCount([], recurring, "2026-10-07")).toBe(0);
    expect(urgentReminderCount([], recurring, "2026-10-08")).toBe(1);
  });
});

describe("reminderBadgeText", () => {
  it("shows the number, caps it at 9+ and stays empty for zero", () => {
    expect(reminderBadgeText(0)).toBe("");
    expect(reminderBadgeText(3)).toBe("3");
    expect(reminderBadgeText(9)).toBe("9");
    expect(reminderBadgeText(12)).toBe("9+");
  });
});
