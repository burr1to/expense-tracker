-- A client-generated id per save, so a retry after a lost response returns the
-- row that was already written instead of creating a duplicate.
ALTER TABLE "Transaction" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "Transaction_userId_clientRequestId_key" ON "Transaction"("userId", "clientRequestId");

ALTER TABLE "AccountTransfer" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "AccountTransfer_userId_clientRequestId_key" ON "AccountTransfer"("userId", "clientRequestId");

ALTER TABLE "DuePayment" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "DuePayment_userId_clientRequestId_key" ON "DuePayment"("userId", "clientRequestId");
CREATE INDEX "DuePayment_dueItemId_idx" ON "DuePayment"("dueItemId");

-- Last digits of the account number as printed in bank SMS, used to match alerts to accounts.
ALTER TABLE "PaymentAccount" ADD COLUMN "accountTail" TEXT;

-- Daily Gemini usage per user and feature.
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "feature" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiUsage_userId_day_feature_key" ON "AiUsage"("userId", "day", "feature");

ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The app reads and writes through authenticated server routes and Prisma only.
ALTER TABLE "AiUsage" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AiUsage" FROM anon, authenticated;
