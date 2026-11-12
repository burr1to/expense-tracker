import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordActivitySafely } from "../../../lib/activity-recorder";
import { getAuthenticatedSession } from "../../../lib/auth";
import { getPrisma } from "../../../lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" };
/** Unreviewed messages older than this are dropped: a month-old alert is better re-entered by hand. */
const DRAFT_RETENTION_DAYS = 30;

/** Messages agents such as Muse sent for review. Reading the inbox also clears expired ones. */
export async function GET() {
  const session = await getAuthenticatedSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  const db = getPrisma();
  const userId = session.user.id;
  const cutoff = new Date(Date.now() - DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await db.agentDraft.deleteMany({ where: { userId, createdAt: { lt: cutoff } } });
  const drafts = await db.agentDraft.findMany({
    where: { userId, status: "pending" },
    orderBy: { receivedAt: "desc" },
    take: 100,
    select: { id: true, source: true, text: true, sourceApp: true, receivedAt: true, grant: { select: { client: { select: { name: true } } } } },
  });
  return NextResponse.json({
    drafts: drafts.map((draft) => ({ id: draft.id, source: draft.source, text: draft.text, sourceApp: draft.sourceApp, receivedAt: draft.receivedAt.toISOString(), agent: draft.grant?.client.name ?? "An app" })),
  }, { headers: noStore });
}

const resolveSchema = z.object({
  id: z.string().min(1).max(64),
  outcome: z.enum(["saved", "dismissed"]),
  transactionId: z.string().min(1).max(64).nullable().optional(),
});

/**
 * Marks a message reviewed. "saved" only records that the user's own review saved it (through the
 * normal ledger save); this route never writes to the ledger. The message text is cleared either way.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStore });
  const session = await getAuthenticatedSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  const parsed = resolveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: noStore });
  const db = getPrisma();
  const userId = session.user.id;
  const { id, outcome } = parsed.data;
  let transactionId: string | null = null;
  if (outcome === "saved" && parsed.data.transactionId) {
    const owned = await db.transaction.findFirst({ where: { id: parsed.data.transactionId, userId }, select: { id: true } });
    transactionId = owned?.id ?? null;
  }
  const updated = await db.agentDraft.updateMany({
    where: { id, userId, status: "pending" },
    data: { status: outcome === "saved" ? "approved" : "dismissed", transactionId, resolvedAt: new Date(), text: "" },
  });
  if (updated.count === 0) return NextResponse.json({ error: "This message was already reviewed." }, { status: 409, headers: noStore });
  if (outcome === "dismissed") await recordActivitySafely(userId, { action: "agent_draft.dismissed", area: "transactions", entityId: id, title: "Dismissed a message sent for review" });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
