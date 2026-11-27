import { NextResponse } from "next/server";
import { appOrigin, mcpResource, protectedResourceMetadataUrl } from "../../../lib/agent-oauth";
import { authenticateAccessToken } from "../../../lib/agent-oauth-store";
import { ledgerTools } from "../../../lib/agent-tools";
import { handleMessage, InsufficientScopeError, parseMessage } from "../../../lib/mcp-protocol";
import { getPrisma } from "../../../lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

function unauthorized(origin: string, description: string) {
  return NextResponse.json({ error: "invalid_token", error_description: description }, {
    status: 401,
    headers: { ...noStore, "WWW-Authenticate": `Bearer resource_metadata="${protectedResourceMetadataUrl(origin)}", error="invalid_token", error_description="${description}"` },
  });
}

/** The MCP endpoint (Streamable HTTP, stateless). Only OAuth access tokens issued for this resource are accepted; cookies never are. */
export async function POST(request: Request) {
  const origin = appOrigin(request);
  // MCP requires rejecting browser requests from other sites (DNS rebinding). Server-side clients send no Origin.
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== origin && requestOrigin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStore });
  }
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorization.trim());
  if (!match) return unauthorized(origin, "A bearer token is required.");
  const db = getPrisma();
  const principal = await authenticateAccessToken(db, match[1], mcpResource(origin));
  if (!principal) return unauthorized(origin, "The access token is invalid or expired.");

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, { status: 400, headers: noStore }); }
  const parsed = parseMessage(body);
  if (!parsed.ok) return NextResponse.json(parsed.response, { status: 400, headers: noStore });

  try {
    const response = await handleMessage(parsed.message, ledgerTools(db, principal, origin), principal.scopes);
    if (!response) return new NextResponse(null, { status: 202, headers: noStore });
    return NextResponse.json(response, { headers: noStore });
  } catch (error) {
    if (error instanceof InsufficientScopeError) {
      return NextResponse.json({ error: "insufficient_scope", error_description: error.message }, {
        status: 403,
        headers: { ...noStore, "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${error.scope}", resource_metadata="${protectedResourceMetadataUrl(origin)}"` },
      });
    }
    console.error("MCP request failed.", error);
    return NextResponse.json({ jsonrpc: "2.0", id: parsed.message.id ?? null, error: { code: -32603, message: "The ledger could not answer. Try again." } }, { status: 500, headers: noStore });
  }
}

/** No server-initiated stream: this server only answers requests. */
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
