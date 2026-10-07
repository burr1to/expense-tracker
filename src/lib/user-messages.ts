/** Plain-language messages for failures people can act on, shared by the client and the API routes. */

export const CONNECTION_MESSAGE = "No connection. Check your signal and try again — your entry is still here.";
export const SERVER_BUSY_MESSAGE = "The server is busy. Try again in a moment.";
export const SIGNED_OUT_MESSAGE = "You were signed out. Reload the page and sign in again — your entry is still here until you leave.";
export const UNCONFIRMED_SAVE_MESSAGE = "We couldn’t confirm the save because the connection dropped. Tapping Save again won’t create a duplicate.";
export const UNCONFIRMED_CHANGE_MESSAGE = "We couldn’t confirm this change because the connection dropped. Refresh to check whether it went through before trying again.";
export const CHANGED_ELSEWHERE_MESSAGE = "This entry was changed or deleted on another device. Refresh to see the latest.";
export const ALREADY_EXISTS_MESSAGE = "That already exists. Refresh to see the latest.";
export const SERVER_FAILURE_MESSAGE = "Something went wrong on our side. Refresh to check your latest entries, then try again.";
export const UNREADABLE_REQUEST_MESSAGE = "That request could not be read. Refresh the page and try again.";
export const CANT_REACH_MESSAGE = "Can’t reach SaveYoRupee right now. Check your connection.";

/** A response body read as text first, so a proxy's HTML error page never surfaces as a JSON parse error. */
export interface ParsedResponse<T = unknown> { status: number; ok: boolean; body: T | null; json: boolean }

export async function readResponse<T = unknown>(response: Response): Promise<ParsedResponse<T>> {
  const text = await response.text();
  try {
    return { status: response.status, ok: response.ok, body: JSON.parse(text) as T, json: true };
  } catch {
    return { status: response.status, ok: response.ok, body: null, json: false };
  }
}

const errorName = (error: unknown) => typeof error === "object" && error !== null && "name" in error ? String((error as { name?: unknown }).name) : "";

/** fetch rejects with a TypeError when the request never completes; an aborted or timed-out request rejects by name. */
export function isConnectionError(error: unknown) {
  return error instanceof TypeError || errorName(error) === "AbortError" || errorName(error) === "TimeoutError";
}

const bodyError = (body: unknown) => typeof body === "object" && body !== null && "error" in body && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error.trim() : "";

/** What a failed response means for the person: signed out, a busy server, or the server's own message. */
export function responseMessage(response: Pick<ParsedResponse, "status" | "body" | "json">, fallback: string) {
  const message = bodyError(response.body);
  // Wrong PINs and passwords also answer 401, with their own message; only a missing session means signed out.
  if (response.status === 401 && (!message || message === "Unauthorized")) return SIGNED_OUT_MESSAGE;
  if (!response.json) return SERVER_BUSY_MESSAGE;
  if (message) return message;
  if (response.status >= 500) return SERVER_BUSY_MESSAGE;
  return fallback;
}

export function toUserMessage(error: unknown, response?: Pick<ParsedResponse, "status" | "body" | "json"> | null, fallback = "Something went wrong. Try again.") {
  if (response) return responseMessage(response, fallback);
  if (isConnectionError(error)) return CONNECTION_MESSAGE;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

// Repeating these after a lost response cannot record anything twice (the server dedupes them, or they set a value).
const RETRY_SAFE_ACTIONS = new Set(["saveReceiptSplit", "saveBudgets", "updateProfile", "snoozeDueItem", "setPaymentAccountShared", "updatePaymentAccountTail", "listImportJobs", "processImportJob"]);
// An id usually means "set this record", but these add to it on every call and are safe only with a request id.
const ADDS_TO_RECORD = new Set(["contributeToGoal", "recordDuePayment"]);

/** Whether repeating a ledger action whose answer was lost cannot record it twice. */
export function retrySafeAction(action: string, payload: unknown, id?: string) {
  if (typeof payload === "object" && payload !== null && typeof (payload as { clientRequestId?: unknown }).clientRequestId === "string") return true;
  return (Boolean(id) && !ADDS_TO_RECORD.has(action)) || RETRY_SAFE_ACTIONS.has(action);
}

/** After a lost or timed-out save: a retry is only promised to be safe when the server dedupes it. */
export function unconfirmedMessage(retrySafe: boolean) {
  return retrySafe ? UNCONFIRMED_SAVE_MESSAGE : UNCONFIRMED_CHANGE_MESSAGE;
}

/** AbortSignal.timeout where the browser has it, otherwise an equivalent controller. */
export function timeoutSignal(milliseconds: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(milliseconds);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}

/**
 * How an API route should answer an error it did not handle itself. Messages thrown on purpose with a plain
 * `new Error(...)` and validation failures are the person's to fix (400). Database and library errors never
 * reach the person verbatim: they can carry connection strings or host names, so they get a generic 500.
 */
export function serverErrorResponse(error: unknown): { status: number; message: string; unexpected: boolean } {
  if (errorName(error) === "ZodError" && typeof error === "object" && error !== null && Array.isArray((error as { issues?: unknown }).issues)) {
    const issue = (error as { issues: { message?: unknown }[] }).issues[0];
    return { status: 400, message: typeof issue?.message === "string" && issue.message ? issue.message : "Check the details and try again.", unexpected: false };
  }
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "P2025") return { status: 404, message: CHANGED_ELSEWHERE_MESSAGE, unexpected: false };
  if (code === "P2002") return { status: 409, message: ALREADY_EXISTS_MESSAGE, unexpected: false };
  if (error instanceof SyntaxError) return { status: 400, message: UNREADABLE_REQUEST_MESSAGE, unexpected: false };
  if (error instanceof Error && Object.getPrototypeOf(error) === Error.prototype && code === undefined && error.message.trim()) return { status: 400, message: error.message, unexpected: false };
  return { status: 500, message: SERVER_FAILURE_MESSAGE, unexpected: true };
}
