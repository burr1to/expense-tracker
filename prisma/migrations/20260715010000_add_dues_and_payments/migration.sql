CREATE TABLE "DueItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "person" TEXT NOT NULL DEFAULT '',
    "amountMinor" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "occurredOn" DATE,
    "dueOn" DATE NOT NULL,
    "remindOn" DATE,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "completedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DueItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DuePayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dueItemId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "occurredOn" DATE NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DuePayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DueItem_userId_dueOn_idx" ON "DueItem"("userId", "dueOn");
CREATE INDEX "DueItem_userId_remindOn_idx" ON "DueItem"("userId", "remindOn");
CREATE INDEX "DuePayment_userId_dueItemId_idx" ON "DuePayment"("userId", "dueItemId");

ALTER TABLE "DueItem" ADD CONSTRAINT "DueItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DuePayment" ADD CONSTRAINT "DuePayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DuePayment" ADD CONSTRAINT "DuePayment_dueItemId_fkey" FOREIGN KEY ("dueItemId") REFERENCES "DueItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
