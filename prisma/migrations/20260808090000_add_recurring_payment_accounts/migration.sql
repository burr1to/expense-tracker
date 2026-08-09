ALTER TABLE "RecurringEntry"
  ADD COLUMN "paymentAccountId" TEXT;

CREATE INDEX "RecurringEntry_paymentAccountId_idx"
  ON "RecurringEntry"("paymentAccountId");

ALTER TABLE "RecurringEntry"
  ADD CONSTRAINT "RecurringEntry_paymentAccountId_fkey"
  FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
