import { describe, expect, it } from "vitest";
import {
  addFiscalYears,
  fiscalYearBounds,
  fiscalYearLabel,
  fiscalYearOf,
  formatFiscalYearKey,
  isFiscalYearKey,
  parseFiscalYearKey,
} from "./fiscal-year";
import { bsToAd } from "./nepali-date";
import { isInPeriod, periodBounds } from "./period";

describe("fiscal year keys", () => {
  it("formats and parses a key", () => {
    expect(formatFiscalYearKey(2083)).toBe("FY:2083-84");
    expect(parseFiscalYearKey("FY:2083-84")).toBe(2083);
  });

  it("wraps the second year at the century boundary", () => {
    expect(formatFiscalYearKey(2099)).toBe("FY:2099-00");
  });

  it("rejects a key whose second year does not follow the first", () => {
    expect(isFiscalYearKey("FY:2083-84")).toBe(true);
    expect(isFiscalYearKey("FY:2083-90")).toBe(false);
    expect(isFiscalYearKey("FY:2083")).toBe(false);
    expect(isFiscalYearKey("2083-84")).toBe(false);
    expect(() => parseFiscalYearKey("FY:2083-90")).toThrow(/Invalid fiscal year key/);
  });
});

describe("fiscal year bounds", () => {
  it("runs from Shrawan 1 to the day before the next Shrawan 1", () => {
    const bounds = fiscalYearBounds("FY:2083-84");

    expect(bounds.start).toBe(bsToAd({ year: 2083, month: 4, day: 1 }));
    expect(bounds.endExclusive).toBe(bsToAd({ year: 2084, month: 4, day: 1 }));
  });

  it("starts in mid-July on the Gregorian calendar", () => {
    const { start } = fiscalYearBounds("FY:2083-84");

    expect(start.slice(0, 7)).toBe("2026-07");
    expect(Number(start.slice(8, 10))).toBeGreaterThan(10);
  });

  it("covers a full year without gaps against the next fiscal year", () => {
    expect(fiscalYearBounds("FY:2083-84").endExclusive).toBe(fiscalYearBounds("FY:2084-85").start);
  });

  it("refuses a year outside the supported conversion range", () => {
    expect(() => fiscalYearBounds("FY:1999-00")).toThrow(/Invalid fiscal year key|supported range/);
  });
});

describe("fiscalYearOf", () => {
  it("puts a Shrawan date in the fiscal year that starts that Shrawan", () => {
    const shrawanFirst = bsToAd({ year: 2083, month: 4, day: 1 });

    expect(fiscalYearOf(shrawanFirst)).toBe("FY:2083-84");
  });

  it("puts an Ashadh date in the fiscal year that started the previous Shrawan", () => {
    const ashadhLast = bsToAd({ year: 2083, month: 3, day: 15 });

    expect(fiscalYearOf(ashadhLast)).toBe("FY:2082-83");
  });

  it("puts a mid-year date in the right fiscal year", () => {
    // 12 August 2026 is Shrawan 2083, just after the fiscal year opened.
    expect(fiscalYearOf("2026-08-12")).toBe("FY:2083-84");
    // Mid-April 2026 is Baishakh 2083, still inside the previous fiscal year.
    expect(fiscalYearOf("2026-04-20")).toBe("FY:2082-83");
  });

  it("agrees with its own bounds for the day before and after a boundary", () => {
    const { start } = fiscalYearBounds("FY:2083-84");
    const dayBefore = new Date(Date.parse(`${start}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

    expect(fiscalYearOf(start)).toBe("FY:2083-84");
    expect(fiscalYearOf(dayBefore)).toBe("FY:2082-83");
  });
});

describe("labels and stepping", () => {
  it("labels a fiscal year the way it is written in Nepal", () => {
    expect(fiscalYearLabel("FY:2083-84")).toBe("FY 2083/84");
  });

  it("steps forward and backward", () => {
    expect(addFiscalYears("FY:2083-84", 1)).toBe("FY:2084-85");
    expect(addFiscalYears("FY:2083-84", -1)).toBe("FY:2082-83");
  });

  it("refuses to step outside the supported range", () => {
    expect(() => addFiscalYears("FY:2000-01", -1)).toThrow(/supported range/);
  });
});

describe("integration with the period layer", () => {
  it("resolves fiscal keys through the generic resolver", () => {
    expect(periodBounds("FY:2083-84")).toEqual(fiscalYearBounds("FY:2083-84"));
  });

  it("tests membership through the generic helper", () => {
    const { start, endExclusive } = fiscalYearBounds("FY:2083-84");
    const dayBefore = new Date(Date.parse(`${start}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

    expect(isInPeriod(start, "FY:2083-84")).toBe(true);
    expect(isInPeriod("2026-08-12", "FY:2083-84")).toBe(true);
    expect(isInPeriod(dayBefore, "FY:2083-84")).toBe(false);
    expect(isInPeriod(endExclusive, "FY:2083-84")).toBe(false);
  });
});
