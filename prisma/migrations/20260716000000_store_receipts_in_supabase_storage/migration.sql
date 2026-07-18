ALTER TABLE "ReceiptAttachment"
  ADD COLUMN "storagePath" TEXT,
  ALTER COLUMN "data" DROP NOT NULL;

CREATE UNIQUE INDEX "ReceiptAttachment_storagePath_key" ON "ReceiptAttachment"("storagePath");
