import { NextResponse } from "next/server";
import { appOrigin, authorizationServerMetadata } from "../../../lib/agent-oauth";

export const dynamic = "force-dynamic";

/** RFC 8414 metadata, so an MCP client such as Muse can find the authorize and token endpoints. */
export function GET(request: Request) {
  return NextResponse.json(authorizationServerMetadata(appOrigin(request)), { headers: { "Cache-Control": "public, max-age=300" } });
}
