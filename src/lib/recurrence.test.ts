import { describe, expect, it } from "vitest";
import { firstRecurringOccurrence, latestDueOccurrence, nextRecurringOccurrence, recurrenceLabel, recurringOccurrencesBetween, scheduledOccurrencesBetween } from "./recurrence";

describe("recurring schedules", () => {
  it("supports daily schedules", () => {
    const schedule = { recurrenceUnit: "day" as const, recurrenceInterval: 1, anchorDate: "2026-07-27" };
    expect(nextRecurringOccurrence(schedule, "2026-07-27")).toBe("2026-07-28");
    expect(firstRecurringOccurrence(schedule, "2026-07-30")).toBe("2026-07-30");
  });

  it("supports weekly and fortnightly schedules", () => {
    expect(nextRecurringOccurrence({ recurrenceUnit: "week", recurrenceInterval: 1, anchorDate: "2026-07-27" }, "2026-07-27")).toBe("2026-08-03");
    expect(nextRecurringOccurrence({ recurrenceUnit: "week", recurrenceInterval: 2, anchorDate: "2026-07-27" }, "2026-07-27")).toBe("2026-08-10");
  });

  it("keeps the monthly anchor after shorter months", () => {
    const schedule = { recurrenceUnit: "month" as const, recurrenceInterval: 1, anchorDate: "2026-01-31" };
    expect(nextRecurringOccurrence(schedule, "2026-01-31")).toBe("2026-02-28");
    expect(nextRecurringOccurrence(schedule, "2026-02-28")).toBe("2026-03-31");
  });

  it("supports quarterly schedules", () => {
    expect(nextRecurringOccurrence({ recurrenceUnit: "month", recurrenceInterval: 3, anchorDate: "2026-01-15" }, "2026-01-15")).toBe("2026-04-15");
  });

  it("restores leap day on the next leap year", () => {
    const schedule = { recurrenceUnit: "year" as const, recurrenceInterval: 1, anchorDate: "2024-02-29" };
    expect(nextRecurringOccurrence(schedule, "2024-02-29")).toBe("2025-02-28");
    expect(nextRecurringOccurrence(schedule, "2027-02-28")).toBe("2028-02-29");
  });

  it("finds the first occurrence on or after today", () => {
    const schedule = { recurrenceUnit: "week" as const, recurrenceInterval: 1, anchorDate: "2026-07-01" };
    expect(firstRecurringOccurrence(schedule, "2026-07-15")).toBe("2026-07-15");
    expect(firstRecurringOccurrence(schedule, "2026-07-16")).toBe("2026-07-22");
  });

  it("enumerates every occurrence in a reporting window", () => {
    expect(recurringOccurrencesBetween({
      active: true,
      nextDueOn: "2026-07-01",
      recurrenceUnit: "week",
      recurrenceInterval: 2,
      anchorDate: "2026-07-01",
    }, "2026-07-10", "2026-08-10")).toEqual(["2026-07-15", "2026-07-29"]);
  });

  it("walks the bare schedule from its anchor, whatever is still due", () => {
    const schedule = { recurrenceUnit: "month" as const, recurrenceInterval: 1, anchorDate: "2026-01-31" };
    expect(scheduledOccurrencesBetween(schedule, "2026-02-01", "2026-04-30")).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(scheduledOccurrencesBetween(schedule, "2026-05-01", "2026-04-30")).toEqual([]);
  });

  it("resumes a long pause at the latest occurrence already due", () => {
    const schedule = { recurrenceUnit: "month" as const, recurrenceInterval: 1, anchorDate: "2026-01-01" };
    expect(latestDueOccurrence(schedule, "2026-07-01", "2026-10-07")).toBe("2026-10-01");
    // A quick pause and resume keeps the overdue occurrence waiting.
    expect(latestDueOccurrence(schedule, "2026-10-01", "2026-10-07")).toBe("2026-10-01");
    // Nothing due yet: the schedule is left alone.
    expect(latestDueOccurrence(schedule, "2026-11-01", "2026-10-07")).toBe("2026-11-01");
  });

  it("uses concise human-readable labels", () => {
    expect(recurrenceLabel({ recurrenceUnit: "day", recurrenceInterval: 1 })).toBe("Daily");
    expect(recurrenceLabel({ recurrenceUnit: "month", recurrenceInterval: 1 })).toBe("Monthly");
    expect(recurrenceLabel({ recurrenceUnit: "week", recurrenceInterval: 2 })).toBe("Every 2 weeks");
  });
});
