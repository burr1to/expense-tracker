import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getBetaSession } from "../../../../lib/auth";
import { getPrisma } from "../../../../lib/prisma";
import { ensureReceiptsBucket, getSupabaseStorageAdmin, RECEIPTS_BUCKET } from "../../../../lib/receipt-storage";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getBetaSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const receipt = await getPrisma().receiptAttachment.findFirst({ where: { id: (await params).id, userId: session.user.id } });
  if (!receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  if (receipt.storagePath) {
    await ensureReceiptsBucket();
    const { data, error } = await getSupabaseStorageAdmin().storage.from(RECEIPTS_BUCKET).createSignedUrl(receipt.storagePath, 60);
    if (error || !data) return NextResponse.json({ error: "Could not open receipt" }, { status: 502 });
    const storedFile = await fetch(data.signedUrl, { cache: "no-store" });
    if (!storedFile.ok || !storedFile.body) return NextResponse.json({ error: "Could not open receipt" }, { status: 502 });
    return new NextResponse(storedFile.body, { headers: { "Content-Type": receipt.mimeType, "Content-Disposition": `inline; filename="${receipt.name.replace(/["\\\r\n]/g, "_")}"`, "Cache-Control": "private, max-age=300", "Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff" } });
  }
  if (!receipt.data) return NextResponse.json({ error: "Receipt file not found" }, { status: 404 });
  return new NextResponse(Buffer.from(receipt.data), { headers: { "Content-Type": receipt.mimeType, "Content-Disposition": `inline; filename="${receipt.name.replace(/["\\\r\n]/g, "_")}"`, "Cache-Control": "private, max-age=300", "Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff" } });
}
