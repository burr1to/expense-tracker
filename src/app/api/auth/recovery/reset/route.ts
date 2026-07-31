import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "../../../../../lib/auth";

export const runtime = "nodejs";

const resetSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = resetSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a password with 8 to 128 characters." }, { status: 400 });
  try {
    await auth.api.resetPassword({ body: parsed.data, headers: await headers() });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "This recovery session is invalid or expired." }, { status: 401 });
  }
}
