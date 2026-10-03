import { randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";
import type { CurrencyCode } from "../types";
import { ACTIVITY_PAGE_SIZE, activityCutoff, isActivityArea, type ActivityArea, type ActivityChange, type ActivityDraft, type ActivityEntry, type ActivityPage } from "./activity-log";
import { getPrisma } from "./prisma";

type ActivityRow = {
  id: string; action: string; area: string; entityId: string | null; title: string; subject: string | null;
  amountMinor: number | null; currency: string; changes: Prisma.JsonValue; meta: Prisma.JsonValue; createdAt: Date;
};

export function serializeActivity(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    action: row.action,
    area: isActivityArea(row.area) ? row.area : "data",
    entityId: row.entityId,
    title: row.title,
    subject: row.subject,
    amountMinor: row.amountMinor,
    currency: row.currency as CurrencyCode,
    changes: Array.isArray(row.changes) ? row.changes as unknown as ActivityChange[] : [],
    meta: row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? row.meta as ActivityEntry["meta"] : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Persists what a request did, after the change itself has succeeded.
 * A failed log write never undoes or fails the user's change; the entries are still returned so the
 * confirmation toast matches what happened, and the failure is reported to the server log.
 */
export async function recordActivity(userId: string, drafts: readonly ActivityDraft[]): Promise<ActivityEntry[]> {
  if (!drafts.length) return [];
  const db = getPrisma();
  const createdAt = new Date();
  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { currency: true } });
    const currency = user?.currency ?? "NPR";
    const rows = await db.activityLog.createManyAndReturn({
      data: drafts.map((draft) => ({
        userId,
        action: draft.action,
        area: draft.area,
        entityId: draft.entityId ?? null,
        title: draft.title,
        subject: draft.subject?.trim() || null,
        amountMinor: draft.amountMinor ?? null,
        currency,
        changes: draft.changes?.length ? draft.changes as unknown as Prisma.InputJsonValue : undefined,
        meta: draft.meta ? draft.meta as Prisma.InputJsonValue : undefined,
        createdAt,
      })),
    });
    return rows.map(serializeActivity);
  } catch (error) {
    console.error("Could not write activity log entries.", error);
    return drafts.map((draft) => ({
      id: `unsaved-${randomUUID()}`,
      action: draft.action,
      area: draft.area,
      entityId: draft.entityId ?? null,
      title: draft.title,
      subject: draft.subject?.trim() || null,
      amountMinor: draft.amountMinor ?? null,
      currency: "NPR",
      changes: draft.changes ?? [],
      meta: draft.meta ?? null,
      createdAt: createdAt.toISOString(),
    }));
  }
}

/** Records security events from auth hooks, where nothing should ever block sign-in or sign-out. */
export async function recordActivitySafely(userId: string, draft: ActivityDraft) {
  try { await recordActivity(userId, [draft]); }
  catch (error) { console.error("Could not record activity.", error); }
}

export async function purgeExpiredActivity(userId: string) {
  await getPrisma().activityLog.deleteMany({ where: { userId, createdAt: { lt: activityCutoff() } } });
}

export async function loadActivityPage(userId: string, options: { area?: ActivityArea | null; cursor?: string | null; limit?: number }): Promise<ActivityPage> {
  const limit = Math.min(Math.max(options.limit ?? ACTIVITY_PAGE_SIZE, 1), 100);
  const rows = await getPrisma().activityLog.findMany({
    where: { userId, createdAt: { gte: activityCutoff() }, ...(options.area ? { area: options.area } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);
  return { entries: page.map(serializeActivity), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
}
