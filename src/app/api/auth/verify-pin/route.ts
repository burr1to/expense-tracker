import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "../../../../lib/auth";
import { getPrisma } from "../../../../lib/prisma";
import { verifyPin } from "../../../../lib/pin";

const attempts = new Map<string, { failures: number; blockedUntil: number }>();
const MAX_FAILURES = 5;
const BLOCK_MS = 30_000;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const state = attempts.get(session.user.id);
  if (state && state.blockedUntil > Date.now()) {
    const retryAfter = Math.ceil((state.blockedUntil - Date.now()) / 1000);
    return NextResponse.json({ error: `Too many attempts. Try again in ${retryAfter} seconds.` }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }
  try {
    const { pin } = z.object({ pin: z.string().regex(/^\d{4,6}$/) }).parse(await request.json());
    const user = await getPrisma().user.findUnique({ where: { id: session.user.id }, select: { pinHash: true } });
    if (!user?.pinHash) return NextResponse.json({ error: "Set up a PIN in Settings before locking your ledger." }, { status: 409 });
    if (!await verifyPin(pin, user.pinHash)) {
      const failures = (state?.failures ?? 0) + 1;
      attempts.set(session.user.id, { failures, blockedUntil: failures >= MAX_FAILURES ? Date.now() + BLOCK_MS : 0 });
      return NextResponse.json({ error: "That PIN did not match." }, { status: 401 });
    }
    attempts.delete(session.user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Enter a 4 to 6 digit PIN." }, { status: 400 });
  }
}
