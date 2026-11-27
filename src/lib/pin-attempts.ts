import { recordActivity } from "./activity-recorder";
import { getPrisma } from "./prisma";

export const PIN_MAX_FAILURES = 5;
export const PIN_FAILURE_WINDOW_MS = 15 * 60_000;
const PIN_FAILURE_ACTIONS = ["pin.failed", "pin.locked_out"];

/** How long PIN entry stays paused, given the times of recent wrong PINs (oldest first). 0 when a PIN may be tried. */
export function pinPauseSeconds(failureTimes: readonly number[], now: number) {
  const recent = failureTimes.filter((time) => time > now - PIN_FAILURE_WINDOW_MS);
  if (recent.length < PIN_MAX_FAILURES) return 0;
  const releasesAt = recent[recent.length - PIN_MAX_FAILURES] + PIN_FAILURE_WINDOW_MS;
  return Math.max(1, Math.ceil((releasesAt - now) / 1000));
}

const recentFailures = (userId: string, now: number) => getPrisma().activityLog.findMany({
  where: { userId, area: "security", action: { in: PIN_FAILURE_ACTIONS }, createdAt: { gt: new Date(now - PIN_FAILURE_WINDOW_MS) } },
  orderBy: { createdAt: "asc" },
  select: { createdAt: true },
});

/**
 * Wrong PINs are counted from the security Logs, so the limit holds across server instances and covers every place a PIN
 * is checked: the lock screen, changing it and removing it.
 */
export async function pinRetryAfterSeconds(userId: string, now = Date.now()) {
  return pinPauseSeconds((await recentFailures(userId, now)).map((failure) => failure.createdAt.getTime()), now);
}

/** Records a wrong PIN in Logs, which is also where the limit counts it from. */
export async function recordPinFailure(userId: string, title: string, subject: string | null, now = Date.now()) {
  const pauses = (await recentFailures(userId, now)).length + 1 >= PIN_MAX_FAILURES;
  await recordActivity(userId, [{ action: pauses ? "pin.locked_out" : "pin.failed", area: "security", title: pauses ? "PIN entry paused after repeated wrong PINs" : title, subject }]);
}

export const pinPausedMessage = (seconds: number) => `Too many wrong PINs. Try again in ${seconds >= 60 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`}.`;
