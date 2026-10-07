import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "../../../../lib/auth";
import { getPrisma } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

/** When this person last downloaded a full backup, from the log the download writes (kept for 90 days). */
export async function GET() {
  const session = await getAuthenticatedSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const latest = await getPrisma().activityLog.findFirst({
      where: { userId: session.user.id, area: "data", action: "backup.downloaded" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    return NextResponse.json({ lastBackupAt: latest?.createdAt.toISOString() ?? null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Could not read the last backup time.", error);
    return NextResponse.json({ error: "Could not check your last backup." }, { status: 500 });
  }
}
