import { NextResponse } from "next/server";
import { appOrigin, protectedResourceMetadata } from "../../../../lib/agent-oauth";

export const dynamic = "force-dynamic";

/** RFC 9728 metadata for the MCP endpoint, served at both the bare path and the path-suffixed form (`…/api/mcp`). */
export function GET(request: Request) {
  return NextResponse.json(protectedResourceMetadata(appOrigin(request)), { headers: { "Cache-Control": "public, max-age=300" } });
}
