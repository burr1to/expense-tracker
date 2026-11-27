import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "../../../../lib/auth";
import { getPrisma } from "../../../../lib/prisma";
import { verifyPin } from "../../../../lib/pin";
import { describeDevice } from "../../../../lib/activity-log";
import { pinPausedMessage, pinRetryAfterSeconds, recordPinFailure } from "../../../../lib/pin-attempts";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getAuthenticatedSession(await headers());
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z.object({ pin: z.string().regex(/^\d{4,6}$/) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a 4 to 6 digit PIN." }, { status: 400 });
  const retryAfter = await pinRetryAfterSeconds(session.user.id);
  if (retryAfter) return NextResponse.json({ error: pinPausedMessage(retryAfter) }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  const user = await getPrisma().user.findUnique({ where: { id: session.user.id }, select: { pinHash: true } });
  if (!user?.pinHash) return NextResponse.json({ error: "Set up a PIN in Settings before locking your ledger." }, { status: 409 });
  if (!await verifyPin(parsed.data.pin, user.pinHash)) {
    await recordPinFailure(session.user.id, "Wrong PIN entered at the lock screen", describeDevice(request.headers.get("user-agent")));
    return NextResponse.json({ error: "That PIN did not match." }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
