import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkAuthorizeRequest, clientCredentials, grantableScopes, hashSecret, pkceMatches, secretMatches, type AuthorizeClient } from "./agent-oauth";

const origin = "https://ledger.example";
const client: AuthorizeClient = { id: "c1", clientId: "syr_client_muse", name: "Muse", redirectUris: ["https://muse.example/callback"], scopes: ["ledger:read", "ledger:draft"], disabled: false };
const verifier = "a".repeat(43) + "-._~xyz";
const challenge = createHash("sha256").update(verifier).digest("base64url");

function params(overrides: Record<string, string | null> = {}) {
  const base: Record<string, string> = {
    response_type: "code", client_id: client.clientId, redirect_uri: client.redirectUris[0], state: "s1",
    code_challenge: challenge, code_challenge_method: "S256", scope: "ledger:read ledger:draft",
  };
  const merged = { ...base, ...overrides };
  return new URLSearchParams(Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== null));
}

describe("grantableScopes", () => {
  it("drops habitual OIDC words and keeps registered ledger scopes", () => {
    expect(grantableScopes("openid offline_access ledger:read", client.scopes)).toEqual(["ledger:read"]);
  });
  it("grants everything the client is registered for when nothing is asked", () => {
    expect(grantableScopes("", ["ledger:draft"])).toEqual(["ledger:draft"]);
  });
  it("refuses a scope the client is not registered for", () => {
    expect(grantableScopes("ledger:read ledger:draft", ["ledger:draft"])).toBeNull();
    expect(grantableScopes("ledger:write", client.scopes)).toBeNull();
  });
});

describe("PKCE and secrets", () => {
  it("accepts the matching S256 verifier only", () => {
    expect(pkceMatches(verifier, challenge)).toBe(true);
    expect(pkceMatches("b".repeat(50), challenge)).toBe(false);
    expect(pkceMatches("short", challenge)).toBe(false);
  });
  it("compares secrets by hash", () => {
    expect(secretMatches("s3cret", hashSecret("s3cret"))).toBe(true);
    expect(secretMatches("s3cret!", hashSecret("s3cret"))).toBe(false);
    expect(secretMatches("s3cret", "not-hex")).toBe(false);
  });
});

describe("checkAuthorizeRequest", () => {
  it("accepts a complete request and defaults the resource to the MCP endpoint", () => {
    const result = checkAuthorizeRequest(params(), client, origin);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request).toMatchObject({ resource: `${origin}/api/mcp`, scopes: ["ledger:read", "ledger:draft"], state: "s1" });
  });

  it("never redirects to an unregistered address", () => {
    const result = checkAuthorizeRequest(params({ redirect_uri: "https://evil.example/cb" }), client, origin);
    expect(result).toMatchObject({ ok: false, redirect: null });
    expect(checkAuthorizeRequest(params(), null, origin)).toMatchObject({ ok: false, redirect: null });
    expect(checkAuthorizeRequest(params(), { ...client, disabled: true }, origin)).toMatchObject({ ok: false, redirect: null });
  });

  it("sends errors after a trusted redirect back to the client with state", () => {
    const result = checkAuthorizeRequest(params({ code_challenge_method: "plain" }), client, origin);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const url = new URL(result.redirect!);
      expect(url.origin + url.pathname).toBe(client.redirectUris[0]);
      expect(url.searchParams.get("error")).toBe("invalid_request");
      expect(url.searchParams.get("state")).toBe("s1");
    }
  });

  it("requires PKCE, the code flow, a known resource and an allowed scope", () => {
    expect(checkAuthorizeRequest(params({ code_challenge: null }), client, origin).ok).toBe(false);
    expect(checkAuthorizeRequest(params({ response_type: "token" }), client, origin).ok).toBe(false);
    expect(checkAuthorizeRequest(params({ resource: "https://other.example/mcp" }), client, origin).ok).toBe(false);
    expect(checkAuthorizeRequest(params({ scope: "ledger:write" }), client, origin).ok).toBe(false);
  });
});

describe("clientCredentials", () => {
  it("reads HTTP Basic and form credentials", () => {
    const basic = `Basic ${Buffer.from("syr_client_muse:p%40ss").toString("base64")}`;
    expect(clientCredentials(basic, new URLSearchParams())).toEqual({ clientId: "syr_client_muse", clientSecret: "p@ss" });
    expect(clientCredentials(null, new URLSearchParams({ client_id: "a", client_secret: "b" }))).toEqual({ clientId: "a", clientSecret: "b" });
    expect(clientCredentials(null, new URLSearchParams({ client_id: "a" }))).toBeNull();
  });
});
