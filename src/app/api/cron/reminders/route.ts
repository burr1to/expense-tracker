import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { todayInput } from "../../../../lib/dates";
import { asDate } from "../../../../lib/ledger-snapshot";
import { getPrisma } from "../../../../lib/prisma";
import { reminderEmailConfigured, sendReminderEmail, type ReminderEmailResult } from "../../../../lib/reminder-mail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** People read per query; each one is then sent to in turn, which also keeps under the mail provider's rate limit. */
const REMINDER_BATCH_SIZE = 25;
/** Stop starting new sends after this long; whoever is left gets theirs when they next open the app. */
const TIME_BUDGET_MS = 45_000;

function authorized(header: string | null, secret: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}

/**
 * The 07:00 Nepal-time reminder run (vercel.json schedules it at 01:15 UTC). Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; anything else is refused.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  if (!authorized(request.headers.get("authorization"), secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!reminderEmailConfigured()) return NextResponse.json({ error: "Reminder email is not configured." }, { status: 503 });

  const db = getPrisma();
  const today = todayInput();
  const appUrl = process.env.BETTER_AUTH_URL || new URL(request.url).origin;
  const started = Date.now();
  const results: Record<ReminderEmailResult, number> = { sent: 0, "nothing-due": 0, "already-sent": 0, off: 0, unconfigured: 0, failed: 0 };
  let cursor: string | null = null;
  let complete = false;
  while (!complete && Date.now() - started < TIME_BUDGET_MS) {
    const batch: { id: string }[] = await db.user.findMany({
      where: { emailReminders: true, OR: [{ lastReminderEmailOn: null }, { lastReminderEmailOn: { not: asDate(today) } }], ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true },
      orderBy: { id: "asc" },
      take: REMINDER_BATCH_SIZE,
    });
    let stopped = false;
    for (const user of batch) {
      if (Date.now() - started >= TIME_BUDGET_MS) { stopped = true; break; }
      let result: ReminderEmailResult;
      try {
        result = await sendReminderEmail(user.id, { today, appUrl });
      } catch (error) {
        console.warn("Reminder run could not finish one person.", error);
        result = "failed";
      }
      results[result] += 1;
      cursor = user.id;
    }
    complete = !stopped && batch.length < REMINDER_BATCH_SIZE;
  }
  return NextResponse.json({ ok: true, today, complete, ...results });
}
