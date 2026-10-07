import { todayInAppZone } from "./period";

/** Gemini calls each person may make per Nepal day, by feature. */
export const AI_DAILY_LIMITS = { receipt: 20, statement: 10, sms: 50, learning: 5 } as const;
export type AiFeature = keyof typeof AI_DAILY_LIMITS;

const FEATURE_NOUNS: Record<AiFeature, [singular: string, plural: string]> = {
  receipt: ["receipt scan", "receipt scans"],
  statement: ["statement import", "statement imports"],
  sms: ["message read", "message reads"],
  learning: ["personalization run", "personalization runs"],
};

export class AiQuotaError extends Error {
  readonly status = 429;
  constructor(message: string) { super(message); this.name = "AiQuotaError"; }
}

export function aiLimitMessage(feature: AiFeature, limit: number = AI_DAILY_LIMITS[feature]) {
  const [singular, plural] = FEATURE_NOUNS[feature];
  return `You've used today's ${limit} ${limit === 1 ? singular : plural}. They reset at midnight Nepal time.`;
}
export const AI_GLOBAL_LIMIT_MESSAGE = "SaveYoRupee has reached today's limit for AI reading. It resets at midnight Nepal time; you can still add entries by hand.";

/** The optional app-wide daily cap from GEMINI_DAILY_CAP, or null when unset or not a positive whole number. */
export function globalDailyCap(value = process.env.GEMINI_DAILY_CAP) {
  const cap = Number(value?.trim());
  return value?.trim() && Number.isInteger(cap) && cap > 0 ? cap : null;
}

/** Today in Kathmandu as the @db.Date value Prisma stores. */
export const aiUsageDay = (now = new Date()) => new Date(`${todayInAppZone(now)}T00:00:00.000Z`);

type UsageRow = { count: number };
type UsageKey = { userId: string; day: Date; feature: string };
/** The slice of the Prisma client this needs, so tests can pass a fake. */
export interface AiUsageClient {
  aiUsage: {
    upsert(args: { where: { userId_day_feature: UsageKey }; create: UsageKey & { count: number }; update: { count: { increment: number } } }): Promise<UsageRow>;
    update(args: { where: { userId_day_feature: UsageKey }; data: { count: { decrement: number } } }): Promise<unknown>;
    aggregate(args: { where: { day: Date }; _sum: { count: true } }): Promise<{ _sum: { count: number | null } }>;
  };
}

const prismaCode = (error: unknown) => typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;

/**
 * Counts one Gemini call for this person and feature today (Kathmandu), or throws AiQuotaError when that would
 * go over the daily limit. A refused call is taken back off the count, so retrying after the limit costs nothing
 * and never eats into the app-wide cap. Call it right before the request to Gemini.
 */
export async function consumeAiQuota(db: AiUsageClient, userId: string, feature: AiFeature, options: { now?: Date; globalCap?: number | null } = {}) {
  const day = aiUsageDay(options.now);
  const key = { userId, day, feature };
  try {
    const cap = options.globalCap === undefined ? globalDailyCap() : options.globalCap;
    if (cap !== null) {
      const total = await db.aiUsage.aggregate({ where: { day }, _sum: { count: true } });
      if ((total._sum.count ?? 0) >= cap) throw new AiQuotaError(AI_GLOBAL_LIMIT_MESSAGE);
    }
    const increment = () => db.aiUsage.upsert({ where: { userId_day_feature: key }, create: { ...key, count: 1 }, update: { count: { increment: 1 } } });
    // Two first calls of the day can race to create the row; the loser increments the row the winner made.
    const row = await increment().catch((error: unknown) => { if (prismaCode(error) === "P2002") return increment(); throw error; });
    const limit = AI_DAILY_LIMITS[feature];
    if (row.count > limit) {
      await db.aiUsage.update({ where: { userId_day_feature: key }, data: { count: { decrement: 1 } } }).catch(() => undefined);
      throw new AiQuotaError(aiLimitMessage(feature, limit));
    }
    return { used: row.count, limit, remaining: limit - row.count };
  } catch (error) {
    if (error instanceof AiQuotaError) throw error;
    // Until the AiUsage migration is applied, counting is skipped rather than switching AI features off.
    if (prismaCode(error) === "P2021") {
      console.warn("AiUsage table is missing; apply the latest migration to enforce daily AI limits.");
      return { used: 0, limit: AI_DAILY_LIMITS[feature], remaining: AI_DAILY_LIMITS[feature] };
    }
    throw error;
  }
}
