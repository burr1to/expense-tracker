import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasBetaAccess } from "../../../../../lib/beta-access";
import { getPrisma } from "../../../../../lib/prisma";
import { normalizeRecoveryAnswer, normalizeRecoveryCode, RECOVERY_QUESTION_OPTIONS } from "../../../../../lib/recovery";
import { hashRecoverySecret, verifyRecoverySecret } from "../../../../../lib/recovery-crypto";

export const runtime = "nodejs";

const questionKeys = RECOVERY_QUESTION_OPTIONS.map((option) => option.value) as [string, ...string[]];
const verificationSchema = z.object({
  email: z.string().trim().email().max(320),
  questionOne: z.enum(questionKeys),
  answerOne: z.string().trim().min(2).max(128),
  questionTwo: z.enum(questionKeys),
  answerTwo: z.string().trim().min(2).max(128),
  recoveryCode: z.string().trim().min(16).max(64),
});

const attempts = new Map<string, { count: number; blockedUntil: number }>();
const MAX_IP_ATTEMPTS = 8;
const IP_BLOCK_MS = 15 * 60_000;
const ACCOUNT_MAX_FAILURES = 5;
const ACCOUNT_BLOCK_MS = 15 * 60_000;
const dummyRecoveryHash = hashRecoverySecret("saveyorupee-recovery-dummy");

function clientKey(request: Request, email: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  return `${address}:${email}`;
}

function genericFailure() {
  return NextResponse.json({ error: "Those recovery details did not match." }, { status: 401 });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  const parsed = verificationSchema.safeParse(await request.json());
  if (!parsed.success || parsed.data.questionOne === parsed.data.questionTwo) return genericFailure();
  const email = parsed.data.email.toLowerCase();
  const key = clientKey(request, email);
  const now = Date.now();
  const ipState = attempts.get(key);
  if (ipState?.blockedUntil && ipState.blockedUntil > now) {
    return NextResponse.json({ error: "Too many recovery attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(Math.ceil((ipState.blockedUntil - now) / 1000)) } });
  }

  const db = getPrisma();
  const user = hasBetaAccess(email) ? await db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, recovery: true },
  }) : null;
  const recovery = user?.recovery;
  if (recovery?.lockedUntil && recovery.lockedUntil.getTime() > now) {
    return NextResponse.json({ error: "Too many recovery attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(Math.ceil((recovery.lockedUntil.getTime() - now) / 1000)) } });
  }

  const fallbackHash = recovery ? "invalid" : await dummyRecoveryHash;
  const verificationResults = await Promise.all([
    verifyRecoverySecret(normalizeRecoveryAnswer(parsed.data.answerOne), recovery?.questionOneHash ?? fallbackHash),
    verifyRecoverySecret(normalizeRecoveryAnswer(parsed.data.answerTwo), recovery?.questionTwoHash ?? fallbackHash),
    verifyRecoverySecret(normalizeRecoveryCode(parsed.data.recoveryCode), recovery?.recoveryCodeHash ?? fallbackHash),
  ]);
  if (!user || !recovery || parsed.data.questionOne !== recovery.questionOneKey || parsed.data.questionTwo !== recovery.questionTwoKey || !verificationResults.every(Boolean)) {
    const nextCount = (ipState?.count ?? 0) + 1;
    attempts.set(key, { count: nextCount, blockedUntil: nextCount >= MAX_IP_ATTEMPTS ? now + IP_BLOCK_MS : 0 });
    if (recovery) {
      const failedAttempts = recovery.failedAttempts + 1;
      await db.accountRecovery.update({
        where: { id: recovery.id },
        data: { failedAttempts: { increment: 1 }, lockedUntil: failedAttempts >= ACCOUNT_MAX_FAILURES ? new Date(now + ACCOUNT_BLOCK_MS) : recovery.lockedUntil },
      });
    }
    return genericFailure();
  }

  attempts.delete(key);
  await db.accountRecovery.update({ where: { id: recovery.id }, data: { failedAttempts: 0, lockedUntil: null } });
  const token = randomBytes(32).toString("base64url");
  await db.verification.create({
    data: {
      identifier: `reset-password:${token}`,
      value: user.id,
      expiresAt: new Date(now + 10 * 60_000),
    },
  });
  return NextResponse.json({ token });
}
