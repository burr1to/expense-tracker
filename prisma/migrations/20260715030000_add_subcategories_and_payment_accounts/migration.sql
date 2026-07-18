-- Replace transaction tags with optional category detail and required payment mode.
ALTER TABLE "Transaction"
  DROP COLUMN "tags",
  ADD COLUMN "subcategory" TEXT,
  ADD COLUMN "area" TEXT,
  ADD COLUMN "paymentMode" TEXT NOT NULL DEFAULT 'cash',
  ADD COLUMN "paymentAccountId" TEXT;

CREATE TABLE "PaymentAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentAccount_userId_idx" ON "PaymentAccount"("userId");
CREATE INDEX "Transaction_paymentAccountId_idx" ON "Transaction"("paymentAccountId");
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
