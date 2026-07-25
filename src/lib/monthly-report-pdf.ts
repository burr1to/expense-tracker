import { formatMoney } from "./currency";
import type { MonthlyReport } from "./monthly-report";

interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  gapAfter?: number;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 46;
const TOP = 794;
const BOTTOM = 46;

function ascii(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?");
}

function escapePdf(value: string) {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(text: string, max = 88) {
  const words = ascii(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    if (`${line} ${word}`.length <= max) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

function money(report: MonthlyReport, amountMinor: number) {
  return formatMoney(amountMinor, report.currency);
}

function change(value: number | null) {
  return value === null ? "new activity (no prior-month baseline)" : `${value >= 0 ? "+" : ""}${value}% vs previous month`;
}

function reportLines(report: MonthlyReport): PdfLine[] {
  const lines: PdfLine[] = [
    { text: "SaveYoRupee", size: 11, bold: true, gapAfter: 4 },
    { text: `${report.monthLabel} Monthly Report`, size: 21, bold: true, gapAfter: 5 },
    { text: `${report.displayName} | Generated ${report.generatedOn.slice(0, 10)}`, size: 9, gapAfter: 16 },
    { text: "MONTH AT A GLANCE", size: 12, bold: true, gapAfter: 5 },
    { text: `Income: ${money(report, report.summary.incomeMinor)} (${change(report.summary.incomeChangePercentage)})` },
    { text: `Expenses: ${money(report, report.summary.expenseMinor)} (${change(report.summary.expenseChangePercentage)})` },
    { text: `Net cash flow: ${money(report, report.summary.netMinor)} | Savings rate: ${report.summary.savingsRate}% | Entries: ${report.summary.transactionCount}`, gapAfter: 13 },
    { text: "EXPENSE CATEGORIES", size: 12, bold: true, gapAfter: 5 },
    ...(report.categories.length
      ? report.categories.map((item) => ({ text: `${item.label}: ${money(report, item.amountMinor)} across ${item.count} ${item.count === 1 ? "entry" : "entries"}` }))
      : [{ text: "No expenses were logged." }]),
    { text: "", gapAfter: 6 },
    { text: "SUBCATEGORIES", size: 12, bold: true, gapAfter: 5 },
    ...(report.subcategories.length
      ? report.subcategories.map((item) => ({ text: `${item.label}: ${money(report, item.amountMinor)} (${item.count})` }))
      : [{ text: "No subcategory activity." }]),
    { text: "", gapAfter: 6 },
    { text: "BUDGET VS ACTUAL", size: 12, bold: true, gapAfter: 5 },
    ...(report.budgets.length
      ? report.budgets.map((item) => ({ text: `${item.categoryLabel}: ${money(report, item.spentMinor)} of ${money(report, item.amountMinor)} (${item.usedPercentage}%) | ${item.remainingMinor >= 0 ? "remaining" : "over"} ${money(report, Math.abs(item.remainingMinor))}` }))
      : [{ text: "No budgets were set for this month." }]),
    { text: "", gapAfter: 6 },
    { text: "ACCOUNTS AND TRANSFERS", size: 12, bold: true, gapAfter: 5 },
    ...(report.accounts.length
      ? report.accounts.map((item) => ({ text: `${item.label}: latest tracked balance ${money(report, item.balanceMinor)} (as of ${item.balanceAsOf}); income ${money(report, item.incomeMinor)}, expenses ${money(report, item.expenseMinor)}, transfers in ${money(report, item.transfersInMinor)}, out ${money(report, item.transfersOutMinor)}` }))
      : [{ text: "No tracked payment accounts." }]),
    ...report.transfers.map((item) => {
      const from = report.accounts.find((account) => account.id === item.fromAccountId)?.label ?? "Unknown account";
      const to = report.accounts.find((account) => account.id === item.toAccountId)?.label ?? "Unknown account";
      return { text: `${item.occurredOn} | Transfer ${money(report, item.amountMinor)} | ${from} -> ${to}${item.note ? ` | ${item.note}` : ""}` };
    }),
    { text: "Transfers are listed separately and are not counted as income or expenses.", size: 8, gapAfter: 12 },
    { text: "DUES AND RECURRING ITEMS", size: 12, bold: true, gapAfter: 5 },
    ...(report.dues.length
      ? report.dues.map((item) => ({ text: `${item.dueOn} | ${item.title} | ${item.kind} | ${money(report, item.amountMinor)} | paid ${money(report, item.paidMinor)} | ${item.status}${item.completedOn ? ` ${item.completedOn}` : ""}` }))
      : [{ text: "No dues were due or completed this month." }]),
    ...report.recurring.map((item) => ({ text: `Monthly day ${item.dayOfMonth} | ${item.note || item.categoryLabel} | ${item.kind} ${money(report, item.amountMinor)}` })),
    { text: "", gapAfter: 6 },
    { text: "COMPLETE TRANSACTION LEDGER", size: 12, bold: true, gapAfter: 5 },
    ...(report.transactions.length
      ? report.transactions.map((item) => ({
          text: `${item.occurredOn} | ${item.kind.toUpperCase()} | ${item.categoryLabel}${item.subcategory ? ` / ${item.subcategory}` : ""} | ${money(report, item.amountMinor)} | ${item.paymentMode}${item.note ? ` | ${item.note}` : ""}`,
        }))
      : [{ text: "No transactions were logged." }]),
    { text: "", gapAfter: 6 },
    { text: "This report is generated from your SaveYoRupee ledger. Account balances are the latest manually tracked values available when the report is downloaded.", size: 8 },
  ];
  return lines;
}

function paginate(lines: PdfLine[]) {
  const pages: Array<Array<{ text: string; size: number; bold: boolean; y: number }>> = [[]];
  let y = TOP;
  for (const line of lines) {
    const size = line.size ?? 9;
    const lineHeight = size + 4;
    const wrapped = wrap(line.text, size >= 18 ? 48 : size >= 12 ? 72 : 92);
    for (const text of wrapped) {
      if (y - lineHeight < BOTTOM) {
        pages.push([]);
        y = TOP;
      }
      pages[pages.length - 1].push({ text, size, bold: Boolean(line.bold), y });
      y -= lineHeight;
    }
    y -= line.gapAfter ?? 1;
  }
  return pages;
}

function pdfObject(id: number, body: string | Buffer) {
  return Buffer.concat([Buffer.from(`${id} 0 obj\n`, "ascii"), Buffer.isBuffer(body) ? body : Buffer.from(body, "ascii"), Buffer.from("\nendobj\n", "ascii")]);
}

export function generateMonthlyReportPdf(report: MonthlyReport) {
  const pages = paginate(reportLines(report));
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);
  const objects: Buffer[] = [
    pdfObject(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    pdfObject(2, `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`),
    pdfObject(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    pdfObject(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"),
  ];

  pages.forEach((page, index) => {
    const pageId = pageObjectIds[index];
    const contentId = pageId + 1;
    const content = page.map((line) => `BT /F${line.bold ? 2 : 1} ${line.size} Tf ${LEFT} ${line.y} Td (${escapePdf(line.text)}) Tj ET`).join("\n");
    objects.push(pdfObject(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`));
    objects.push(pdfObject(contentId, Buffer.concat([Buffer.from(`<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n`, "ascii"), Buffer.from(content, "ascii"), Buffer.from("\nendstream", "ascii")])));
  });

  const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary");
  const offsets: number[] = [0];
  let offset = header.length;
  for (const object of objects) {
    offsets.push(offset);
    offset += object.length;
  }
  const xrefOffset = offset;
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n `),
  ].join("\n");
  const trailer = `\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.concat([header, ...objects, Buffer.from(xref + trailer, "ascii")]);
}
