import type { ReceiptUpload } from "../types";

export const RECEIPT_MAX_BYTES = 3 * 1024 * 1024;
export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

interface SignedUploadResponse {
  path: string;
  signedUrl: string;
  publishableKey: string;
}

export async function uploadReceipt(file: File): Promise<ReceiptUpload> {
  if (!RECEIPT_TYPES.includes(file.type)) throw new Error("Use a JPG, PNG, WebP, or PDF receipt.");
  if (!file.size) throw new Error("This receipt file is empty.");
  if (file.size > RECEIPT_MAX_BYTES) throw new Error("Keep receipt files under 3 MB.");

  const name = file.name.slice(0, 120);
  const ticketResponse = await fetch("/api/receipts/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: file.type, size: file.size }),
  });
  const ticket = await ticketResponse.json() as SignedUploadResponse & { error?: string };
  if (!ticketResponse.ok) throw new Error(ticket.error ?? "Could not prepare this receipt upload.");

  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", file);
  const uploadResponse = await fetch(ticket.signedUrl, {
    method: "PUT",
    headers: {
      apikey: ticket.publishableKey,
      "x-upsert": "false",
    },
    body: form,
  });
  if (!uploadResponse.ok) {
    const body = await uploadResponse.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(body?.message ?? body?.error ?? "Could not upload this receipt.");
  }

  return { name, mimeType: file.type, size: file.size, storagePath: ticket.path };
}

export async function discardReceipt(receipt: ReceiptUpload) {
  const response = await fetch("/api/receipts/upload", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storagePath: receipt.storagePath }),
  });
  if (!response.ok && response.status !== 404) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "Could not discard this receipt.");
  }
}
