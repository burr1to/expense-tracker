BEGIN;

ALTER TABLE "CustomCategory"
ADD COLUMN "icon" TEXT NOT NULL DEFAULT 'tag';

CREATE TABLE "CustomSubcategory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "icon" TEXT NOT NULL DEFAULT 'tag',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomSubcategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomSubcategory_userId_categoryId_name_key"
ON "CustomSubcategory"("userId", "categoryId", "name");

CREATE INDEX "CustomSubcategory_userId_categoryId_idx"
ON "CustomSubcategory"("userId", "categoryId");

ALTER TABLE "CustomSubcategory"
ADD CONSTRAINT "CustomSubcategory_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
