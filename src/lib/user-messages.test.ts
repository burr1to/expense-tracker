import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ALREADY_EXISTS_MESSAGE,
  CHANGED_ELSEWHERE_MESSAGE,
  CONNECTION_MESSAGE,
  isConnectionError,
  readResponse,
  responseMessage,
  SERVER_BUSY_MESSAGE,
  SERVER_FAILURE_MESSAGE,
  serverErrorResponse,
  SIGNED_OUT_MESSAGE,
  timeoutSignal,
  toUserMessage,
  UNCONFIRMED_CHANGE_MESSAGE,
  UNCONFIRMED_SAVE_MESSAGE,
  unconfirmedMessage,
  UNREADABLE_REQUEST_MESSAGE,
} from "./user-messages";

const named = (name: string) => Object.assign(new Error("aborted"), { name });

describe("toUserMessage", () => {
  it("explains a dropped connection, an abort and a timeout without blaming the person", () => {
    expect(toUserMessage(new TypeError("Failed to fetch"))).toBe(CONNECTION_MESSAGE);
    expect(toUserMessage(named("AbortError"))).toBe(CONNECTION_MESSAGE);
    expect(toUserMessage(named("TimeoutError"))).toBe(CONNECTION_MESSAGE);
    expect(CONNECTION_MESSAGE).toMatch(/your entry is still here/);
  });

  it("says the server is busy when the body is not JSON, such as a proxy's HTML error page", () => {
    expect(toUserMessage(null, { status: 502, body: null, json: false })).toBe(SERVER_BUSY_MESSAGE);
    expect(toUserMessage(null, { status: 200, body: null, json: false })).toBe(SERVER_BUSY_MESSAGE);
  });

  it("treats only a missing session as signed out, not a wrong PIN or password", () => {
    expect(toUserMessage(null, { status: 401, body: { error: "Unauthorized" }, json: true })).toBe(SIGNED_OUT_MESSAGE);
    expect(toUserMessage(null, { status: 401, body: null, json: false })).toBe(SIGNED_OUT_MESSAGE);
    expect(toUserMessage(null, { status: 401, body: { error: "Current PIN did not match." }, json: true })).toBe("Current PIN did not match.");
  });

  it("keeps the server's own message, and falls back when there is none", () => {
    expect(toUserMessage(null, { status: 400, body: { error: "Choose an online payment account." }, json: true })).toBe("Choose an online payment account.");
    expect(toUserMessage(null, { status: 400, body: {}, json: true }, "Could not save.")).toBe("Could not save.");
    expect(toUserMessage(null, { status: 503, body: {}, json: true }, "Could not save.")).toBe(SERVER_BUSY_MESSAGE);
  });

  it("passes a thrown message through and falls back for anything else", () => {
    expect(toUserMessage(new Error("That PIN did not match."))).toBe("That PIN did not match.");
    expect(toUserMessage("boom", null, "Could not load.")).toBe("Could not load.");
    expect(toUserMessage(new Error("  "), null, "Could not load.")).toBe("Could not load.");
  });
});

describe("response helpers", () => {
  it("reads JSON bodies and survives HTML ones", async () => {
    expect(await readResponse(new Response(JSON.stringify({ error: "Nope" }), { status: 400 }))).toEqual({ status: 400, ok: false, body: { error: "Nope" }, json: true });
    expect(await readResponse(new Response("<html>Bad gateway</html>", { status: 502 }))).toEqual({ status: 502, ok: false, body: null, json: false });
    expect(await readResponse(new Response("", { status: 504 }))).toEqual({ status: 504, ok: false, body: null, json: false });
  });

  it("maps a response straight to a message", () => {
    expect(responseMessage({ status: 429, body: { error: "You've used today's 20 receipt scans." }, json: true }, "x")).toBe("You've used today's 20 receipt scans.");
  });

  it("recognises connection failures only", () => {
    expect(isConnectionError(new TypeError("Load failed"))).toBe(true);
    expect(isConnectionError(named("TimeoutError"))).toBe(true);
    expect(isConnectionError(new Error("Choose an account."))).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });

  it("promises a safe retry only when the server dedupes it", () => {
    expect(unconfirmedMessage(true)).toBe(UNCONFIRMED_SAVE_MESSAGE);
    expect(UNCONFIRMED_SAVE_MESSAGE).toMatch(/won’t create a duplicate/);
    expect(unconfirmedMessage(false)).toBe(UNCONFIRMED_CHANGE_MESSAGE);
  });

  it("aborts after the timeout", async () => {
    const signal = timeoutSignal(5);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(signal.aborted).toBe(true);
  });
});

describe("serverErrorResponse", () => {
  it("keeps validation messages at 400", () => {
    const parsed = z.object({ amount: z.number({ message: "Enter an amount." }) }).safeParse({});
    expect(serverErrorResponse(parsed.error)).toEqual({ status: 400, message: "Enter an amount.", unexpected: false });
    expect(serverErrorResponse(new Error("Choose two different accounts."))).toEqual({ status: 400, message: "Choose two different accounts.", unexpected: false });
    expect(serverErrorResponse(new SyntaxError("Unexpected token"))).toEqual({ status: 400, message: UNREADABLE_REQUEST_MESSAGE, unexpected: false });
  });

  it("explains a record that vanished or already exists", () => {
    expect(serverErrorResponse(Object.assign(new Error("No record was found for a query."), { code: "P2025" }))).toEqual({ status: 404, message: CHANGED_ELSEWHERE_MESSAGE, unexpected: false });
    expect(serverErrorResponse(Object.assign(new Error("Unique constraint failed on the fields: (`userId`,`name`)"), { code: "P2002" }))).toEqual({ status: 409, message: ALREADY_EXISTS_MESSAGE, unexpected: false });
  });

  it("never leaks database or library details", () => {
    class PrismaClientInitializationError extends Error {}
    const hostLeak = new PrismaClientInitializationError("Can't reach database server at `db.abcdefgh.supabase.co:5432`");
    expect(serverErrorResponse(hostLeak)).toEqual({ status: 500, message: SERVER_FAILURE_MESSAGE, unexpected: true });
    expect(serverErrorResponse(Object.assign(new Error("connect ECONNREFUSED 10.0.0.4:5432"), { code: "ECONNREFUSED" }))).toMatchObject({ status: 500, unexpected: true });
    expect(serverErrorResponse(Object.assign(new Error("P1001: Can't reach database server"), { code: "P1001" }))).toMatchObject({ status: 500, message: SERVER_FAILURE_MESSAGE });
    expect(serverErrorResponse(new TypeError("Cannot read properties of undefined"))).toMatchObject({ status: 500 });
    expect(serverErrorResponse("boom")).toMatchObject({ status: 500 });
  });
});
