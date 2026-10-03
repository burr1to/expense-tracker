import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { isActivityArea } from "../../../lib/activity-log";
import { loadActivityPage, purgeExpiredActivity } from "../../../lib/activity-recorder";
import { getAuthenticatedSession } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getAuthenticatedSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const area = params.get("area");
  if (area && !isActivityArea(area)) return NextResponse.json({ error: "Unknown log area." }, { status: 400 });
  const cursor = params.get("cursor");
  if (!cursor) await purgeExpiredActivity(session.user.id).catch((error) => console.warn("Could not purge expired activity.", error));
  const page = await loadActivityPage(session.user.id, { area: area && isActivityArea(area) ? area : null, cursor });
  return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
}
