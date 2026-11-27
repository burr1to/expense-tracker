import { createHmac, timingSafeEqual } from "node:crypto";

// Sign-up does not verify email addresses, so owning an invited address is proved by the link in the invite email.
// The token is derived from the invite row: removing someone and inviting again voids every earlier link.
function inviteSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not configured.");
  return secret;
}

export function householdInviteToken(inviteId: string, email: string, secret = inviteSecret()) {
  return createHmac("sha256", secret).update(`household-invite:${inviteId}:${email.toLowerCase()}`).digest("base64url");
}

export function isHouseholdInviteToken(token: string, inviteId: string, email: string, secret = inviteSecret()) {
  const expected = Buffer.from(householdInviteToken(inviteId, email, secret));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
