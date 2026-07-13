import { describe, expect, it } from "vitest";
import { formatMoney, majorToMinor } from "./currency";

describe("money helpers", () => {
  it("converts entered decimal amounts to integer minor units", () => {
    expect(majorToMinor("1,234.56")).toBe(123456);
    expect(majorToMinor("not-money")).toBe(0);
  });

  it("formats every supported currency", () => {
    expect(formatMoney(125000, "NPR")).toContain("NPR");
    expect(formatMoney(125000, "USD")).toContain("USD");
    expect(formatMoney(125000, "AUD")).toContain("AUD");
  });
});
