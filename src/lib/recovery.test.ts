import { describe, expect, it } from "vitest";
import { hashRecoverySecret, verifyRecoverySecret } from "./recovery-crypto";
import { generateRecoveryCode, normalizeRecoveryAnswer, normalizeRecoveryCode } from "./recovery";

describe("password recovery helpers", () => {
  it("normalizes answers without changing their meaning", () => {
    expect(normalizeRecoveryAnswer("  Kathmandu   Valley ")).toBe("kathmandu valley");
    expect(normalizeRecoveryCode(" abcd-1234 ")).toBe("ABCD1234");
  });

  it("generates a copy-friendly high-entropy recovery code", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^(?:[0-9A-F]{4}-){7}[0-9A-F]{4}$/);
  });

  it("hashes recovery secrets and verifies only the original value", async () => {
    const stored = await hashRecoverySecret("kathmandu valley");

    expect(stored).not.toContain("kathmandu valley");
    await expect(verifyRecoverySecret("kathmandu valley", stored)).resolves.toBe(true);
    await expect(verifyRecoverySecret("pokhara valley", stored)).resolves.toBe(false);
  });
});
