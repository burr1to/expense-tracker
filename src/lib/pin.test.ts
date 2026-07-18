import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "./pin";

describe("ledger PIN hashing", () => {
  it("verifies the correct PIN without storing it in plaintext", async () => {
    const stored = await hashPin("4826");

    expect(stored).not.toContain("4826");
    await expect(verifyPin("4826", stored)).resolves.toBe(true);
    await expect(verifyPin("4827", stored)).resolves.toBe(false);
  });

  it("uses a unique salt for each hash", async () => {
    const first = await hashPin("4826");
    const second = await hashPin("4826");

    expect(first).not.toBe(second);
  });
});
