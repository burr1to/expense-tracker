import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AGENT_SCOPES, appOrigin, checkAuthorizeRequest, errorRedirect, successRedirect } from "../../../../lib/agent-oauth";
import { approveAuthorization, findClient } from "../../../../lib/agent-oauth-store";
import { recordActivitySafely } from "../../../../lib/activity-recorder";
import { getAuthenticatedSession } from "../../../../lib/auth";
import { getPrisma } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" };

async function check(request: Request, query: string) {
  const params = new URLSearchParams(query);
  const client = await findClient(getPrisma(), params.get("client_id") ?? "");
  return checkAuthorizeRequest(params, client, appOrigin(request));
}

/** What the consent page shows: which app is asking and for what. Nothing is granted here. */
export async function GET(request: Request) {
  const session = await getAuthenticatedSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  const result = await check(request, new URL(request.url).search);
  if (!result.ok) return NextResponse.json({ error: result.message, redirect: result.redirect }, { status: 400, headers: noStore });
  const { client, scopes } = result.request;
  return NextResponse.json({
    client: { name: client.name },
    scopes: scopes.map((scope) => ({ id: scope, label: AGENT_SCOPES[scope] })),
    account: session.user.email,
  }, { headers: noStore });
}

const decisionSchema = z.object({ query: z.string().max(4_000), decision: z.enum(["approve", "deny"]) });

/** The user's answer on the consent page. Approval issues a one-time code; either way the browser goes back to the app. */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStore });
  const session = await getAuthenticatedSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: noStore });
  const result = await check(request, parsed.data.query);
  if (!result.ok) return NextResponse.json({ error: result.message, redirect: result.redirect }, { status: 400, headers: noStore });
  const { client, redirectUri, state, scopes } = result.request;
  if (parsed.data.decision === "deny") {
    return NextResponse.json({ redirect: errorRedirect(redirectUri, "access_denied", "The user declined.", state) }, { headers: noStore });
  }
  const code = await approveAuthorization(getPrisma(), session.user.id, result.request);
  await recordActivitySafely(session.user.id, { action: "agent.connected", area: "security", title: `Connected ${client.name}`, subject: scopes.map((scope) => AGENT_SCOPES[scope]).join("; ") });
  return NextResponse.json({ redirect: successRedirect(redirectUri, code, state, appOrigin(request)) }, { headers: noStore });
}
