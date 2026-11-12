import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { handleMessage, InsufficientScopeError, parseMessage, ToolInputError, type ToolDefinition } from "./mcp-protocol";

const readTool: ToolDefinition<{ month?: string }> = {
  name: "month_summary", title: "Month", description: "d", scope: "ledger:read", readOnly: true,
  input: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).strict(),
  run: vi.fn(async (input) => ({ month: input.month ?? "2026-11" })),
};
const draftTool: ToolDefinition<{ text: string }> = {
  name: "send_for_review", title: "Send", description: "d", scope: "ledger:draft", readOnly: false,
  input: z.object({ text: z.string() }).strict(),
  run: async (input) => { if (input.text === "otp") throw new ToolInputError("No OTPs."); return { status: "queued_for_review" }; },
};
const tools = [readTool, draftTool] as ToolDefinition[];
const call = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0" as const, id, method, params });

describe("parseMessage", () => {
  it("refuses batches and malformed messages", () => {
    expect(parseMessage([call(1, "ping")])).toMatchObject({ ok: false, response: { error: { code: -32600 } } });
    expect(parseMessage({ id: 1, method: "ping" })).toMatchObject({ ok: false });
    expect(parseMessage(call(1, "ping"))).toMatchObject({ ok: true });
  });
});

describe("handleMessage", () => {
  it("negotiates a supported protocol version", async () => {
    const known = await handleMessage(call(1, "initialize", { protocolVersion: "2025-06-18" }), tools, ["ledger:read"]);
    expect(known).toMatchObject({ result: { protocolVersion: "2025-06-18", serverInfo: { name: "saveyorupee" } } });
    const unknown = await handleMessage(call(2, "initialize", { protocolVersion: "1999-01-01" }), tools, ["ledger:read"]);
    expect(unknown).toMatchObject({ result: { protocolVersion: "2025-11-25" } });
  });

  it("does not answer notifications", async () => {
    expect(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, tools, ["ledger:read"])).toBeNull();
  });

  it("lists only the tools the token's scopes allow, with JSON Schema inputs", async () => {
    const response = await handleMessage(call(1, "tools/list"), tools, ["ledger:read"]);
    const listed = (response as { result: { tools: { name: string; inputSchema: { type: string } }[] } }).result.tools;
    expect(listed.map((tool) => tool.name)).toEqual(["month_summary"]);
    expect(listed[0].inputSchema.type).toBe("object");
  });

  it("refuses a call outside the token's scopes at the HTTP layer", async () => {
    await expect(handleMessage(call(1, "tools/call", { name: "send_for_review", arguments: { text: "x" } }), tools, ["ledger:read"])).rejects.toBeInstanceOf(InsufficientScopeError);
  });

  it("returns structured results and reports bad input as a tool error", async () => {
    const ok = await handleMessage(call(1, "tools/call", { name: "month_summary", arguments: { month: "2026-10" } }), tools, ["ledger:read"]);
    expect(ok).toMatchObject({ result: { structuredContent: { month: "2026-10" }, content: [{ type: "text", text: "{\"month\":\"2026-10\"}" }] } });
    const bad = await handleMessage(call(2, "tools/call", { name: "month_summary", arguments: { month: "October" } }), tools, ["ledger:read"]);
    expect(bad).toMatchObject({ result: { isError: true } });
    const refused = await handleMessage(call(3, "tools/call", { name: "send_for_review", arguments: { text: "otp" } }), tools, ["ledger:draft"]);
    expect(refused).toMatchObject({ result: { isError: true, content: [{ text: "No OTPs." }] } });
  });

  it("answers unknown methods and tools with JSON-RPC errors", async () => {
    expect(await handleMessage(call(1, "resources/list"), tools, ["ledger:read"])).toMatchObject({ error: { code: -32601 } });
    expect(await handleMessage(call(2, "tools/call", { name: "nope" }), tools, ["ledger:read"])).toMatchObject({ error: { code: -32602 } });
  });
});
