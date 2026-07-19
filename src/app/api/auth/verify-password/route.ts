import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, getBetaSession } from "../../../../lib/auth";

export async function POST(request: Request) {
  const { password } = z.object({ password: z.string().min(1).max(128) }).parse(await request.json());
  try {
    if (!await getBetaSession(await headers())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await auth.api.verifyPassword({ body: { password }, headers: await headers() });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Password did not match." }, { status: 401 });
  }
}
