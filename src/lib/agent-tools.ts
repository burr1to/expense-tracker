import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client";
import type { AgentPrincipal } from "./agent-oauth-store";
import { ledgerReadTools, moneyOf } from "./agent-read-tools";
import { ToolInputError, type ToolDefinition } from "./mcp-protocol";
import { todayInAppZone } from "./period";
import { mentionsOneTimeCode, parseBankSms, SMS_MAX_LENGTH } from "./sms-templates";
import type { CurrencyCode } from "../types";

/** Drafts waiting for review per user. Past this, the agent is told to wait until the user catches up. */
export const MAX_PENDING_DRAFTS = 100;
/** Drafts one connection may send per hour, so a looping agent cannot flood the inbox. */
export const MAX_DRAFTS_PER_HOUR = 60;
export const DRAFT_SOURCES = ["notification", "sms", "conversation"] as const;

/** A stable id for a message when the agent has none, so the same notification sent twice queues once. */
export function draftExternalId(input: { externalId?: string; sourceApp?: string; text: string; receivedAt?: string }) {
  if (input.externalId) return `ext:${input.externalId}`;
  return `hash:${createHash("sha256").update([input.sourceApp ?? "", input.receivedAt ?? "", input.text.trim()].join("\u0000")).digest("hex")}`;
}

export function ledgerTools(db: PrismaClient, principal: AgentPrincipal): ToolDefinition[] {
  const userId = principal.userId;

  const listDrafts: ToolDefinition<{ status?: "pending" | "approved" | "dismissed" }> = {
    name: "list_review_queue",
    title: "Review queue",
    description: "Messages already sent for review and whether the user saved or dismissed them. Use it to avoid sending the same message twice.",
    scope: "ledger:draft",
    readOnly: true,
    input: z.object({ status: z.enum(["pending", "approved", "dismissed"]).optional().describe("Defaults to pending.") }).strict(),
    run: async (input) => {
      const drafts = await db.agentDraft.findMany({
        where: { userId, grantId: principal.grantId, status: input.status ?? "pending" },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, status: true, source: true, sourceApp: true, externalId: true, receivedAt: true, createdAt: true, resolvedAt: true },
      });
      return {
        drafts: drafts.map((draft) => ({
          id: draft.id, status: draft.status, source: draft.source, source_app: draft.sourceApp,
          external_id: draft.externalId.startsWith("ext:") ? draft.externalId.slice(4) : null,
          received_at: draft.receivedAt.toISOString(), sent_at: draft.createdAt.toISOString(), resolved_at: draft.resolvedAt?.toISOString() ?? null,
        })),
      };
    },
  };

  const sendForReview: ToolDefinition<{ text: string; source: typeof DRAFT_SOURCES[number]; source_app?: string; external_id?: string; received_at?: string }> = {
    name: "send_for_review",
    title: "Send for review",
    description: "Queues a bank or wallet notification (or a spend the user mentioned) for the user to review in SaveYoRupee. Nothing is saved to the ledger until they confirm it. Send the message text as received; do not summarise it.",
    scope: "ledger:draft",
    readOnly: false,
    input: z.object({
      text: z.string().trim().min(3).max(SMS_MAX_LENGTH).describe("The notification or message text, as received."),
      source: z.enum(DRAFT_SOURCES).describe("notification: a phone notification; sms: a text message; conversation: something the user told you."),
      source_app: z.string().trim().min(1).max(80).optional().describe("The app or sender that showed it, e.g. eSewa or NIC Asia."),
      external_id: z.string().trim().min(1).max(200).optional().describe("The notification's own id. A repeat with the same id is not queued twice."),
      received_at: z.iso.datetime({ offset: true }).optional().describe("When the notification arrived, ISO 8601."),
    }).strict(),
    run: async (input) => {
      if (mentionsOneTimeCode(input.text)) throw new ToolInputError("This looks like a one-time code. One-time codes are never stored; nothing was queued.");
      const receivedAt = input.received_at ? new Date(input.received_at) : new Date();
      if (receivedAt.getTime() > Date.now() + 5 * 60_000) throw new ToolInputError("received_at is in the future.");
      const externalId = draftExternalId({ externalId: input.external_id, sourceApp: input.source_app, text: input.text, receivedAt: input.received_at });
      const existing = await db.agentDraft.findUnique({ where: { userId_externalId: { userId, externalId } }, select: { id: true, status: true } });
      if (existing) return { status: "already_queued", draft_id: existing.id, review_status: existing.status };
      const hourAgo = new Date(Date.now() - 60 * 60_000);
      const [pending, recent] = await Promise.all([
        db.agentDraft.count({ where: { userId, status: "pending" } }),
        db.agentDraft.count({ where: { grantId: principal.grantId, createdAt: { gte: hourAgo } } }),
      ]);
      if (pending >= MAX_PENDING_DRAFTS) throw new ToolInputError(`The user has ${pending} messages waiting for review. Wait until they catch up before sending more.`);
      if (recent >= MAX_DRAFTS_PER_HOUR) throw new ToolInputError("Too many messages sent in the last hour. Try again later.");
      const today = todayInAppZone(receivedAt);
      const reading = parseBankSms(input.text, today);
      const { currency } = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { currency: true } });
      try {
        const draft = await db.agentDraft.create({
          data: { userId, grantId: principal.grantId, source: input.source, text: input.text, sourceApp: input.source_app ?? null, externalId, receivedAt },
          select: { id: true },
        });
        return {
          status: "queued_for_review",
          draft_id: draft.id,
          // A quick on-device reading, so the agent can tell the user what it saw. The user's review decides what is saved.
          reading: reading ? { kind: reading.kind, amount: moneyOf(currency as CurrencyCode)(reading.amountMinor), date: reading.occurredOn, merchant: reading.merchant } : null,
        };
      } catch (error) {
        // Two identical sends racing: the unique (userId, externalId) index lets only one through.
        if ((error as { code?: string }).code === "P2002") {
          const raced = await db.agentDraft.findUnique({ where: { userId_externalId: { userId, externalId } }, select: { id: true, status: true } });
          if (raced) return { status: "already_queued", draft_id: raced.id, review_status: raced.status };
        }
        throw error;
      }
    },
  };

  return [...ledgerReadTools(db, principal), listDrafts, sendForReview] as ToolDefinition[];
}
