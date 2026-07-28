ALTER TABLE "RecurringEntry"
  ADD COLUMN "recurrenceUnit" TEXT NOT NULL DEFAULT 'month',
  ADD COLUMN "recurrenceInterval" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "anchorDate" DATE;

UPDATE "RecurringEntry"
SET "anchorDate" = "nextDueOn";

ALTER TABLE "RecurringEntry"
  ALTER COLUMN "anchorDate" SET NOT NULL,
  ALTER COLUMN "dayOfMonth" DROP NOT NULL;
