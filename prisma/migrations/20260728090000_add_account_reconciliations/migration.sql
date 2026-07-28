CREATE TABLE "AccountReconciliation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "paymentAccountId" TEXT NOT NULL,
  "monthKey" TEXT NOT NULL,
  "checkedOn" DATE NOT NULL,
  "startingBalanceMinor" INTEGER NOT NULL,
  "startingBalanceAsOf" DATE NOT NULL,
  "incomeMinor" INTEGER NOT NULL,
  "expenseMinor" INTEGER NOT NULL,
  "transfersInMinor" INTEGER NOT NULL,
  "transfersOutMinor" INTEGER NOT NULL,
  "expectedBalanceMinor" INTEGER NOT NULL,
  "actualBalanceMinor" INTEGER NOT NULL,
  "adjustmentMinor" INTEGER NOT NULL,
  "adjustmentNote" TEXT NOT NULL DEFAULT '',
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AccountReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountReconciliation_paymentAccountId_monthKey_key"
  ON "AccountReconciliation"("paymentAccountId", "monthKey");
CREATE INDEX "AccountReconciliation_userId_approvedAt_idx"
  ON "AccountReconciliation"("userId", "approvedAt");

ALTER TABLE "AccountReconciliation"
  ADD CONSTRAINT "AccountReconciliation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountReconciliation"
  ADD CONSTRAINT "AccountReconciliation_paymentAccountId_fkey"
  FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
