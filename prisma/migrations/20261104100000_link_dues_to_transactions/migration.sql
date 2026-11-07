-- A due can point at an entry already in the ledger: a loan's opening, or a repayment or paid bill.
-- A linked entry stays the user's own; the restore columns hold what a link changed so it can be given back.
ALTER TABLE "DueItem" ADD COLUMN "linkedTransactionId" TEXT;
ALTER TABLE "DueItem" ADD COLUMN "linkedRestoreCategory" TEXT;
ALTER TABLE "DueItem" ADD COLUMN "linkedRestoreSubcategory" TEXT;
CREATE INDEX "DueItem_linkedTransactionId_idx" ON "DueItem"("linkedTransactionId");
ALTER TABLE "DueItem" ADD CONSTRAINT "DueItem_linkedTransactionId_fkey" FOREIGN KEY ("linkedTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DuePayment" ADD COLUMN "linked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DuePayment" ADD COLUMN "linkedRestoreCategory" TEXT;
ALTER TABLE "DuePayment" ADD COLUMN "linkedRestoreSubcategory" TEXT;
