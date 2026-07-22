ALTER TABLE "PaymentAccount"
  ADD COLUMN "balanceMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "balanceAsOf" DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN "balanceRecordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "AccountTransfer" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fromAccountId" TEXT NOT NULL,
  "toAccountId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "occurredOn" DATE NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountTransfer_userId_occurredOn_idx" ON "AccountTransfer"("userId", "occurredOn");
CREATE INDEX "AccountTransfer_fromAccountId_idx" ON "AccountTransfer"("fromAccountId");
CREATE INDEX "AccountTransfer_toAccountId_idx" ON "AccountTransfer"("toAccountId");
ALTER TABLE "AccountTransfer" ADD CONSTRAINT "AccountTransfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountTransfer" ADD CONSTRAINT "AccountTransfer_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "PaymentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountTransfer" ADD CONSTRAINT "AccountTransfer_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "PaymentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountTransfer" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PaymentAccount", "AccountTransfer" FROM anon, authenticated;
