import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES } from "./receipts";

export const RECEIPTS_BUCKET = process.env.SUPABASE_RECEIPTS_BUCKET?.trim() || "receipts";

let adminClient: SupabaseClient | null = null;
let bucketPromise: Promise<void> | null = null;

function required(name: "SUPABASE_URL" | "SUPABASE_PUBLISHABLE_KEY") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function storageSecret() {
  const value = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!value) throw new Error("SUPABASE_SECRET_KEY is not configured.");
  return value;
}

export function getSupabaseStorageAdmin() {
  if (!adminClient) {
    const secret = storageSecret();
    const storageFetch: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      if (secret.startsWith("sb_secret_") && headers.get("Authorization") === `Bearer ${secret}`) headers.delete("Authorization");
      return fetch(input, { ...init, headers });
    };
    adminClient = createClient(required("SUPABASE_URL"), secret, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { fetch: storageFetch },
    });
  }
  return adminClient;
}

export function getStoragePublicConfig() {
  return { publishableKey: required("SUPABASE_PUBLISHABLE_KEY") };
}

export async function ensureReceiptsBucket() {
  if (!bucketPromise) {
    bucketPromise = (async () => {
      const storage = getSupabaseStorageAdmin().storage;
      const { data, error } = await storage.getBucket(RECEIPTS_BUCKET);
      if (!error && data) {
        const updated = await storage.updateBucket(RECEIPTS_BUCKET, {
          public: false,
          fileSizeLimit: RECEIPT_MAX_BYTES,
          allowedMimeTypes: RECEIPT_TYPES,
        });
        if (updated.error) throw new Error(`Could not secure the receipt bucket: ${updated.error.message}`);
        return;
      }
      const status = error && "status" in error ? error.status : undefined;
      if (status !== 400 && status !== 404) throw new Error(`Could not inspect the receipt bucket: ${error.message}`);
      const created = await storage.createBucket(RECEIPTS_BUCKET, {
        public: false,
        fileSizeLimit: RECEIPT_MAX_BYTES,
        allowedMimeTypes: RECEIPT_TYPES,
      });
      if (created.error) throw new Error(`Could not create the receipt bucket: ${created.error.message}`);
    })().catch((error) => {
      bucketPromise = null;
      throw error;
    });
  }
  return bucketPromise;
}

const extensionByMimeType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function newReceiptPath(userId: string, mimeType: string) {
  const extension = extensionByMimeType[mimeType];
  if (!extension) throw new Error("Unsupported receipt type.");
  return `${userId}/${crypto.randomUUID()}.${extension}`;
}

export function isOwnedReceiptPath(path: string, userId: string) {
  return path.startsWith(`${userId}/`) && !path.includes("..") && path.length <= 300;
}

export async function verifyStoredReceipt(path: string, userId: string, mimeType: string, expectedSize: number) {
  if (!isOwnedReceiptPath(path, userId)) throw new Error("Invalid receipt storage path.");
  await ensureReceiptsBucket();
  const { data, error } = await getSupabaseStorageAdmin().storage.from(RECEIPTS_BUCKET).info(path);
  if (error || !data) throw new Error("The uploaded receipt could not be found.");
  if (!data.size || data.size > RECEIPT_MAX_BYTES || data.size !== expectedSize) throw new Error("The uploaded receipt size did not match.");
  if (data.contentType && data.contentType !== mimeType) throw new Error("The uploaded receipt type did not match.");
}

export async function removeStoredReceipts(paths: Array<string | null | undefined>) {
  const present = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  if (!present.length) return;
  await ensureReceiptsBucket();
  const { error } = await getSupabaseStorageAdmin().storage.from(RECEIPTS_BUCKET).remove(present);
  if (error) throw new Error(`Could not remove receipt storage: ${error.message}`);
}
