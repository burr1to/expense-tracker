import { describe, expect, it, vi } from "vitest";
import { SIGN_OUT_TIMEOUT_MS, signOutClient } from "./auth-client";

describe("signOutClient", () => {
  it("bounds the sign-out request so the UI cannot wait forever", async () => {
    const request = vi.fn(async () => ({
      data: { success: true },
      error: null,
    }));

    await signOutClient(request);

    expect(request).toHaveBeenCalledWith({ fetchOptions: { timeout: SIGN_OUT_TIMEOUT_MS } });
  });

  it("turns an aborted request into a useful timeout error", async () => {
    const request = vi.fn(async () => {
      throw new DOMException("Aborted", "AbortError");
    });

    await expect(signOutClient(request)).rejects.toThrow("Sign out timed out. Check your connection and try again.");
  });
});
