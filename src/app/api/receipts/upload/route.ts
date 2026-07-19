import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getBetaSession } from "../../../../lib/auth";
import { getPrisma } from "../../../../lib/prisma";
import { ensureReceiptsBucket, getStoragePublicConfig, getSupabaseStorageAdmin, isOwnedReceiptPath, newReceiptPath, RECEIPTS_BUCKET, removeStoredReceipts } from "../../../../lib/receipt-storage";
import { RECEIPT_MAX_BYTES } from "../../../../lib/receipts";

export const dynamic = "force-dynamic";

const uploadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  size: z.number().int().positive().max(RECEIPT_MAX_BYTES),
});

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getBetaSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const input = uploadSchema.parse(await request.json());
    await ensureReceiptsBucket();
    const path = newReceiptPath(session.user.id, input.mimeType);
    const { data, error } = await getSupabaseStorageAdmin().storage.from(RECEIPTS_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message ?? "Could not create an upload URL.");
    return NextResponse.json({ path, signedUrl: data.signedUrl, ...getStoragePublicConfig() });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Could not prepare this upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getBetaSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { storagePath } = z.object({ storagePath: z.string().min(1).max(300) }).parse(await request.json());
    if (!isOwnedReceiptPath(storagePath, session.user.id)) return NextResponse.json({ error: "Invalid receipt storage path." }, { status: 403 });
    const attached = await getPrisma().receiptAttachment.count({ where: { userId: session.user.id, storagePath } });
    if (attached) return NextResponse.json({ error: "Attached receipts cannot be discarded." }, { status: 409 });
    await removeStoredReceipts([storagePath]);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Could not discard this upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
