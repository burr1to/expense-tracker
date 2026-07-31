import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getBetaSession } from "../../../../../lib/auth";
import { getPrisma } from "../../../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getBetaSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const recovery = await getPrisma().accountRecovery.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  return NextResponse.json({ configured: Boolean(recovery) });
}
