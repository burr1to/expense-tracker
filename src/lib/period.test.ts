import { describe, expect, it } from "vitest";
import {
  addMonthsToKey,
  currentMonthKey,
  daysInPeriod,
  formatMonthKey,
  fromStorageKey,
  isInPeriod,
  isMonthKey,
  isSameMonthKey,
  monthBounds,
  monthKeyOf,
  monthLabel,
  parseMonthKey,
  periodBounds,
  todayInAppZone,
  toStorageKey,
} from "./period";

describe("period keys", () => {
  it("parses prefixed and legacy month keys to the same period", () => {
    expect(parseMonthKey("AD:2026-08")).toEqual({ system: "AD", year: 2026, month: 8 });
    expect(parseMonthKey("2026-08")).toEqual({ system: "AD", year: 2026, month: 8 });
  });

  it("rejects malformed keys", () => {
    expect(() => parseMonthKey("2026-13")).toThrow();
    expect(() => parseMonthKey("2026-00")).toThrow();
    expect(() => parseMonthKey("26-08")).toThrow();
    expect(() => parseMonthKey("XX:2026-08")).toThrow();
    expect(isMonthKey("not-a-key")).toBe(false);
  });

  it("treats legacy and prefixed forms of the same month as equal", () => {
    expect(isSameMonthKey("2026-08", "AD:2026-08")).toBe(true);
    expect(isSameMonthKey("2026-08", "AD:2026-09")).toBe(false);
  });

  it("keeps Gregorian storage keys byte-identical to the legacy format", () => {
    expect(toStorageKey("AD:2026-08")).toBe("2026-08");
    expect(toStorageKey("2026-08")).toBe("2026-08");
    expect(fromStorageKey("2026-08")).toBe("AD:2026-08");
  });

  it("round-trips storage keys", () => {
    for (const stored of ["2026-01", "2026-12", "1999-06"]) {
      expect(toStorageKey(fromStorageKey(stored))).toBe(stored);
    }
  });

  it("formats a period back into its key", () => {
    expect(formatMonthKey({ system: "AD", year: 2026, month: 3 })).toBe("AD:2026-03");
  });
});

describe("month bounds", () => {
  it("returns an inclusive start and exclusive end", () => {
    expect(monthBounds("AD:2026-08")).toEqual({ start: "2026-08-01", endExclusive: "2026-09-01" });
  });

  it("rolls December into the next year", () => {
    expect(monthBounds("AD:2026-12")).toEqual({ start: "2026-12-01", endExclusive: "2027-01-01" });
  });

  it("counts days including leap Februaries", () => {
    expect(daysInPeriod("AD:2026-02")).toBe(28);
    expect(daysInPeriod("AD:2024-02")).toBe(29);
    expect(daysInPeriod("AD:2026-08")).toBe(31);
    expect(daysInPeriod("AD:2026-04")).toBe(30);
  });

  it("labels a month readably", () => {
    expect(monthLabel("AD:2026-08")).toBe("August 2026");
    expect(monthLabel("2026-01")).toBe("January 2026");
  });

  it("resolves generic period bounds for month keys", () => {
    expect(periodBounds("2026-08")).toEqual(monthBounds("AD:2026-08"));
  });

  it("rejects an unknown period key", () => {
    expect(() => periodBounds("NOPE:1")).toThrow(/Invalid period key/);
  });
});

describe("addMonthsToKey", () => {
  it("steps forward and backward within a year", () => {
    expect(addMonthsToKey("AD:2026-08", 1)).toBe("AD:2026-09");
    expect(addMonthsToKey("AD:2026-08", -1)).toBe("AD:2026-07");
  });

  it("crosses year boundaries in both directions", () => {
    expect(addMonthsToKey("AD:2026-12", 1)).toBe("AD:2027-01");
    expect(addMonthsToKey("AD:2026-01", -1)).toBe("AD:2025-12");
    expect(addMonthsToKey("AD:2026-06", 12)).toBe("AD:2027-06");
    expect(addMonthsToKey("AD:2026-06", -18)).toBe("AD:2024-12");
  });

  it("accepts legacy keys and returns the canonical form", () => {
    expect(addMonthsToKey("2026-08", 1)).toBe("AD:2026-09");
  });
});

describe("isInPeriod", () => {
  it("includes the first and last day of the month", () => {
    expect(isInPeriod("2026-08-01", "AD:2026-08")).toBe(true);
    expect(isInPeriod("2026-08-31", "AD:2026-08")).toBe(true);
  });

  it("excludes days either side", () => {
    expect(isInPeriod("2026-07-31", "AD:2026-08")).toBe(false);
    expect(isInPeriod("2026-09-01", "AD:2026-08")).toBe(false);
  });

  it("rejects malformed dates rather than throwing", () => {
    expect(isInPeriod("2026-08", "AD:2026-08")).toBe(false);
    expect(isInPeriod("", "AD:2026-08")).toBe(false);
  });
});

describe("Kathmandu anchoring", () => {
  // Kathmandu is UTC+05:45 year round, so 2026-07-31T19:00Z is already
  // 2026-08-01 locally. This is the case the old local-time monthKey got wrong.
  it("files a late-UTC instant into the Kathmandu day", () => {
    expect(todayInAppZone(new Date("2026-07-31T19:00:00Z"))).toBe("2026-08-01");
    expect(currentMonthKey("AD", new Date("2026-07-31T19:00:00Z"))).toBe("AD:2026-08");
  });

  it("keeps an early-UTC instant in the previous Kathmandu day", () => {
    expect(todayInAppZone(new Date("2026-08-01T00:00:00Z"))).toBe("2026-08-01");
    expect(todayInAppZone(new Date("2026-07-31T18:00:00Z"))).toBe("2026-07-31");
  });

  it("derives a month key from a date string without timezone drift", () => {
    expect(monthKeyOf("2026-08-01")).toBe("AD:2026-08");
    expect(monthKeyOf("2026-12-31")).toBe("AD:2026-12");
  });
});
