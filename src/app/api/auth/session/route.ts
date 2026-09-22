import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAuthenticatedSession(await headers());
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ user: session.user });
}
