import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getBetaSession } from "../../../../../lib/auth";
import { normalizeRecoveryAnswer, normalizeRecoveryCode, RECOVERY_QUESTION_OPTIONS } from "../../../../../lib/recovery";
import { hashRecoverySecret } from "../../../../../lib/recovery-crypto";
import { getPrisma } from "../../../../../lib/prisma";

export const runtime = "nodejs";

const questionKeys = RECOVERY_QUESTION_OPTIONS.map((option) => option.value) as [string, ...string[]];
const setupSchema = z.object({
  questionOne: z.enum(questionKeys),
  answerOne: z.string().trim().min(2).max(128),
  questionTwo: z.enum(questionKeys),
  answerTwo: z.string().trim().min(2).max(128),
  recoveryCode: z.string().trim().min(16).max(64),
});

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getBetaSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = setupSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid recovery details." }, { status: 400 });
  if (parsed.data.questionOne === parsed.data.questionTwo) return NextResponse.json({ error: "Choose two different security questions." }, { status: 400 });

  const [questionOneHash, questionTwoHash, recoveryCodeHash] = await Promise.all([
    hashRecoverySecret(normalizeRecoveryAnswer(parsed.data.answerOne)),
    hashRecoverySecret(normalizeRecoveryAnswer(parsed.data.answerTwo)),
    hashRecoverySecret(normalizeRecoveryCode(parsed.data.recoveryCode)),
  ]);
  await getPrisma().accountRecovery.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      questionOneKey: parsed.data.questionOne,
      questionOneHash,
      questionTwoKey: parsed.data.questionTwo,
      questionTwoHash,
      recoveryCodeHash,
    },
    update: {
      questionOneKey: parsed.data.questionOne,
      questionOneHash,
      questionTwoKey: parsed.data.questionTwo,
      questionTwoHash,
      recoveryCodeHash,
      failedAttempts: 0,
      lockedUntil: null,
    },
  });
  return NextResponse.json({ ok: true });
}
