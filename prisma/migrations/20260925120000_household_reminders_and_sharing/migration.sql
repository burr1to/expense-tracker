-- Opt-in reminders that leave the app, plus a two-person household.
ALTER TABLE "User" ADD COLUMN "emailReminders" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "browserReminders" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "lastReminderEmailOn" DATE;

ALTER TABLE "Transaction" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Budget" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PaymentAccount" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HouseholdMember" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HouseholdMember_userId_key" ON "HouseholdMember"("userId");
CREATE UNIQUE INDEX "HouseholdMember_email_key" ON "HouseholdMember"("email");
CREATE INDEX "HouseholdMember_householdId_idx" ON "HouseholdMember"("householdId");

ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
