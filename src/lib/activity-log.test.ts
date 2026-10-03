import { describe, expect, it } from "vitest";
import { activityCutoff, describeDevice, diffFields, isActivityArea, meaningfulIp, periodText } from "./activity-log";

describe("diffFields", () => {
  const fields = [
    { key: "note", label: "Note" },
    { key: "amountMinor", label: "Amount", kind: "money" },
    { key: "occurredOn", label: "Date", kind: "date" },
    { key: "shared", label: "Shared", kind: "flag" },
  ] as const;
  const base = { note: "Groceries", amountMinor: 1200, occurredOn: new Date("2026-10-01T00:00:00.000Z"), shared: false };

  it("lists nothing when no tracked field changed", () => {
    expect(diffFields(base, { ...base, occurredOn: new Date("2026-10-01T00:00:00.000Z") }, fields)).toEqual([]);
  });

  it("keeps money and dates structured and turns flags into words", () => {
    expect(diffFields(base, { ...base, amountMinor: 1500, occurredOn: new Date("2026-10-02T00:00:00.000Z"), shared: true }, fields)).toEqual([
      { field: "Amount", from: { money: 1200 }, to: { money: 1500 } },
      { field: "Date", from: { date: "2026-10-01" }, to: { date: "2026-10-02" } },
      { field: "Shared", from: "Off", to: "On" },
    ]);
  });

  it("treats empty text and null as the same value", () => {
    expect(diffFields({ ...base, note: "" }, { ...base, note: null as unknown as string }, fields)).toEqual([]);
    expect(diffFields({ ...base, note: "" }, { ...base, note: "Rent" }, fields)).toEqual([{ field: "Note", from: null, to: "Rent" }]);
  });
});

describe("periodText", () => {
  it("names Gregorian, Bikram Sambat and festival periods", () => {
    expect(periodText("2026-10")).toBe("October 2026");
    expect(periodText("BS:2083-06")).toBe("Ashwin 2083");
    expect(periodText("FEST:dashain-tihar")).toBe("Dashain Tihar");
  });
});

describe("describeDevice", () => {
  it("names the browser and system", () => {
    expect(describeDevice("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")).toBe("Chrome on Linux");
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iOS");
    expect(describeDevice(null)).toBeNull();
  });
});

describe("retention", () => {
  it("keeps 90 days", () => {
    expect(activityCutoff(new Date("2026-10-03T00:00:00.000Z")).toISOString()).toBe("2026-07-05T00:00:00.000Z");
  });

  it("only accepts known areas", () => {
    expect(isActivityArea("security")).toBe(true);
    expect(isActivityArea("everything")).toBe(false);
  });
});

describe("meaningfulIp", () => {
  it("drops loopback and unset addresses", () => {
    expect(meaningfulIp("0000:0000:0000:0000:0000:0000:0000:0000")).toBeNull();
    expect(meaningfulIp("::1")).toBeNull();
    expect(meaningfulIp("127.0.0.1")).toBeNull();
    expect(meaningfulIp("27.34.12.9")).toBe("27.34.12.9");
  });
});
