import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_DAILY_LIMITS, AI_GLOBAL_LIMIT_MESSAGE, aiLimitMessage, AiQuotaError, aiUsageDay, consumeAiQuota, globalDailyCap, type AiUsageClient } from "./ai-usage";

/** An in-memory AiUsage table behaving like Prisma's upsert-increment. */
function fakeDb() {
  const rows = new Map<string, number>();
  const keyOf = (key: { userId: string; day: Date; feature: string }) => `${key.userId}|${key.day.toISOString()}|${key.feature}`;
  const aiUsage = {
    upsert: vi.fn(async ({ where, create }: { where: { userId_day_feature: { userId: string; day: Date; feature: string } }; create: { count: number } }) => {
      const key = keyOf(where.userId_day_feature);
      const count = rows.has(key) ? rows.get(key)! + 1 : create.count;
      rows.set(key, count);
      return { count };
    }),
    update: vi.fn(async ({ where, data }: { where: { userId_day_feature: { userId: string; day: Date; feature: string } }; data: { count: { decrement: number } } }) => {
      const key = keyOf(where.userId_day_feature);
      rows.set(key, rows.get(key)! - data.count.decrement);
      return {};
    }),
    aggregate: vi.fn(async ({ where }: { where: { day: Date } }) => ({ _sum: { count: [...rows].filter(([key]) => key.includes(`|${where.day.toISOString()}|`)).reduce((sum, [, count]) => sum + count, 0) || null } })),
  };
  return { db: { aiUsage } as unknown as AiUsageClient, aiUsage, rows };
}

// 23:30 UTC on 6 Oct is already 7 Oct in Kathmandu (UTC+5:45).
const lateEvening = new Date("2026-10-06T23:30:00.000Z");

afterEach(() => vi.unstubAllEnvs());

