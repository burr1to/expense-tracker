import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "../../../../lib/auth";
import { isFiscalYearKey } from "../../../../lib/fiscal-year";
import { isCompletedReportMonth, reportFileKey } from "../../../../lib/monthly-report";
import { loadMonthlyReport } from "../../../../lib/monthly-report-data";
import { generateMonthlyReportPdf } from "../../../../lib/monthly-report-pdf";
import { getPrisma } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getAuthenticatedSession(await headers());
  if (!session?.user.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const monthKey = new URL(request.url).searchParams.get("month") ?? "";
  if (!isCompletedReportMonth(monthKey)) {
    return NextResponse.json({ error: "Choose a completed month (YYYY-MM or BS:YYYY-MM) or fiscal year (FY:YYYY-YY)." }, { status: 400 });
  }

  const report = await loadMonthlyReport(getPrisma(), session.user.id, monthKey);

  const pdf = generateMonthlyReportPdf(report);
  const fileName = `SaveYoRupee-${reportFileKey(monthKey)}-${isFiscalYearKey(monthKey) ? "summary" : "monthly-report"}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
