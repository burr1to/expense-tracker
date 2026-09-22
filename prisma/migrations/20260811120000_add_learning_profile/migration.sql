CREATE TABLE "LearningProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "suggestions" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "lastCreatedAt" TIMESTAMP(3),
    "lastTransactionId" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearningProfile_userId_key" ON "LearningProfile"("userId");

ALTER TABLE "LearningProfile" ADD CONSTRAINT "LearningProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
