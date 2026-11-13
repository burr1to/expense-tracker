import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * OAuth 2.1 authorization for agents such as Muse that call the ledger's MCP endpoint.
 *
 * Deliberately small: one grant type (authorization code with S256 PKCE), clients registered
 * by an operator script, a consent screen on every authorization, and only SHA-256 hashes of
 * codes, tokens and client secrets in the database.
 */

export const AGENT_SCOPES = {
  "ledger:read": "See your whole ledger: entries, balances, budgets, dues, goals and reports",
  "ledger:draft": "Send bank and wallet messages for you to review before anything is saved",
  "ledger:write": "Add, edit and delete your entries and transfers directly, without asking you first",
} as const;
export type AgentScope = keyof typeof AGENT_SCOPES;

export const MCP_PATH = "/api/mcp";
export const AUTHORIZE_PATH = "/oauth/authorize";
export const TOKEN_PATH = "/api/oauth/token";
export const REVOKE_PATH = "/api/oauth/revoke";

export const CODE_TTL_SECONDS = 10 * 60;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
/** Rolling: each refresh issues a new refresh token with a fresh window, so an agent that checks in monthly stays connected. */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Scope words that standard OAuth clients add by habit. They grant nothing here and are dropped, not refused. */
export const IGNORED_SCOPES = new Set(["openid", "profile", "email", "offline_access"]);

export function isAgentScope(value: string): value is AgentScope {
  return Object.hasOwn(AGENT_SCOPES, value);
}

export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Compares a presented secret with a stored SHA-256 hex hash in constant time. */
export function secretMatches(presented: string, storedHash: string) {
  const a = Buffer.from(hashSecret(presented), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A random bearer value. The prefix only makes a leaked value recognisable in logs and scanners. */
export function newSecret(prefix: string) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)) must equal the challenge. */
export function pkceMatches(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/**
 * The scopes to grant: what the client asked for, limited to what it is registered for.
 * An empty request means everything the client is registered for. Returns null when the
 * request names a ledger scope the client may not have, or nothing grantable remains.
 */
export function grantableScopes(requested: string | null | undefined, clientScopes: readonly string[]): AgentScope[] | null {
  const allowed = clientScopes.filter(isAgentScope);
  const words = (requested ?? "").split(/\s+/).filter(Boolean).filter((word) => !IGNORED_SCOPES.has(word));
  if (words.length === 0) return allowed.length ? allowed : null;
  if (words.some((word) => !allowed.includes(word as AgentScope))) return null;
  const granted = allowed.filter((scope) => words.includes(scope));
  return granted.length ? granted : null;
}

/** The public origin that names this server in tokens and metadata. */
export function appOrigin(request: Request) {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  if (configured) {
    try { return new URL(configured).origin; } catch { /* fall back to the request */ }
  }
  return new URL(request.url).origin;
}

export function mcpResource(origin: string) {
  return `${origin}${MCP_PATH}`;
}

export interface AuthorizeClient {
  id: string;
  clientId: string;
  name: string;
  redirectUris: string[];
  scopes: string[];
  disabled: boolean;
}

export interface AuthorizeRequest {
  client: AuthorizeClient;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scopes: AgentScope[];
  resource: string;
}

/**
 * Errors before the redirect URI is trusted are shown on our own page; after it is trusted they
 * go back to the client, as RFC 6749 §4.1.2.1 requires, so a forged link can never bounce a user
 * to an unregistered address.
 */
export type AuthorizeCheck =
  | { ok: true; request: AuthorizeRequest }
  | { ok: false; redirect: null; message: string }
  | { ok: false; redirect: string; message: string };

export function errorRedirect(redirectUri: string, error: string, description: string, state: string | null) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export function checkAuthorizeRequest(params: URLSearchParams, client: AuthorizeClient | null, origin: string): AuthorizeCheck {
  if (!client || client.disabled) return { ok: false, redirect: null, message: "This app is not registered to connect to SaveYoRupee." };
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!client.redirectUris.includes(redirectUri)) return { ok: false, redirect: null, message: "This app sent an address SaveYoRupee does not recognise, so it was not opened." };
  const state = params.get("state");
  const fail = (error: string, message: string): AuthorizeCheck => ({ ok: false, redirect: errorRedirect(redirectUri, error, message, state), message });
  if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  const codeChallenge = params.get("code_challenge") ?? "";
  if (!/^[A-Za-z0-9\-_]{43}$/.test(codeChallenge) || params.get("code_challenge_method") !== "S256") return fail("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  const resource = params.get("resource") ?? mcpResource(origin);
  if (resource !== mcpResource(origin)) return fail("invalid_target", "Unknown resource.");
  const scopes = grantableScopes(params.get("scope"), client.scopes);
  if (!scopes) return fail("invalid_scope", "The requested scope is not available to this app.");
  return { ok: true, request: { client, redirectUri, state, codeChallenge, scopes, resource } };
}

export function successRedirect(redirectUri: string, code: string, state: string | null, issuer: string) {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  // RFC 9207: lets the client confirm which server answered.
  url.searchParams.set("iss", issuer);
  return url.toString();
}

/** Reads client credentials from HTTP Basic (preferred) or the form body. */
export function clientCredentials(authorization: string | null, body: URLSearchParams): { clientId: string; clientSecret: string } | null {
  if (authorization?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon < 1) return null;
      return { clientId: decodeURIComponent(decoded.slice(0, colon)), clientSecret: decodeURIComponent(decoded.slice(colon + 1)) };
    } catch {
      return null;
    }
  }
  const clientId = body.get("client_id");
  const clientSecret = body.get("client_secret");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${TOKEN_PATH}`,
    revocation_endpoint: `${origin}${REVOKE_PATH}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    revocation_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    scopes_supported: Object.keys(AGENT_SCOPES),
    authorization_response_iss_parameter_supported: true,
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: Object.keys(AGENT_SCOPES),
    bearer_methods_supported: ["header"],
    resource_name: "SaveYoRupee ledger",
  };
}

export function protectedResourceMetadataUrl(origin: string) {
  return `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`;
}
