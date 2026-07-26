import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getBetaSession } from "../../../../lib/auth";
import { CATEGORIES, SUBCATEGORIES } from "../../../../lib/categories";
import { getPrisma } from "../../../../lib/prisma";
import {
  GEMINI_RECEIPT_MODEL,
  interactionOutputText,
  normalizeReceiptAnalysis,
  receiptAnalysisApiRequestSchema,
  receiptAnalysisJsonSchema,
  receiptAnalysisPrompt,
  type ReceiptAnalysisCategory,
} from "../../../../lib/receipt-analysis";
import { ensureReceiptsBucket, getSupabaseStorageAdmin, RECEIPTS_BUCKET, verifyStoredReceipt } from "../../../../lib/receipt-storage";
import type { CurrencyCode } from "../../../../types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const attempts = new Map<string, number[]>();

class AnalysisError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function checkRateLimit(userId: string) {
  const now = Date.now();
  const recent = (attempts.get(userId) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 8) throw new AnalysisError("Too many receipt scans. Wait a minute and try again.", 429);
  recent.push(now);
  attempts.set(userId, recent);
}

function interactionRequest(prompt: string, image: Buffer, mimeType: string, categoryIds: string[]) {
  return {
    model: GEMINI_RECEIPT_MODEL,
    store: false,
    input: [
      { type: "text", text: prompt },
      { type: "image", data: image.toString("base64"), mime_type: mimeType },
    ],
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: receiptAnalysisJsonSchema(categoryIds),
    },
    generation_config: { max_output_tokens: 4096 },
  };
}

async function receiptBytes(path: string) {
  await ensureReceiptsBucket();
  const { data, error } = await getSupabaseStorageAdmin().storage.from(RECEIPTS_BUCKET).download(path);
  if (error || !data) throw new AnalysisError("The receipt image could not be opened.", 404);
  return Buffer.from(await data.arrayBuffer());
}

function errorResponse(error: unknown) {
  if (error instanceof AnalysisError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "The receipt analysis was invalid." }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({ error: "The receipt could not be analyzed. Try a clearer photo." }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getBetaSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw new AnalysisError("Receipt scanning is not configured yet.", 503);
    checkRateLimit(session.user.id);
    const input = receiptAnalysisApiRequestSchema.parse(await request.json());
    await verifyStoredReceipt(input.receipt.storagePath, session.user.id, input.receipt.mimeType, input.receipt.size);

    const db = getPrisma();
    const [user, customCategories] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { currency: true } }),
      db.customCategory.findMany({ where: { userId: session.user.id }, select: { id: true, name: true, kind: true } }),
    ]);
    const categories: ReceiptAnalysisCategory[] = [
      ...CATEGORIES.filter((category) => category.kind === "expense" || category.kind === "both").map((category) => ({
        id: category.id,
        label: category.label,
        subcategories: [...(SUBCATEGORIES[category.id]?.options ?? [])],
      })),
      ...customCategories.filter((category) => category.kind === "expense" || category.kind === "both").map((category) => ({
        id: category.id,
        label: category.name,
        subcategories: [],
      })),
    ];
    const internalInput = {
      ...input,
      currency: user.currency as CurrencyCode,
      categories,
    };
    const image = await receiptBytes(input.receipt.storagePath);
    const response = await fetch(GEMINI_INTERACTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(interactionRequest(receiptAnalysisPrompt(internalInput), image, input.receipt.mimeType, categories.map((category) => category.id))),
      signal: AbortSignal.timeout(35_000),
    });
    if (response.status === 429) throw new AnalysisError("Gemini’s free limit is busy. Wait a moment and try again.", 429);
    if (!response.ok) throw new AnalysisError("Gemini could not read this receipt.", 502);
    const output = interactionOutputText(await response.json());
    let raw: unknown;
    try {
      raw = JSON.parse(output);
    } catch {
      throw new AnalysisError("Gemini returned an unreadable result.", 422);
    }
    const analysis = normalizeReceiptAnalysis(raw, internalInput);
    return NextResponse.json({ analysis }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") return NextResponse.json({ error: "Receipt analysis timed out. Try again." }, { status: 504, headers: { "Cache-Control": "private, no-store" } });
    return errorResponse(error);
  }
}
