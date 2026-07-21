-- Add optional, Kathmandu-scoped location snapshots to transactions.
ALTER TABLE "Transaction"
  ADD COLUMN "locationLabel" TEXT,
  ADD COLUMN "locationAddress" TEXT,
  ADD COLUMN "locationLatitude" DOUBLE PRECISION,
  ADD COLUMN "locationLongitude" DOUBLE PRECISION,
  ADD COLUMN "locationAccuracy" INTEGER,
  ADD COLUMN "locationSource" TEXT,
  ADD COLUMN "savedPlaceId" TEXT;

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_location_in_kathmandu_check"
  CHECK (
    ("locationLatitude" IS NULL AND "locationLongitude" IS NULL)
    OR (
      "locationLatitude" IS NOT NULL
      AND "locationLongitude" IS NOT NULL
      AND "locationLatitude" BETWEEN 27.63 AND 27.82
      AND "locationLongitude" BETWEEN 85.20 AND 85.40
    )
  ),
  ADD CONSTRAINT "Transaction_location_accuracy_check"
  CHECK ("locationAccuracy" IS NULL OR "locationAccuracy" > 0);

CREATE TABLE "SavedPlace" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT NOT NULL DEFAULT 'Kathmandu, Nepal',
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedPlace_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SavedPlace"
  ADD CONSTRAINT "SavedPlace_location_in_kathmandu_check"
  CHECK (
    "latitude" BETWEEN 27.63 AND 27.82
    AND "longitude" BETWEEN 85.20 AND 85.40
  );

CREATE INDEX "Transaction_savedPlaceId_idx" ON "Transaction"("savedPlaceId");
CREATE INDEX "SavedPlace_userId_lastUsedAt_idx" ON "SavedPlace"("userId", "lastUsedAt");

ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_savedPlaceId_fkey"
  FOREIGN KEY ("savedPlaceId") REFERENCES "SavedPlace"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SavedPlace"
  ADD CONSTRAINT "SavedPlace_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Paper Ledger reads and writes through authenticated server routes and Prisma.
-- Keep the new public-schema table unavailable to Supabase Data API roles.
ALTER TABLE "SavedPlace" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "SavedPlace" FROM anon, authenticated;
