import { describe, expect, it } from "vitest";
import { canPostOnAccount, transactionCountsTowardBudget } from "./household";

describe("household access", () => {
  it("lets a member post a shared entry only on a shared household account", () => {
    const peer = { userId: "partner", shared: true };
    expect(canPostOnAccount("me", { userId: "me", shared: false }, false, ["partner"])).toBe(true);
    expect(canPostOnAccount("me", peer, true, ["partner"])).toBe(true);
    expect(canPostOnAccount("me", peer, false, ["partner"])).toBe(false);
    expect(canPostOnAccount("me", { userId: "partner", shared: false }, true, ["partner"])).toBe(false);
    expect(canPostOnAccount("me", peer, true, [])).toBe(false);
  });

  it("keeps personal budgets on personal entries and shared budgets on shared entries", () => {
    const mine = { userId: "me", shared: false };
    const ours = { userId: "me", shared: true };
    const partnerShared = { userId: "partner", shared: true };
    expect(transactionCountsTowardBudget(mine, { userId: "me", shared: false })).toBe(true);
    expect(transactionCountsTowardBudget(ours, { userId: "me", shared: false })).toBe(false);
    expect(transactionCountsTowardBudget(partnerShared, { userId: "me", shared: false })).toBe(false);
    expect(transactionCountsTowardBudget(ours, { userId: "me", shared: true })).toBe(true);
    expect(transactionCountsTowardBudget(partnerShared, { userId: "me", shared: true })).toBe(true);
    expect(transactionCountsTowardBudget(mine, { userId: "me", shared: true })).toBe(false);
  });
});
