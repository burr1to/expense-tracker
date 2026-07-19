import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getBetaSession } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getBetaSession(await headers());
  if (!session) return NextResponse.json({ error: "Beta access required." }, { status: 403 });
  return NextResponse.json({ user: session.user });
}
