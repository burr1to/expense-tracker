import { describe, expect, it } from "vitest";
import { householdInviteToken, isHouseholdInviteToken } from "./household-invite";

const secret = "test-secret";

describe("household invite tokens", () => {
  it("accepts the token minted for that invite and address", () => {
    const token = householdInviteToken("invite-1", "Bob@Example.com", secret);
    expect(isHouseholdInviteToken(token, "invite-1", "bob@example.com", secret)).toBe(true);
  });

  it("rejects a token for another invite, another address or another secret", () => {
    const token = householdInviteToken("invite-1", "bob@example.com", secret);
    expect(isHouseholdInviteToken(token, "invite-2", "bob@example.com", secret)).toBe(false);
    expect(isHouseholdInviteToken(token, "invite-1", "mallory@example.com", secret)).toBe(false);
    expect(isHouseholdInviteToken(token, "invite-1", "bob@example.com", "other-secret")).toBe(false);
    expect(isHouseholdInviteToken("", "invite-1", "bob@example.com", secret)).toBe(false);
  });
});
