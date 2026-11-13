import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client";
import type { ActivityEntry } from "./activity-log";
import type { AgentPrincipal } from "./agent-oauth-store";
import { dateOnly } from "./ledger-snapshot";
import { runLedgerAction } from "./ledger-actions";
import { ToolInputError, type ToolDefinition } from "./mcp-protocol";

/**
 * Direct ledger writes for a connection granted ledger:write. Each tool runs the same ledger action
 * the app's own screens use, so validation, reconciliation locks, household rules and Logs are
 * identical; the only difference is that each Logs entry names the agent.
 */

const PAYMENT_MODES = ["cash", "cheque", "online"] as const;

const amountMinor = z.number().int().positive().max(100_000_000_000).describe("Exact amount in 1/100 units: NPR 1,590 is 159000.");
const date = z.iso.date().describe("YYYY-MM-DD (AD).");
const note = z.string().trim().max(240).describe("The merchant or purpose, e.g. \"Viral Mart, New Road\".");
const draftId = z.string().min(1).max(64).optional().describe("The review-queue draft this entry comes from. It is marked saved and leaves the queue.");
const requestId = z.string().trim().min(1).max(60).optional().describe("Your own id for this write. Sending the same request_id again does not save twice.");

/** A request id the ledger stores once per entry, so a retried add never saves twice. */
function clientRequestIdFor(principal: AgentPrincipal, input: { request_id?: string; draft_id?: string }) {
  if (input.request_id) return `agent:${principal.grantId}:${input.request_id}`;
  if (input.draft_id) return `agent-draft:${input.draft_id}`;
  return `agent:${randomUUID()}`;
}

