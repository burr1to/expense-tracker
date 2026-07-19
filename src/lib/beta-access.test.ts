import { describe, expect, it } from "vitest";
import { hasBetaAccess, parseBetaAllowedEmails } from "./beta-access";

describe("beta access allowlist", () => {
  it("parses comma-separated emails without case or whitespace sensitivity", () => {
    expect([...parseBetaAllowedEmails(" First@Example.com,second@example.com ,, ")]).toEqual([
      "first@example.com",
      "second@example.com",
    ]);
  });

  it("allows only an exact normalized email match", () => {
    const allowed = "first@example.com, second@example.com";
    expect(hasBetaAccess(" FIRST@example.com ", allowed)).toBe(true);
    expect(hasBetaAccess("other@example.com", allowed)).toBe(false);
    expect(hasBetaAccess("first@example.com.evil", allowed)).toBe(false);
  });

  it("fails closed when the allowlist is missing or empty", () => {
    expect(hasBetaAccess("first@example.com", undefined)).toBe(false);
    expect(hasBetaAccess("first@example.com", "  , ")).toBe(false);
  });
});
