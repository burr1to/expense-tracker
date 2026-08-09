BEGIN;

CREATE TABLE "ImportJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "totalRows" INTEGER NOT NULL,
  "processedRows" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "createdCategoryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdSubcategoryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "error" TEXT,
  "lockExpiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Transaction" ADD COLUMN "importJobId" TEXT;

CREATE INDEX "ImportJob_userId_status_idx" ON "ImportJob"("userId", "status");
CREATE INDEX "Transaction_importJobId_idx" ON "Transaction"("importJobId");

ALTER TABLE "ImportJob"
ADD CONSTRAINT "ImportJob_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_importJobId_fkey"
FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
