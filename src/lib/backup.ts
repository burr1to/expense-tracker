import { z } from "zod";
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES } from "./receipts";

export const BACKUP_VERSION = "1";
export const BACKUP_HEADER = ["backup_version", "entity", "backup_id", "payload_json"] as const;
export const BACKUP_MAX_BYTES = 75 * 1024 * 1024;
export const BACKUP_MAX_RECORDS = 25_000;

const date = z.string().date();
const dateTime = z.string().datetime({ offset: true });
const nullableDate = date.nullable();
const optionalRelation = z.string().min(1).max(200).nullable();

export const backupEntitySchemas = {
  metadata: z.object({
    app: z.literal("SaveYoRupee"),
    exportedAt: dateTime,
  }),
  profile: z.object({
    displayName: z.string().trim().min(1).max(50),
    currency: z.enum(["NPR", "USD", "AUD"]),
    hideAmounts: z.boolean(),
    autoLockMinutes: z.number().int().min(0).max(120),
  }),
  custom_category: z.object({
    name: z.string().trim().min(1).max(30),
    kind: z.enum(["income", "expense", "both"]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  saved_place: z.object({
    name: z.string().trim().min(1).max(60),
    icon: z.enum(["pin", "home", "work", "food", "shopping", "health", "favorite"]),
    address: z.string().trim().max(240),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    createdAt: dateTime,
    updatedAt: dateTime,
    lastUsedAt: dateTime,
  }),
  payment_account: z.object({
    type: z.enum(["mobile_banking", "esewa", "khalti", "connect_ips"]),
    provider: z.string().trim().min(1).max(100),
    label: z.string().trim().max(60),
    balanceMinor: z.number().int(),
    balanceAsOf: date,
    balanceRecordedAt: dateTime,
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  transaction: z.object({
    kind: z.enum(["income", "expense"]),
    category: z.string().min(1).max(200),
    amountMinor: z.number().int().positive(),
    occurredOn: date,
    note: z.string().max(240),
    subcategory: z.string().max(80).nullable(),
    area: z.string().max(120).nullable(),
    paymentMode: z.enum(["cash", "cheque", "online"]),
    paymentAccountId: optionalRelation,
    locationLabel: z.string().max(120).nullable(),
    locationAddress: z.string().max(240).nullable(),
    locationLatitude: z.number().min(-90).max(90).nullable(),
    locationLongitude: z.number().min(-180).max(180).nullable(),
    locationAccuracy: z.number().int().positive().max(100_000).nullable(),
    locationSource: z.enum(["pin", "search", "current_location", "saved"]).nullable(),
    savedPlaceId: optionalRelation,
    receiptScanId: optionalRelation,
    createdAt: dateTime,
    updatedAt: dateTime,
  }).superRefine((value, context) => {
    if (value.paymentMode === "online" && !value.paymentAccountId) context.addIssue({ code: "custom", path: ["paymentAccountId"], message: "Online transactions require an account." });
    if (value.paymentMode !== "online" && value.paymentAccountId) context.addIssue({ code: "custom", path: ["paymentAccountId"], message: "Only online transactions may reference an account." });
  }),
  account_transfer: z.object({
    fromAccountId: z.string().min(1).max(200),
    toAccountId: z.string().min(1).max(200),
    amountMinor: z.number().int().positive(),
    occurredOn: date,
    note: z.string().max(240),
    createdAt: dateTime,
  }).refine((value) => value.fromAccountId !== value.toAccountId, "A transfer needs two different accounts."),
  budget: z.object({
    monthKey: z.string().regex(/^\d{4}-\d{2}$/),
    category: z.string().min(1).max(200),
    amountMinor: z.number().int().positive(),
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  recurring_entry: z.object({
    kind: z.enum(["income", "expense"]),
    category: z.string().min(1).max(200),
    amountMinor: z.number().int().positive(),
    note: z.string().max(240),
    tags: z.array(z.string().max(40)).max(8),
    dayOfMonth: z.number().int().min(1).max(28),
    nextDueOn: date,
    active: z.boolean(),
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  savings_goal: z.object({
    name: z.string().trim().min(1).max(80),
    targetMinor: z.number().int().positive(),
    savedMinor: z.number().int().min(0),
    targetDate: nullableDate,
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  savings_goal_contribution: z.object({
    goalId: z.string().min(1).max(200),
    amountMinor: z.number().int().positive(),
    isOpeningBalance: z.boolean(),
    createdAt: dateTime,
  }),
  due_item: z.object({
    kind: z.enum(["payment", "receivable", "lent", "borrowed"]),
    title: z.string().trim().min(1).max(100),
    person: z.string().max(80),
    amountMinor: z.number().int().positive(),
    category: z.string().min(1).max(200),
    occurredOn: nullableDate,
    dueOn: date,
    remindOn: nullableDate,
    snoozedUntil: nullableDate,
    note: z.string().max(300),
    status: z.enum(["open", "completed"]),
    completedOn: nullableDate,
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  due_payment: z.object({
    dueItemId: z.string().min(1).max(200),
    amountMinor: z.number().int().positive(),
    occurredOn: date,
    note: z.string().max(240),
    transactionId: optionalRelation,
    createdAt: dateTime,
  }),
  receipt: z.object({
    transactionId: optionalRelation,
    dueItemId: optionalRelation,
    name: z.string().trim().min(1).max(120),
    mimeType: z.enum(RECEIPT_TYPES as [string, ...string[]]),
    size: z.number().int().positive().max(RECEIPT_MAX_BYTES),
    contentBase64: z.string().min(1),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: dateTime,
  }).superRefine((value, context) => {
    if (Boolean(value.transactionId) === Boolean(value.dueItemId)) {
      context.addIssue({ code: "custom", message: "A receipt must belong to exactly one transaction or due." });
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value.contentBase64) || base64ByteLength(value.contentBase64) !== value.size) {
      context.addIssue({ code: "custom", path: ["contentBase64"], message: "Receipt content does not match its declared size." });
    }
  }),
  receipt_scan: z.object({
    name: z.string().trim().min(1).max(120),
    mimeType: z.enum(RECEIPT_TYPES as [string, ...string[]]),
    size: z.number().int().positive().max(RECEIPT_MAX_BYTES),
    contentBase64: z.string().min(1),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: dateTime,
  }).superRefine((value, context) => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value.contentBase64) || base64ByteLength(value.contentBase64) !== value.size) {
      context.addIssue({ code: "custom", path: ["contentBase64"], message: "Receipt content does not match its declared size." });
    }
  }),
} as const;

export type BackupEntity = keyof typeof backupEntitySchemas;
export type BackupPayload<E extends BackupEntity> = z.infer<(typeof backupEntitySchemas)[E]>;
export type BackupRecord = { entity: BackupEntity; backupId: string; payload: unknown };

export interface ParsedBackup {
  metadata: z.infer<typeof backupEntitySchemas.metadata>;
  records: BackupRecord[];
  counts: Record<string, number>;
}

function base64ByteLength(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor(value.length * 3 / 4) - padding;
}

function encodeCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function serializeBackupCsv(records: readonly BackupRecord[]) {
  return [
    BACKUP_HEADER.map(encodeCell).join(","),
    ...records.map((record) => [
      BACKUP_VERSION,
      record.entity,
      record.backupId,
      JSON.stringify(record.payload),
    ].map(encodeCell).join(",")),
  ].join("\r\n");
}

export function parseCsvRows(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (quoted) throw new Error("The backup CSV has an unclosed quoted field.");
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => value.length)) rows.push(row);
  }
  return rows;
}

function relationIds(records: readonly BackupRecord[], entity: BackupEntity) {
  return new Set(records.filter((record) => record.entity === entity).map((record) => record.backupId));
}

export function parseBackupCsv(input: string): ParsedBackup {
  if (new TextEncoder().encode(input).byteLength > BACKUP_MAX_BYTES) throw new Error("Keep backup files under 75 MB.");
  const rows = parseCsvRows(input.replace(/^\uFEFF/, ""));
  const header = rows.shift();
  if (!header || header.length !== BACKUP_HEADER.length || header.some((value, index) => value !== BACKUP_HEADER[index])) {
    throw new Error("This is not a SaveYoRupee full-backup CSV.");
  }
  if (rows.length > BACKUP_MAX_RECORDS) throw new Error(`A backup can contain at most ${BACKUP_MAX_RECORDS.toLocaleString()} records.`);

  const records: BackupRecord[] = [];
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (row.length !== 4) throw new Error(`Backup row ${index + 2} must contain four columns.`);
    const [version, rawEntity, backupId, payloadJson] = row;
    if (version !== BACKUP_VERSION) throw new Error(`Backup version ${version || "unknown"} is not supported.`);
    if (!(rawEntity in backupEntitySchemas)) throw new Error(`Backup row ${index + 2} has an unknown entity.`);
    if (!backupId || backupId.length > 200) throw new Error(`Backup row ${index + 2} has an invalid ID.`);
    const key = `${rawEntity}:${backupId}`;
    if (seen.has(key)) throw new Error(`Backup row ${index + 2} duplicates ${key}.`);
    seen.add(key);
    let decoded: unknown;
    try {
      decoded = JSON.parse(payloadJson);
    } catch {
      throw new Error(`Backup row ${index + 2} contains invalid data.`);
    }
    const entity = rawEntity as BackupEntity;
    const result = backupEntitySchemas[entity].safeParse(decoded);
    if (!result.success) throw new Error(`Backup row ${index + 2} is invalid: ${result.error.issues[0]?.message ?? "invalid data"}`);
    records.push({ entity, backupId, payload: result.data });
  }

  const metadataRows = records.filter((record) => record.entity === "metadata");
  const profileRows = records.filter((record) => record.entity === "profile");
  if (metadataRows.length !== 1 || profileRows.length !== 1) throw new Error("A backup must contain exactly one metadata row and one profile row.");

  const accountIds = relationIds(records, "payment_account");
  const placeIds = relationIds(records, "saved_place");
  const transactionIds = relationIds(records, "transaction");
  const goalIds = relationIds(records, "savings_goal");
  const dueIds = relationIds(records, "due_item");
  const receiptScanIds = relationIds(records, "receipt_scan");
  for (const record of records) {
    const payload = record.payload as Record<string, unknown>;
    const requireRelation = (field: string, ids: Set<string>) => {
      const value = payload[field];
      if (typeof value === "string" && !ids.has(value)) throw new Error(`${record.entity} ${record.backupId} references a missing ${field}.`);
    };
    if (record.entity === "transaction") {
      requireRelation("paymentAccountId", accountIds);
      requireRelation("savedPlaceId", placeIds);
      requireRelation("receiptScanId", receiptScanIds);
    } else if (record.entity === "account_transfer") {
      requireRelation("fromAccountId", accountIds);
      requireRelation("toAccountId", accountIds);
    } else if (record.entity === "savings_goal_contribution") requireRelation("goalId", goalIds);
    else if (record.entity === "due_payment") {
      requireRelation("dueItemId", dueIds);
      requireRelation("transactionId", transactionIds);
    } else if (record.entity === "receipt") {
      requireRelation("transactionId", transactionIds);
      requireRelation("dueItemId", dueIds);
    }
  }

  const counts = records.reduce<Record<string, number>>((result, record) => {
    if (record.entity !== "metadata" && record.entity !== "profile") result[record.entity] = (result[record.entity] ?? 0) + 1;
    return result;
  }, {});
  return {
    metadata: metadataRows[0].payload as z.infer<typeof backupEntitySchemas.metadata>,
    records,
    counts,
  };
}

export function isFullBackupCsv(input: string) {
  const firstLine = input.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  return firstLine.includes("backup_version") && firstLine.includes("payload_json");
}
