ALTER TABLE "User" ADD COLUMN "pinHash" TEXT;

ALTER TABLE "User" ALTER COLUMN "autoLockMinutes" SET DEFAULT 0;

-- Existing ledgers must remain unlocked until their owner explicitly sets a PIN.
UPDATE "User" SET "autoLockMinutes" = 0;
