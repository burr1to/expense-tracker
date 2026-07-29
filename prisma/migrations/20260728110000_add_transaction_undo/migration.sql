ALTER TABLE "Transaction"
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Transaction_userId_deletedAt_idx"
ON "Transaction"("userId", "deletedAt");
