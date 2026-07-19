CREATE TABLE "SavingsGoalContribution" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "goalId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "isOpeningBalance" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavingsGoalContribution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavingsGoalContribution_userId_idx"
ON "SavingsGoalContribution"("userId");

CREATE INDEX "SavingsGoalContribution_goalId_createdAt_idx"
ON "SavingsGoalContribution"("goalId", "createdAt");

ALTER TABLE "SavingsGoalContribution"
ADD CONSTRAINT "SavingsGoalContribution_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SavingsGoalContribution"
ADD CONSTRAINT "SavingsGoalContribution_goalId_fkey"
FOREIGN KEY ("goalId") REFERENCES "SavingsGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing saved balances as an opening contribution so every goal
-- has a complete, visible history from the point this feature is introduced.
INSERT INTO "SavingsGoalContribution" ("id", "userId", "goalId", "amountMinor", "isOpeningBalance", "createdAt")
SELECT CONCAT("id", '_opening'), "userId", "id", "savedMinor", true, "createdAt"
FROM "SavingsGoal"
WHERE "savedMinor" > 0;

ALTER TABLE "SavingsGoalContribution" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "SavingsGoalContribution" FROM anon, authenticated;
