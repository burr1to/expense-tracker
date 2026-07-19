-- SaveYoRupee uses Better Auth and Prisma exclusively from the trusted server.
-- Block Supabase Data API roles and enable RLS without browser-facing policies.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Verification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Transaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Budget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecurringEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SavingsGoal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  "User",
  "Session",
  "Account",
  "Verification",
  "Transaction",
  "Budget",
  "RecurringEntry",
  "SavingsGoal",
  "CustomCategory",
  "_prisma_migrations"
FROM anon, authenticated;
