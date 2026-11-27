import { z } from "zod";
import type { AgentScope } from "./agent-oauth";

/**
 * A minimal, stateless Model Context Protocol server over Streamable HTTP: every POST carries one
 * JSON-RPC message and gets one JSON answer, with no sessions or server-sent streams. That is
 * all a tools-only server needs, and it runs unchanged on serverless functions.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const SERVER_INFO = { name: "saveyorupee", title: "SaveYoRupee", version: "1.0.0" } as const;

export const SERVER_INSTRUCTIONS = [
  "SaveYoRupee is the user's personal expense ledger (dates in Nepal time; months can be AD like 2026-10 or Bikram Sambat like BS:2083-06).",
  "Amounts are { minor, text }: minor is exact 1/100 units, text is ready to read. Loans and repayments are never income or spending.",
  "Call get_ledger_context first for ids, currency, calendar and today's date.",
  "For a monthly report use get_monthly_report (last month by default). For what needs attention now use get_month_overview, then get_budgets, get_dues, get_recurring and get_cash_forecast for detail.",
  "Use send_for_review when a bank or wallet notification, or something the user says, describes money moving. It never writes to the ledger: the user reviews each one in the app before it is saved.",
  "With ledger:write you may instead save entries directly: add_transaction, edit_transaction, recategorize_transactions, delete_transaction, add_transfer and delete_transfer. Pass draft_id when saving a message from the review queue, so it leaves the queue. Every change is recorded in the user's Logs under your name.",
  "Never send one-time codes (OTP), passwords or promotional messages. Pass the notification's own id as external_id so a retry is not queued twice.",
].join(" ");

export interface ToolDefinition<Input = unknown> {
  name: string;
  title: string;
  description: string;
  scope: AgentScope;
  readOnly: boolean;
  /** Removes data the user may not get back from this connection. */
  destructive?: boolean;
  input: z.ZodType<Input>;
  run: (input: Input) => Promise<unknown>;
}

export class ToolInputError extends Error {}

export type JsonRpcId = string | number;
export interface JsonRpcRequest { jsonrpc: "2.0"; id?: JsonRpcId | null; method: string; params?: unknown }
export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId | null; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId | null; error: { code: number; message: string; data?: unknown } };

/** Thrown when a call needs a scope the token lacks; the HTTP layer answers 403 insufficient_scope. */
export class InsufficientScopeError extends Error {
  constructor(readonly scope: AgentScope) { super(`This connection does not allow ${scope}.`); }
}

const messageSchema = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number()]).nullable().optional(), method: z.string().min(1), params: z.unknown().optional() });
const callSchema = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() });

function rpcError(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Describes a tool's input for clients. Zod 4 emits draft 2020-12 JSON Schema directly. */
function inputSchemaFor(tool: ToolDefinition) {
  const schema = z.toJSONSchema(tool.input, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

function toolListing(tool: ToolDefinition) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: inputSchemaFor(tool),
    annotations: { title: tool.title, readOnlyHint: tool.readOnly, destructiveHint: Boolean(tool.destructive), idempotentHint: tool.readOnly, openWorldHint: false },
  };
}

function negotiateVersion(params: unknown) {
  const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
  return typeof requested === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
}

/** Parses one JSON-RPC message. Batches were removed from MCP in 2025-06-18 and are refused. */
export function parseMessage(body: unknown): { ok: true; message: JsonRpcRequest } | { ok: false; response: JsonRpcResponse } {
  if (Array.isArray(body)) return { ok: false, response: rpcError(null, -32600, "Batch requests are not supported.") };
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) return { ok: false, response: rpcError(null, -32600, "Invalid JSON-RPC request.") };
  return { ok: true, message: parsed.data as JsonRpcRequest };
}

/**
 * Answers one message. Returns null for notifications (no id), which the HTTP layer
 * acknowledges with 202. Tools outside the token's scopes are neither listed nor callable.
 */
export async function handleMessage(message: JsonRpcRequest, tools: readonly ToolDefinition[], scopes: readonly AgentScope[]): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  if (message.id === undefined || message.id === null) return null;
  const visible = tools.filter((tool) => scopes.includes(tool.scope));
  switch (message.method) {
    case "initialize":
      return { jsonrpc: "2.0", id, result: { protocolVersion: negotiateVersion(message.params), capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: SERVER_INSTRUCTIONS } };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: visible.map(toolListing) } };
    case "tools/call": {
      const call = callSchema.safeParse(message.params);
      if (!call.success) return rpcError(id, -32602, "tools/call needs a tool name.");
      const tool = tools.find((candidate) => candidate.name === call.data.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${call.data.name}`);
      if (!scopes.includes(tool.scope)) throw new InsufficientScopeError(tool.scope);
      const input = tool.input.safeParse(call.data.arguments ?? {});
      if (!input.success) return { jsonrpc: "2.0", id, result: toolError(`Invalid arguments: ${z.prettifyError(input.error)}`) };
      try {
        const output = await tool.run(input.data);
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output } };
      } catch (error) {
        if (error instanceof ToolInputError) return { jsonrpc: "2.0", id, result: toolError(error.message) };
        throw error;
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${message.method}`);
  }
}

function toolError(text: string) {
  return { content: [{ type: "text", text }], isError: true };
}