export function ledgerWriteTools(db: PrismaClient, principal: AgentPrincipal, origin: string): ToolDefinition[] {
  const userId = principal.userId;

  /** Runs one ledger action as the user, tagged with the agent's name, and turns refusals into tool errors. */
  const run = async (action: string, payload: unknown, id?: string) => {
    const response = await runLedgerAction(userId, { action, id, payload }, { origin, agent: principal.clientName });
    const body = await response.json().catch(() => null) as { error?: string; activity?: ActivityEntry[] } | null;
    if (!response.ok) {
      if (response.status >= 500) throw new Error(body?.error ?? "Ledger action failed.");
      throw new ToolInputError(body?.error ?? "The ledger refused this change.");
    }
    return (body?.activity ?? []).map((entry) => ({ title: entry.title, subject: entry.subject, changes: entry.changes }));
  };

  const pendingDraft = async (id: string | undefined) => {
    if (!id) return null;
    const draft = await db.agentDraft.findFirst({ where: { id, userId }, select: { id: true, status: true } });
    if (!draft) throw new ToolInputError("No such draft in the review queue.");
    return draft;
  };

  /** Takes a draft out of the queue once its entry is saved; the message text is cleared, as when the user saves it. */
  const resolveDraft = async (id: string | undefined, transactionId: string | null) => {
    if (!id) return;
    await db.agentDraft.updateMany({ where: { id, userId, status: "pending" }, data: { status: "approved", transactionId, resolvedAt: new Date(), text: "" } });
  };

  const ownTransaction = async (id: string) => {
    const entry = await db.transaction.findFirst({ where: { id, userId, deletedAt: null } });
    if (!entry) throw new ToolInputError("No such transaction (or it belongs to someone else in the household).");
    return entry;
  };

  type AddInput = { kind: "expense" | "income"; category: string; subcategory?: string; amount_minor: number; date: string; note: string; payment: typeof PAYMENT_MODES[number]; account_id?: string; area?: string; draft_id?: string; request_id?: string };
  const addTransaction: ToolDefinition<AddInput> = {
    name: "add_transaction",
    title: "Add transaction",
    description: "Saves an income or expense straight to the ledger, without the user's review. Get category, subcategory and account ids from get_ledger_context. Use add_transfer, not this, for money moved between the user's own accounts.",
    scope: "ledger:write",
    readOnly: false,
    input: z.object({
      kind: z.enum(["expense", "income"]),
      category: z.string().min(1).max(80).describe("Category id from get_ledger_context. Use \"other\" only when nothing fits."),
      subcategory: z.string().trim().max(80).optional().describe("A subcategory name for that category, if one fits."),
      amount_minor: amountMinor,
      date,
      note,
      payment: z.enum(PAYMENT_MODES).describe("online needs account_id; cash and cheque take none."),
      account_id: z.string().min(1).max(64).optional().describe("Payment account id, e.g. the bank account the SMS names."),
      area: z.string().trim().max(120).optional().describe("Where it was spent, e.g. Boudha."),
      draft_id: draftId,
      request_id: requestId,
    }).strict(),
    run: async (input) => {
      const draft = await pendingDraft(input.draft_id);
      if (draft && draft.status !== "pending") return { status: "already_reviewed", draft_id: draft.id, review_status: draft.status };
      const clientRequestId = clientRequestIdFor(principal, input);
      const activity = await run("saveTransaction", {
        kind: input.kind, category: input.category, subcategory: input.subcategory || null, amountMinor: input.amount_minor,
        occurredOn: input.date, note: input.note, area: input.area || null, paymentMode: input.payment,
        paymentAccountId: input.payment === "online" ? input.account_id ?? null : null, clientRequestId,
      });
      const saved = await db.transaction.findFirst({ where: { userId, clientRequestId }, select: { id: true } });
      await resolveDraft(input.draft_id, saved?.id ?? null);
      return { status: activity.length ? "saved" : "already_saved", transaction_id: saved?.id ?? null, logged: activity };
    },
  };

  type EditInput = { id: string; kind?: "expense" | "income"; category?: string; subcategory?: string | null; amount_minor?: number; date?: string; note?: string; payment?: typeof PAYMENT_MODES[number]; account_id?: string | null; area?: string | null };
  const editTransaction: ToolDefinition<EditInput> = {
    name: "edit_transaction",
    title: "Edit transaction",
    description: "Changes one saved income or expense. Send only the fields to change; the rest, including its place, receipt and group, are kept.",
    scope: "ledger:write",
    readOnly: false,
    input: z.object({
      id: z.string().min(1).max(64).describe("Transaction id from list_transactions."),
      kind: z.enum(["expense", "income"]).optional(),
      category: z.string().min(1).max(80).optional(),
      subcategory: z.string().trim().max(80).nullable().optional().describe("null clears it."),
      amount_minor: amountMinor.optional(),
      date: date.optional(),
      note: note.optional(),
      payment: z.enum(PAYMENT_MODES).optional(),
      account_id: z.string().min(1).max(64).nullable().optional(),
      area: z.string().trim().max(120).nullable().optional(),
    }).strict(),
    run: async (input) => {
      const entry = await ownTransaction(input.id);
      const paymentMode = input.payment ?? entry.paymentMode;
      const accountId = input.account_id !== undefined ? input.account_id : entry.paymentAccountId;
      // The save replaces the place, so the current one is sent back unchanged.
      const location = entry.locationLabel && entry.locationLatitude !== null && entry.locationLongitude !== null
        ? { label: entry.locationLabel, address: entry.locationAddress ?? "", latitude: entry.locationLatitude, longitude: entry.locationLongitude, accuracy: entry.locationAccuracy, source: entry.locationSource ?? "pin", savedPlaceId: entry.savedPlaceId }
        : null;
      const categoryChanged = input.category !== undefined && input.category !== entry.category;
      const activity = await run("saveTransaction", {
        kind: input.kind ?? entry.kind,
        category: input.category ?? entry.category,
        // A new category drops the old subcategory unless a new one is given.
        subcategory: input.subcategory !== undefined ? input.subcategory || null : categoryChanged ? null : entry.subcategory,
        amountMinor: input.amount_minor ?? entry.amountMinor,
        occurredOn: input.date ?? dateOnly(entry.occurredOn),
        note: input.note ?? entry.note,
        area: input.area !== undefined ? input.area || null : entry.area,
        paymentMode,
        paymentAccountId: paymentMode === "online" ? accountId : null,
        shared: entry.shared,
        location,
      }, entry.id);
      return { status: activity.length ? "saved" : "unchanged", transaction_id: entry.id, logged: activity };
    },
  };

  const recategorize: ToolDefinition<{ ids: string[]; kind: "expense" | "income"; category: string; subcategory?: string | null }> = {
    name: "recategorize_transactions",
    title: "Recategorize transactions",
    description: "Moves up to 100 saved entries to one category (and optional subcategory) in a single change.",
    scope: "ledger:write",
    readOnly: false,
    input: z.object({
      ids: z.array(z.string().min(1).max(64)).min(1).max(100),
      kind: z.enum(["expense", "income"]).describe("The kind the category is for; entries of the other kind are switched to it."),
      category: z.string().min(1).max(80),
      subcategory: z.string().trim().max(80).nullable().optional(),
    }).strict(),
    run: async (input) => {
      const activity = await run("updateTransactions", { ids: input.ids, changes: { category: { kind: input.kind, category: input.category, subcategory: input.subcategory ?? null } } });
      return { status: activity.length ? "saved" : "unchanged", count: input.ids.length, logged: activity };
    },
  };

  const deleteTransaction: ToolDefinition<{ id: string }> = {
    name: "delete_transaction",
    title: "Delete transaction",
    description: "Deletes one saved income or expense. Confirm with the user first unless they asked for this exact entry to go.",
    scope: "ledger:write",
    readOnly: false,
    destructive: true,
    input: z.object({ id: z.string().min(1).max(64) }).strict(),
    run: async (input) => {
      await ownTransaction(input.id);
      const activity = await run("deleteTransaction", undefined, input.id);
      return { status: "deleted", transaction_id: input.id, logged: activity };
    },
  };

  const addTransfer: ToolDefinition<{ from_account_id: string; to_account_id: string; amount_minor: number; date: string; note?: string; draft_id?: string; request_id?: string }> = {
    name: "add_transfer",
    title: "Add transfer",
    description: "Records money moved between two of the user's own accounts (bank to wallet, balance transfer, ATM to cash). Not income or spending.",
    scope: "ledger:write",
    readOnly: false,
    input: z.object({
      from_account_id: z.string().min(1).max(64),
      to_account_id: z.string().min(1).max(64),
      amount_minor: amountMinor,
      date,
      note: note.optional(),
      draft_id: draftId,
      request_id: requestId,
    }).strict(),
    run: async (input) => {
      const draft = await pendingDraft(input.draft_id);
      if (draft && draft.status !== "pending") return { status: "already_reviewed", draft_id: draft.id, review_status: draft.status };
      const clientRequestId = clientRequestIdFor(principal, input);
      const activity = await run("saveTransfer", { fromAccountId: input.from_account_id, toAccountId: input.to_account_id, amountMinor: input.amount_minor, occurredOn: input.date, note: input.note ?? "", clientRequestId });
      const saved = await db.accountTransfer.findFirst({ where: { userId, clientRequestId }, select: { id: true } });
      await resolveDraft(input.draft_id, null);
      return { status: activity.length ? "saved" : "already_saved", transfer_id: saved?.id ?? null, logged: activity };
    },
  };

  const deleteTransfer: ToolDefinition<{ id: string }> = {
    name: "delete_transfer",
    title: "Delete transfer",
    description: "Deletes one transfer between the user's accounts. Confirm with the user first unless they asked for this exact transfer to go.",
    scope: "ledger:write",
    readOnly: false,
    destructive: true,
    input: z.object({ id: z.string().min(1).max(64).describe("Transfer id from list_transfers.") }).strict(),
    run: async (input) => {
      const activity = await run("deleteTransfer", undefined, input.id);
      return { status: "deleted", transfer_id: input.id, logged: activity };
    },
  };

  return [addTransaction, editTransaction, recategorize, deleteTransaction, addTransfer, deleteTransfer] as ToolDefinition[];
}
