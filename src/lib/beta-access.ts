export const BETA_ACCESS_DENIED_MESSAGE = "This email does not have beta access yet.";

export function parseBetaAllowedEmails(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function hasBetaAccess(email: string | null | undefined, value = process.env.BETA_ALLOWED_EMAILS) {
  if (!email) return false;
  return parseBetaAllowedEmails(value).has(email.trim().toLowerCase());
}
