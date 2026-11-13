import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { purgeExpiredActivity } from "../../../lib/activity-recorder";
import { getAuthenticatedSession } from "../../../lib/auth";
import { runLedgerAction } from "../../../lib/ledger-actions";
import { loadLedger, purgeExpiredDeletedTransactions, serialize } from "../../../lib/ledger-snapshot";

export const dynamic = "force-dynamic";

async function userId() {
  const session = await getAuthenticatedSession(await headers());
  return session?.user.id ?? null;
}

export async function GET() {
  const id = await userId();
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [ledger] = await Promise.all([
    loadLedger(id),
    purgeExpiredDeletedTransactions(id).catch((error) => console.warn("Could not purge expired deleted transactions.", error)),
    purgeExpiredActivity(id).catch((error) => console.warn("Could not purge expired activity.", error)),
  ]);
  return NextResponse.json(serialize(ledger));
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const id = await userId();
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return runLedgerAction(id, await request.json().catch(() => null), { origin: new URL(request.url).origin });
}
