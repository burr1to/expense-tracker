/** Short names for what a connected app may do, safe to import in the browser (agent-oauth.ts uses node:crypto). */
export const AGENT_SCOPE_LABELS: Record<string, string> = {
  "ledger:read": "Reads your whole ledger",
  "ledger:draft": "Sends messages for review",
};
