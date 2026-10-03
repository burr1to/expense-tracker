-- Append-only activity log shown in the app as Logs. Kept for 90 days.
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "entityId" TEXT,
    "title" TEXT NOT NULL,
    "subject" TEXT,
    "amountMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'NPR',
    "changes" JSONB,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActivityLog_userId_createdAt_id_idx" ON "ActivityLog"("userId", "createdAt" DESC, "id" DESC);
CREATE INDEX "ActivityLog_userId_area_createdAt_idx" ON "ActivityLog"("userId", "area", "createdAt" DESC);

ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The app reads and writes through authenticated server routes and Prisma only.
ALTER TABLE "ActivityLog" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ActivityLog" FROM anon, authenticated;
