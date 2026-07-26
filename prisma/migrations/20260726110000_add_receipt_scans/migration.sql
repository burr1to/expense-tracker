CREATE TABLE "ReceiptScan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptScan_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Transaction" ADD COLUMN "receiptScanId" TEXT;

CREATE UNIQUE INDEX "ReceiptScan_storagePath_key" ON "ReceiptScan"("storagePath");
CREATE INDEX "ReceiptScan_userId_idx" ON "ReceiptScan"("userId");
CREATE INDEX "Transaction_receiptScanId_idx" ON "Transaction"("receiptScanId");

ALTER TABLE "ReceiptScan"
ADD CONSTRAINT "ReceiptScan_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_receiptScanId_fkey"
FOREIGN KEY ("receiptScanId") REFERENCES "ReceiptScan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
