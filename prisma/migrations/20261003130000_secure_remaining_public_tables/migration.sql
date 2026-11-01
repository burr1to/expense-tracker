-- These tables were created after 20260712010000_secure_public_tables without
-- locking them down. Prisma on the trusted server is the only client, so block
-- Supabase Data API roles and enable RLS without browser-facing policies.
ALTER TABLE "DueItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DuePayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReceiptAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReceiptScan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountReconciliation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomSubcategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LearningProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Household" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HouseholdMember" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  "DueItem",
  "DuePayment",
  "ReceiptAttachment",
  "ReceiptScan",
  "AccountReconciliation",
  "CustomSubcategory",
  "ImportJob",
  "LearningProfile",
  "Household",
  "HouseholdMember"
FROM anon, authenticated;
