import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? process.env.BETTER_AUTH_URL : window.location.origin,
});

export const SIGN_OUT_TIMEOUT_MS = 10_000;

type SignOutRequest = (options: { fetchOptions: { timeout: number } }) => Promise<{
  error: { message?: string } | null;
}>;

export async function signOutClient(request: SignOutRequest = (options) => authClient.signOut(options)) {
  let result;
  try {
    result = await request({ fetchOptions: { timeout: SIGN_OUT_TIMEOUT_MS } });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") {
      throw new Error("Sign out timed out. Check your connection and try again.");
    }
    throw caught;
  }
  if (result.error) throw new Error(result.error.message ?? "Could not sign out.");
}
