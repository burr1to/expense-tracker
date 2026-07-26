import type { ReceiptUpload } from "../types";

export const RECEIPT_MAX_BYTES = 3 * 1024 * 1024;
export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const CAMERA_RECEIPT_MAX_SOURCE_BYTES = 20 * 1024 * 1024;

interface SignedUploadResponse {
  path: string;
  signedUrl: string;
  publishableKey: string;
}

export async function uploadReceipt(file: File, signal?: AbortSignal): Promise<ReceiptUpload> {
  if (!RECEIPT_TYPES.includes(file.type)) throw new Error("Use a JPG, PNG, WebP, or PDF receipt.");
  if (!file.size) throw new Error("This receipt file is empty.");
  if (file.size > RECEIPT_MAX_BYTES) throw new Error("Keep receipt files under 3 MB.");

  const name = file.name.slice(0, 120);
  const ticketResponse = await fetch("/api/receipts/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: file.type, size: file.size }),
    signal,
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
    signal,
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
    keepalive: true,
  });
  if (!response.ok && response.status !== 404) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "Could not discard this receipt.");
  }
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not prepare this receipt photo.")), "image/jpeg", quality);
  });
}

/**
 * Re-encodes a camera image before upload. Besides keeping mobile photos below
 * the receipt limit, drawing through canvas removes EXIF/GPS metadata.
 */
export async function prepareReceiptPhoto(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use a JPG, PNG, or WebP receipt photo.");
  if (!file.size) throw new Error("This receipt photo is empty.");
  if (file.size > CAMERA_RECEIPT_MAX_SOURCE_BYTES) throw new Error("Keep original receipt photos under 20 MB.");

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const longestSide = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, 2200 / longestSide);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare this receipt photo.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    let blob = await canvasBlob(canvas, 0.86);
    for (const quality of [0.76, 0.66, 0.56]) {
      if (blob.size <= RECEIPT_MAX_BYTES) break;
      blob = await canvasBlob(canvas, quality);
    }
    if (blob.size > RECEIPT_MAX_BYTES) throw new Error("This photo is still too large. Move closer to the receipt and try again.");
    const baseName = file.name.replace(/\.[^.]+$/, "").slice(0, 105) || "receipt";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}
