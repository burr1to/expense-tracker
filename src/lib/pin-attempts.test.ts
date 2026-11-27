import { describe, expect, it } from "vitest";
import { PIN_FAILURE_WINDOW_MS, PIN_MAX_FAILURES, pinPausedMessage, pinPauseSeconds } from "./pin-attempts";

const now = 10_000_000;

describe("pinPauseSeconds", () => {
  it("lets a PIN be tried until the limit is reached", () => {
    expect(pinPauseSeconds(Array.from({ length: PIN_MAX_FAILURES - 1 }, (_, index) => now - index * 1000), now)).toBe(0);
  });

  it("pauses until the oldest counted failure leaves the window", () => {
    const failures = Array.from({ length: PIN_MAX_FAILURES }, (_, index) => now - 60_000 + index * 1000);
    expect(pinPauseSeconds(failures, now)).toBe((PIN_FAILURE_WINDOW_MS - 60_000) / 1000);
  });

  it("ignores failures older than the window", () => {
    const old = Array.from({ length: PIN_MAX_FAILURES }, () => now - PIN_FAILURE_WINDOW_MS - 1);
    expect(pinPauseSeconds(old, now)).toBe(0);
  });
});

describe("pinPausedMessage", () => {
  it("speaks in minutes for long pauses", () => {
    expect(pinPausedMessage(30)).toBe("Too many wrong PINs. Try again in 30 seconds.");
    expect(pinPausedMessage(14 * 60 + 1)).toBe("Too many wrong PINs. Try again in 15 minutes.");
  });
});
