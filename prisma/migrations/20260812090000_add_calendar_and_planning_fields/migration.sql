-- Calendar system preference (AD or BS) and the untouchable safe-to-spend floor.
ALTER TABLE "User" ADD COLUMN "calendarSystem" TEXT NOT NULL DEFAULT 'AD';
ALTER TABLE "User" ADD COLUMN "safeToSpendBufferMinor" INTEGER NOT NULL DEFAULT 0;

-- Budgets gain a scope so festival envelopes can live alongside monthly budgets.
-- Existing rows are monthly by definition.
ALTER TABLE "Budget" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'month';

-- Optional interest rate so the payoff planner can order debts by cost.
-- NULL means interest-free, which is the common case for money borrowed from family.
ALTER TABLE "DueItem" ADD COLUMN "annualRatePercent" DOUBLE PRECISION;
