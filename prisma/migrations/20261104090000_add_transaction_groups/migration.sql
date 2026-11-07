-- Named sets of transactions (a trip, an event). A transaction belongs to at most one group,
-- and removing a group keeps its transactions, only ungrouped.
CREATE TABLE "TransactionGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'trip',
    "startOn" DATE,
    "endOn" DATE,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionGroup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TransactionGroup_userId_createdAt_idx" ON "TransactionGroup"("userId", "createdAt");

ALTER TABLE "TransactionGroup" ADD CONSTRAINT "TransactionGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Transaction" ADD COLUMN "groupId" TEXT;
CREATE INDEX "Transaction_groupId_idx" ON "Transaction"("groupId");
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TransactionGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The app reads and writes through authenticated server routes and Prisma only.
ALTER TABLE "TransactionGroup" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "TransactionGroup" FROM anon, authenticated;
