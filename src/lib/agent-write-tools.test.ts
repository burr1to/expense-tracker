import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { handleMessage, InsufficientScopeError, type JsonRpcRequest, type ToolDefinition } from "./mcp-protocol";

const runLedgerAction = vi.hoisted(() => vi.fn());
vi.mock("./ledger-actions", () => ({ runLedgerAction }));
vi.mock("./receipt-storage", () => ({}));

const { ledgerWriteTools } = await import("./agent-write-tools");

const principal = { userId: "u1", grantId: "g1", clientName: "Muse", scopes: ["ledger:write" as const] };
const call = (name: string, args: Record<string, unknown>): JsonRpcRequest => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
const logged = [{ title: "Added an expense", subject: "Viral Mart", changes: [] }];

function fakeDb() {
  return {
    transaction: { findFirst: vi.fn() },
    accountTransfer: { findFirst: vi.fn() },
    agentDraft: { findFirst: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}

describe("Muse write tools", () => {
  let db: ReturnType<typeof fakeDb>;
  let tools: ToolDefinition[];
  beforeEach(() => {
    runLedgerAction.mockReset().mockResolvedValue(NextResponse.json({ activity: logged }));
    db = fakeDb();
    tools = ledgerWriteTools(db as unknown as PrismaClient, principal, "https://app.example");
  });

  it("are neither listed nor callable without ledger:write", async () => {
    const listed = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, tools, ["ledger:read", "ledger:draft"]);
    expect(listed).toMatchObject({ result: { tools: [] } });
    await expect(handleMessage(call("delete_transaction", { id: "t1" }), tools, ["ledger:read"])).rejects.toBeInstanceOf(InsufficientScopeError);
  });

  it("marks only the delete tools destructive", async () => {
    const listed = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, tools, ["ledger:write"]) as { result: { tools: { name: string; annotations: { destructiveHint: boolean } }[] } };
    expect(listed.result.tools.filter((tool) => tool.annotations.destructiveHint).map((tool) => tool.name)).toEqual(["delete_transaction", "delete_transfer"]);
  });

  it("adds an entry through the ledger action as Muse and takes its draft out of the queue", async () => {
    db.agentDraft.findFirst.mockResolvedValue({ id: "d1", status: "pending" });
    db.transaction.findFirst.mockResolvedValue({ id: "t9" });
    const response = await handleMessage(call("add_transaction", {
      kind: "expense", category: "shopping", amount_minor: 159000, date: "2026-11-12", note: "Viral Mart", payment: "online", account_id: "acc1", draft_id: "d1",
    }), tools, ["ledger:write"]);
    expect(runLedgerAction).toHaveBeenCalledWith("u1", {
      action: "saveTransaction", id: undefined,
      payload: { kind: "expense", category: "shopping", subcategory: null, amountMinor: 159000, occurredOn: "2026-11-12", note: "Viral Mart", area: null, paymentMode: "online", paymentAccountId: "acc1", clientRequestId: "agent-draft:d1" },
    }, { origin: "https://app.example", agent: "Muse" });
    expect(db.agentDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "d1", userId: "u1", status: "pending" }, data: expect.objectContaining({ status: "approved", transactionId: "t9", text: "" }) }));
    expect(response).toMatchObject({ result: { structuredContent: { status: "saved", transaction_id: "t9" } } });
  });

  it("does not save a draft the user already reviewed", async () => {
    db.agentDraft.findFirst.mockResolvedValue({ id: "d1", status: "dismissed" });
    const response = await handleMessage(call("add_transaction", { kind: "expense", category: "food", amount_minor: 30000, date: "2026-11-12", note: "Mira's Coffee", payment: "cash", draft_id: "d1" }), tools, ["ledger:write"]);
    expect(runLedgerAction).not.toHaveBeenCalled();
    expect(response).toMatchObject({ result: { structuredContent: { status: "already_reviewed" } } });
  });

  it("edits only the fields sent and keeps the entry's place", async () => {
    db.transaction.findFirst.mockResolvedValue({
      id: "t1", kind: "expense", category: "other", subcategory: "Misc", amountMinor: 32100, occurredOn: new Date("2026-11-12T00:00:00Z"), note: "Remarks 1",
      area: null, paymentMode: "online", paymentAccountId: "acc1", shared: false,
      locationLabel: "Moki Cafe", locationAddress: "Jhamsikhel", locationLatitude: 27.68, locationLongitude: 85.31, locationAccuracy: 20, locationSource: "pin", savedPlaceId: null,
    });
    await handleMessage(call("edit_transaction", { id: "t1", category: "food" }), tools, ["ledger:write"]);
    expect(runLedgerAction).toHaveBeenCalledWith("u1", expect.objectContaining({
      action: "saveTransaction", id: "t1",
      payload: expect.objectContaining({ category: "food", subcategory: null, amountMinor: 32100, occurredOn: "2026-11-12", note: "Remarks 1", paymentAccountId: "acc1", location: expect.objectContaining({ label: "Moki Cafe", latitude: 27.68 }) }),
    }), expect.anything());
  });

  it("returns a ledger refusal to the agent as a tool error", async () => {
    runLedgerAction.mockResolvedValue(NextResponse.json({ error: "Both transfer accounts must belong to you." }, { status: 400 }));
    const response = await handleMessage(call("add_transfer", { from_account_id: "a", to_account_id: "b", amount_minor: 100000, date: "2026-11-12" }), tools, ["ledger:write"]);
    expect(response).toMatchObject({ result: { isError: true, content: [{ text: "Both transfer accounts must belong to you." }] } });
  });

  it("will not delete an entry outside the user's own ledger", async () => {
    db.transaction.findFirst.mockResolvedValue(null);
    const response = await handleMessage(call("delete_transaction", { id: "someone-elses" }), tools, ["ledger:write"]);
    expect(runLedgerAction).not.toHaveBeenCalled();
    expect(response).toMatchObject({ result: { isError: true } });
  });
});
