import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "../../../../lib/auth";
import { CATEGORIES, SUBCATEGORIES } from "../../../../lib/categories";
import { getPrisma } from "../../../../lib/prisma";
import { type LearningCategory } from "../../../../lib/learning";
import { todayInAppZone } from "../../../../lib/period";
import { GEMINI_RECEIPT_MODEL, interactionOutputText } from "../../../../lib/receipt-analysis";
import { normalizeSmsAnalysis, smsAnalysisRequestSchema, smsJsonSchema, smsPrompt } from "../../../../lib/sms-analysis";
import type { CurrencyCode } from "../../../../types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const attempts = new Map<string, number[]>();

class SmsError extends Error { constructor(message: string, readonly status: number) { super(message); } }

function checkRateLimit(userId: string) {
  const now = Date.now(); const recent = (attempts.get(userId) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 10) throw new SmsError("Too many message reads. Wait a minute and try again.", 429);
  recent.push(now); attempts.set(userId, recent);
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getAuthenticatedSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw new SmsError("Reading unrecognised messages needs Gemini, which is not configured yet.", 503);
    checkRateLimit(session.user.id);
    const input = smsAnalysisRequestSchema.parse(await request.json());
    const db = getPrisma();
    const [user, customCategories, customSubcategories] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { currency: true } }),
      db.customCategory.findMany({ where: { userId: session.user.id }, select: { id: true, name: true } }),
      db.customSubcategory.findMany({ where: { userId: session.user.id }, select: { categoryId: true, name: true } }),
    ]);
    const categories: LearningCategory[] = [
      ...CATEGORIES.map((category) => ({ id: category.id, label: category.label, subcategories: [...(SUBCATEGORIES[category.id]?.options ?? []), ...customSubcategories.filter((item) => item.categoryId === category.id).map((item) => item.name)] })),
      ...customCategories.map((category) => ({ id: category.id, label: category.name, subcategories: customSubcategories.filter((item) => item.categoryId === category.id).map((item) => item.name) })),
    ];
    const today = todayInAppZone();
    const prompt = smsPrompt(user.currency as CurrencyCode, categories, today);
    const response = await fetch(GEMINI_INTERACTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model: GEMINI_RECEIPT_MODEL,
        store: false,
        input: [{ type: "text", text: `${prompt}\n\nMessage:\n${input.text}` }],
        response_format: { type: "text", mime_type: "application/json", schema: smsJsonSchema(categories.map((category) => category.id)) },
        generation_config: { max_output_tokens: 1_000 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429) throw new SmsError("Gemini’s free limit is busy. Wait a moment and try again.", 429);
    if (!response.ok) throw new SmsError("Gemini could not read this message.", 502);
    const output = interactionOutputText(await response.json());
    let raw: unknown;
    try { raw = JSON.parse(output); } catch { throw new SmsError("Gemini returned an unreadable result.", 422); }
    const analysis = normalizeSmsAnalysis(raw, user.currency as CurrencyCode, categories, today);
    return NextResponse.json({ analysis }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SmsError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    if (error instanceof Error && error.name === "TimeoutError") return NextResponse.json({ error: "Reading this message timed out. Try again." }, { status: 504, headers: { "Cache-Control": "private, no-store" } });
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "This message could not be read.";
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
