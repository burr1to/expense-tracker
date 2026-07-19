import type { ReactNode } from "react";
import { LedgerAppLayout } from "../../components/LedgerAppLayout";

export const dynamic = "force-dynamic";

export default function LedgerLayout({ children }: { children: ReactNode }) {
  return <LedgerAppLayout>{children}</LedgerAppLayout>;
}
