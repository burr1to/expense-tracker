CREATE TABLE "AccountRecovery" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "questionOneKey" TEXT NOT NULL,
  "questionOneHash" TEXT NOT NULL,
  "questionTwoKey" TEXT NOT NULL,
  "questionTwoHash" TEXT NOT NULL,
  "recoveryCodeHash" TEXT NOT NULL,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountRecovery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountRecovery_userId_key" ON "AccountRecovery"("userId");

ALTER TABLE "AccountRecovery" ADD CONSTRAINT "AccountRecovery_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccountRecovery" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AccountRecovery" FROM anon, authenticated;
