import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "../../../../lib/auth";
import { CATEGORIES, SUBCATEGORIES } from "../../../../lib/categories";
import { getPrisma } from "../../../../lib/prisma";
import { type LearningCategory } from "../../../../lib/learning";
import { GEMINI_RECEIPT_MODEL, interactionOutputText } from "../../../../lib/receipt-analysis";
import { normalizeStatementAnalysis, statementAnalysisRequestSchema, statementJsonSchema, statementPrompt } from "../../../../lib/statement-analysis";
import type { CurrencyCode } from "../../../../types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const attempts = new Map<string, number[]>();

class StatementError extends Error { constructor(message: string, readonly status: number) { super(message); } }
function checkRateLimit(userId: string) {
  const now = Date.now(); const recent = (attempts.get(userId) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 5) throw new StatementError("Too many statement analyses. Wait a minute and try again.", 429);
  recent.push(now); attempts.set(userId, recent);
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getAuthenticatedSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw new StatementError("Gemini statement importing is not configured yet.", 503);
    checkRateLimit(session.user.id);
    const input = statementAnalysisRequestSchema.parse(await request.json());
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
    const prompt = statementPrompt(input.name, user.currency as CurrencyCode, categories);
    const response = await fetch(GEMINI_INTERACTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model: GEMINI_RECEIPT_MODEL,
        store: false,
        input: [
          { type: "text", text: `${prompt}${input.text ? `\n\nStatement text:\n${input.text}` : ""}` },
          ...(input.images ?? []).map((image) => ({ type: "image", data: image.data, mime_type: image.mimeType })),
        ],
        response_format: { type: "text", mime_type: "application/json", schema: statementJsonSchema(categories.map((category) => category.id)) },
        generation_config: { max_output_tokens: 12_000 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status === 429) throw new StatementError("Gemini’s free limit is busy. Wait a moment and try again.", 429);
    if (!response.ok) throw new StatementError("Gemini could not read this statement.", 502);
    const output = interactionOutputText(await response.json());
    let raw: unknown;
    try { raw = JSON.parse(output); } catch { throw new StatementError("Gemini returned an unreadable statement result.", 422); }
    const analysis = normalizeStatementAnalysis(raw, user.currency as CurrencyCode, categories);
    if (!analysis.rows.length) throw new StatementError("No importable statement transactions were found.", 422);
    return NextResponse.json({ analysis }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StatementError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    if (error instanceof Error && error.name === "TimeoutError") return NextResponse.json({ error: "Statement analysis timed out. Try a smaller file." }, { status: 504, headers: { "Cache-Control": "private, no-store" } });
    const message = error instanceof z.ZodError ? error.issues[0]?.message : "The statement could not be analyzed.";
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
