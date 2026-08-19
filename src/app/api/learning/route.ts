import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "../../../generated/prisma/client";
import { getBetaSession } from "../../../lib/auth";
import { CATEGORIES, SUBCATEGORIES } from "../../../lib/categories";
import { getPrisma } from "../../../lib/prisma";
import { GEMINI_RECEIPT_MODEL, interactionOutputText } from "../../../lib/receipt-analysis";
import { aggregateLearningTransactions, LEARNING_BATCH_SIZE, learningJsonSchema, learningPrompt, normalizeLearningOutput, type LearningCategory } from "../../../lib/learning";
import type { LearningState, LearningSuggestion, LedgerTransaction } from "../../../types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const attempts = new Map<string, number[]>();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setEnabled"), enabled: z.boolean() }),
  z.object({ action: z.literal("run") }),
  z.object({ action: z.literal("reset") }),
]);

class LearningError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function checkRateLimit(userId: string) {
  const now = Date.now();
  const recent = (attempts.get(userId) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 3) throw new LearningError("Wait a minute before running personalization again.", 429);
  recent.push(now);
  attempts.set(userId, recent);
}

function serialize(profile: { enabled: boolean; suggestions: unknown; summary: string[]; lastTransactionId: string | null; lastRunAt: Date | null } | null): LearningState {
  const suggestions = z.array(z.unknown()).safeParse(profile?.suggestions);
  return {
    enabled: profile?.enabled ?? false,
    suggestions: suggestions.success ? profile!.suggestions as LearningSuggestion[] : [],
    summary: profile?.summary ?? [],
    lastTransactionId: profile?.lastTransactionId ?? null,
    lastRunAt: profile?.lastRunAt?.toISOString() ?? null,
  };
}

async function sessionUserId() {
  const session = await getBetaSession(await headers());
  return session?.user.id ?? null;
}

export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = await getPrisma().learningProfile.findUnique({ where: { userId } });
  return NextResponse.json({ learning: serialize(profile) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const input = actionSchema.parse(await request.json());
    const db = getPrisma();
    if (input.action === "reset") {
      await db.learningProfile.deleteMany({ where: { userId } });
      return NextResponse.json({ learning: serialize(null) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (input.action === "setEnabled") {
      const profile = await db.learningProfile.upsert({ where: { userId }, update: { enabled: input.enabled }, create: { userId, enabled: input.enabled } });
      return NextResponse.json({ learning: serialize(profile) }, { headers: { "Cache-Control": "private, no-store" } });
    }

    checkRateLimit(userId);
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw new LearningError("Gemini personalization is not configured yet.", 503);
    const existing = await db.learningProfile.upsert({ where: { userId }, update: {}, create: { userId } });
    const cursor = existing.lastCreatedAt && existing.lastTransactionId ? {
      createdAt: existing.lastCreatedAt, id: existing.lastTransactionId,
    } : null;
    const transactions = await db.transaction.findMany({
      where: {
        userId, deletedAt: null,
        ...(cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: LEARNING_BATCH_SIZE,
      select: { id: true, kind: true, category: true, subcategory: true, area: true, locationLabel: true, paymentMode: true, occurredOn: true, createdAt: true },
    });
    if (!transactions.length) return NextResponse.json({ learning: serialize(existing), processed: 0 }, { headers: { "Cache-Control": "private, no-store" } });

    const [customCategories, customSubcategories] = await Promise.all([
      db.customCategory.findMany({ where: { userId }, select: { id: true, name: true, kind: true } }),
      db.customSubcategory.findMany({ where: { userId }, select: { categoryId: true, name: true } }),
    ]);
    const categories: LearningCategory[] = [
      ...CATEGORIES.map((category) => ({ id: category.id, label: category.label, subcategories: [...(SUBCATEGORIES[category.id]?.options ?? []), ...customSubcategories.filter((item) => item.categoryId === category.id).map((item) => item.name)] })),
      ...customCategories.map((category) => ({ id: category.id, label: category.name, subcategories: customSubcategories.filter((item) => item.categoryId === category.id).map((item) => item.name) })),
    ];
    const aggregates = aggregateLearningTransactions(transactions.map((transaction) => ({
      ...transaction,
      kind: transaction.kind as LedgerTransaction["kind"],
      paymentMode: transaction.paymentMode as LedgerTransaction["paymentMode"],
    })));
    const latest = transactions.at(-1)!;
    let normalized = { suggestions: existing.suggestions as unknown as LearningSuggestion[], summary: existing.summary };
    if (aggregates.length) {
      const prompt = learningPrompt(categories, normalized.suggestions, aggregates);
      const response = await fetch(GEMINI_INTERACTIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          model: GEMINI_RECEIPT_MODEL, store: false, input: [{ type: "text", text: prompt }],
          response_format: { type: "text", mime_type: "application/json", schema: learningJsonSchema(categories.map((category) => category.id)) },
          generation_config: { max_output_tokens: 4096 },
        }),
        signal: AbortSignal.timeout(35_000),
      });
      if (response.status === 429) throw new LearningError("Gemini’s free limit is busy. Wait a moment and try again.", 429);
      if (!response.ok) throw new LearningError("Gemini could not build the personalization profile.", 502);
      const output = interactionOutputText(await response.json());
      try { normalized = normalizeLearningOutput(JSON.parse(output), categories); }
      catch { throw new LearningError("Gemini returned an invalid personalization profile.", 422); }
    }

    const updated = await db.learningProfile.updateMany({
      where: { userId, lastTransactionId: existing.lastTransactionId },
      data: {
        suggestions: normalized.suggestions as unknown as Prisma.InputJsonValue,
        summary: normalized.summary,
        lastCreatedAt: latest.createdAt,
        lastTransactionId: latest.id,
        lastRunAt: new Date(),
      },
    });
    if (!updated.count) throw new LearningError("Personalization changed in another session. Run it again.", 409);
    const profile = await db.learningProfile.findUniqueOrThrow({ where: { userId } });
    return NextResponse.json({ learning: serialize(profile), processed: transactions.length }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof LearningError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    if (error instanceof Error && error.name === "TimeoutError") return NextResponse.json({ error: "Personalization timed out. Try again." }, { status: 504, headers: { "Cache-Control": "private, no-store" } });
    const message = error instanceof z.ZodError ? error.issues[0]?.message : "Could not update personalization.";
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
