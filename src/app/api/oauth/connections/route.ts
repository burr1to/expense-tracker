import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { listConnections, revokeConnection } from "../../../../lib/agent-oauth-store";
import { recordActivitySafely } from "../../../../lib/activity-recorder";
import { getAuthenticatedSession } from "../../../../lib/auth";
import { getPrisma } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" };

/** Apps the user has connected, for Settings. */
export async function GET() {
  const session = await getAuthenticatedSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  return NextResponse.json({ connections: await listConnections(getPrisma(), session.user.id) }, { headers: noStore });
}

const revokeSchema = z.object({ id: z.string().min(1).max(64) });

/** Disconnects an app: its approval and every token it holds stop working at once. */
export async function DELETE(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStore });
  const session = await getAuthenticatedSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  const parsed = revokeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: noStore });
  const name = await revokeConnection(getPrisma(), session.user.id, parsed.data.id);
  if (!name) return NextResponse.json({ error: "That app is already disconnected." }, { status: 404, headers: noStore });
  await recordActivitySafely(session.user.id, { action: "agent.disconnected", area: "security", title: `Disconnected ${name}` });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
