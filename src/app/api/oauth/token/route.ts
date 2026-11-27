import { NextResponse } from "next/server";
import { clientCredentials } from "../../../../lib/agent-oauth";
import { authenticateClient, exchangeCode, OAuthError, refreshTokens } from "../../../../lib/agent-oauth-store";
import { getPrisma } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

function oauthError(error: string, description: string, status: number) {
  const headers: Record<string, string> = { ...noStore };
  if (status === 401) headers["WWW-Authenticate"] = 'Basic realm="SaveYoRupee"';
  return NextResponse.json({ error, error_description: description }, { status, headers });
}

async function readForm(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const json = await request.json().catch(() => null) as Record<string, unknown> | null;
    return new URLSearchParams(Object.entries(json ?? {}).filter(([, value]) => typeof value === "string") as [string, string][]);
  }
  return new URLSearchParams(await request.text());
}

export async function POST(request: Request) {
  try {
    const body = await readForm(request);
    const db = getPrisma();
    const client = await authenticateClient(db, clientCredentials(request.headers.get("authorization"), body));
    const grantType = body.get("grant_type");
    if (grantType === "authorization_code") {
      const code = body.get("code"); const redirectUri = body.get("redirect_uri"); const codeVerifier = body.get("code_verifier");
      if (!code || !redirectUri || !codeVerifier) return oauthError("invalid_request", "code, redirect_uri and code_verifier are required.", 400);
      return NextResponse.json(await exchangeCode(db, client.id, { code, redirectUri, codeVerifier, resource: body.get("resource") }), { headers: noStore });
    }
    if (grantType === "refresh_token") {
      const refreshToken = body.get("refresh_token");
      if (!refreshToken) return oauthError("invalid_request", "refresh_token is required.", 400);
      return NextResponse.json(await refreshTokens(db, client.id, { refreshToken, scope: body.get("scope") }), { headers: noStore });
    }
    return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.", 400);
  } catch (error) {
    if (error instanceof OAuthError) return oauthError(error.code, error.message, error.status);
    console.error("OAuth token request failed.", error);
    return oauthError("server_error", "The token could not be issued. Try again.", 500);
  }
}
