ALTER TABLE "DueItem" ADD COLUMN "snoozedUntil" DATE;

CREATE INDEX "DueItem_userId_snoozedUntil_idx" ON "DueItem"("userId", "snoozedUntil");