describe("consumeAiQuota", () => {
  it("counts each call against today's Kathmandu date", async () => {
    const { db, aiUsage } = fakeDb();

    const result = await consumeAiQuota(db, "user-1", "receipt", { now: lateEvening, globalCap: null });

    expect(result).toEqual({ used: 1, limit: 20, remaining: 19 });
    expect(aiUsage.upsert).toHaveBeenCalledWith({
      where: { userId_day_feature: { userId: "user-1", day: new Date("2026-10-07T00:00:00.000Z"), feature: "receipt" } },
      create: { userId: "user-1", day: new Date("2026-10-07T00:00:00.000Z"), feature: "receipt", count: 1 },
      update: { count: { increment: 1 } },
    });
  });

  it("refuses the call after the feature's limit with a friendly message, and takes it back off the count", async () => {
    const { db, rows } = fakeDb();
    for (let index = 0; index < AI_DAILY_LIMITS.receipt; index += 1) await consumeAiQuota(db, "user-1", "receipt", { now: lateEvening, globalCap: null });

    const refused = consumeAiQuota(db, "user-1", "receipt", { now: lateEvening, globalCap: null });

    await expect(refused).rejects.toBeInstanceOf(AiQuotaError);
    await expect(consumeAiQuota(db, "user-1", "receipt", { now: lateEvening, globalCap: null })).rejects.toThrow("You've used today's 20 receipt scans. They reset at midnight Nepal time.");
    expect([...rows.values()]).toEqual([20]);
  });

  it("keeps each feature, person and day separate", async () => {
    const { db } = fakeDb();
    for (let index = 0; index < AI_DAILY_LIMITS.learning; index += 1) await consumeAiQuota(db, "user-1", "learning", { now: lateEvening, globalCap: null });

    await expect(consumeAiQuota(db, "user-1", "learning", { now: lateEvening, globalCap: null })).rejects.toThrow(aiLimitMessage("learning"));
    await expect(consumeAiQuota(db, "user-1", "sms", { now: lateEvening, globalCap: null })).resolves.toMatchObject({ used: 1, limit: 50 });
    await expect(consumeAiQuota(db, "user-2", "learning", { now: lateEvening, globalCap: null })).resolves.toMatchObject({ used: 1 });
    await expect(consumeAiQuota(db, "user-1", "learning", { now: new Date("2026-10-07T18:15:00.000Z"), globalCap: null })).resolves.toMatchObject({ used: 1 });
  });

  it("enforces the optional app-wide cap by summing today's rows", async () => {
    const { db, aiUsage } = fakeDb();
    await consumeAiQuota(db, "user-1", "sms", { now: lateEvening, globalCap: 2 });
    await consumeAiQuota(db, "user-2", "receipt", { now: lateEvening, globalCap: 2 });

    await expect(consumeAiQuota(db, "user-3", "statement", { now: lateEvening, globalCap: 2 })).rejects.toThrow(AI_GLOBAL_LIMIT_MESSAGE);
    expect(aiUsage.aggregate).toHaveBeenLastCalledWith({ where: { day: new Date("2026-10-07T00:00:00.000Z") }, _sum: { count: true } });
    expect(aiUsage.upsert).toHaveBeenCalledTimes(2);
  });

  it("reads the app-wide cap from GEMINI_DAILY_CAP when not given", async () => {
    vi.stubEnv("GEMINI_DAILY_CAP", "1");
    const { db } = fakeDb();
    await consumeAiQuota(db, "user-1", "sms", { now: lateEvening });

    await expect(consumeAiQuota(db, "user-2", "sms", { now: lateEvening })).rejects.toThrow(AI_GLOBAL_LIMIT_MESSAGE);
  });

  it("retries once when two first calls race to create today's row", async () => {
    const { db, aiUsage } = fakeDb();
    aiUsage.upsert.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));

    await expect(consumeAiQuota(db, "user-1", "sms", { now: lateEvening, globalCap: null })).resolves.toMatchObject({ used: 1 });
    expect(aiUsage.upsert).toHaveBeenCalledTimes(2);
  });

  it("skips counting while the AiUsage table has not been migrated, but surfaces other database errors", async () => {
    const { db, aiUsage } = fakeDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    aiUsage.upsert.mockRejectedValueOnce(Object.assign(new Error("The table `public.AiUsage` does not exist"), { code: "P2021" }));

    await expect(consumeAiQuota(db, "user-1", "sms", { now: lateEvening, globalCap: null })).resolves.toMatchObject({ used: 0 });
    aiUsage.upsert.mockRejectedValueOnce(Object.assign(new Error("connection lost"), { code: "P1001" }));
    await expect(consumeAiQuota(db, "user-1", "sms", { now: lateEvening, globalCap: null })).rejects.toThrow("connection lost");
    warn.mockRestore();
  });
});

describe("helpers", () => {
  it("names every feature's limit in its message", () => {
    expect(aiLimitMessage("statement")).toBe("You've used today's 10 statement imports. They reset at midnight Nepal time.");
    expect(aiLimitMessage("sms")).toBe("You've used today's 50 message reads. They reset at midnight Nepal time.");
    expect(aiLimitMessage("learning")).toBe("You've used today's 5 personalization runs. They reset at midnight Nepal time.");
  });

  it("accepts only a positive whole-number app-wide cap", () => {
    expect(globalDailyCap("500")).toBe(500);
    expect(globalDailyCap(undefined)).toBeNull();
    expect(globalDailyCap("")).toBeNull();
    expect(globalDailyCap("0")).toBeNull();
    expect(globalDailyCap("12.5")).toBeNull();
    expect(globalDailyCap("lots")).toBeNull();
  });

  it("dates usage by the Kathmandu calendar day", () => {
    expect(aiUsageDay(new Date("2026-10-07T18:14:00.000Z"))).toEqual(new Date("2026-10-07T00:00:00.000Z"));
    expect(aiUsageDay(new Date("2026-10-07T18:15:00.000Z"))).toEqual(new Date("2026-10-08T00:00:00.000Z"));
  });
});
