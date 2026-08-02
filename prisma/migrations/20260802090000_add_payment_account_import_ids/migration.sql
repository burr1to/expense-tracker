BEGIN;

ALTER TABLE "PaymentAccount" ADD COLUMN "importId" TEXT;

UPDATE "PaymentAccount"
SET "importId" = gen_random_uuid()::text
WHERE "importId" IS NULL;

ALTER TABLE "PaymentAccount" ALTER COLUMN "importId" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "PaymentAccount" ALTER COLUMN "importId" SET NOT NULL;

CREATE UNIQUE INDEX "PaymentAccount_userId_importId_key"
ON "PaymentAccount"("userId", "importId");

COMMIT;
