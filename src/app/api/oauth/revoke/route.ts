import { NextResponse } from "next/server";
import { clientCredentials } from "../../../../lib/agent-oauth";
import { authenticateClient, OAuthError, revokeToken } from "../../../../lib/agent-oauth-store";
import { getPrisma } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** RFC 7009 token revocation, for the client to disconnect itself. */
export async function POST(request: Request) {
  try {
    const body = new URLSearchParams(await request.text());
    const db = getPrisma();
    const client = await authenticateClient(db, clientCredentials(request.headers.get("authorization"), body));
    const token = body.get("token");
    if (token) await revokeToken(db, client.id, token);
    return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OAuthError) return NextResponse.json({ error: error.code, error_description: error.message }, { status: error.status });
    console.error("OAuth revocation failed.", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
