CREATE TABLE "ReceiptAttachment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT,
    "dueItemId" TEXT,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReceiptAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReceiptAttachment_transactionId_key" ON "ReceiptAttachment"("transactionId");
CREATE UNIQUE INDEX "ReceiptAttachment_dueItemId_key" ON "ReceiptAttachment"("dueItemId");
CREATE INDEX "ReceiptAttachment_userId_idx" ON "ReceiptAttachment"("userId");

ALTER TABLE "ReceiptAttachment" ADD CONSTRAINT "ReceiptAttachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceiptAttachment" ADD CONSTRAINT "ReceiptAttachment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceiptAttachment" ADD CONSTRAINT "ReceiptAttachment_dueItemId_fkey" FOREIGN KEY ("dueItemId") REFERENCES "DueItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
