import { formatMoney } from "./currency";
import type { MonthlyReport } from "./monthly-report";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const COLOR = {
  paper: "#f2efe2",
  paperStrong: "#faf8ee",
  ink: "#24332b",
  muted: "#5c6e63",
  line: "#cbd3c9",
  green: "#3f6653",
  greenSoft: "#dce9df",
  sage: "#557f69",
  sageLight: "#789685",
  coral: "#8f4c49",
  coralSoft: "#eddeda",
  gold: "#9a741c",
  goldSoft: "#eee4c7",
  white: "#ffffff",
} as const;

interface TextOptions {
  size?: number;
  bold?: boolean;
  color?: string;
  maxWidth?: number;
  align?: "left" | "right" | "center";
}

interface AmountGroup {
  label: string;
  amountMinor: number;
  count: number;
}

function ascii(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?");
}

function escapePdf(value: string) {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function rgb(hex: string) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255)
    .map((value) => value.toFixed(3))
    .join(" ");
}

function estimateWidth(value: string, size: number) {
  return ascii(value).length * size * 0.52;
}

function truncate(value: string, width: number, size: number) {
  const safe = ascii(value);
  if (estimateWidth(safe, size) <= width) return safe;
  const maxCharacters = Math.max(1, Math.floor(width / (size * 0.52)) - 1);
  return `${safe.slice(0, maxCharacters)}...`;
}

function wrap(value: string, width: number, size: number, maxLines = 2) {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (estimateWidth(candidate, size) <= width) line = candidate;
    else {
      if (line) lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(" ").length;
  if (consumed < ascii(value).length && lines.length) lines[lines.length - 1] = truncate(lines[lines.length - 1], width, size);
  return lines;
}

class PdfPage {
  readonly commands: string[] = [];

  constructor(readonly background = COLOR.paper) {
    this.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, background);
  }

  rect(x: number, y: number, width: number, height: number, fill: string, stroke?: string, lineWidth = 1) {
    const bottom = PAGE_HEIGHT - y - height;
    this.commands.push(`${rgb(fill)} rg ${x.toFixed(2)} ${bottom.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
    if (stroke) this.commands.push(`${rgb(stroke)} RG ${lineWidth.toFixed(2)} w ${x.toFixed(2)} ${bottom.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
  }

  roundRect(x: number, y: number, width: number, height: number, radius: number, fill: string, stroke?: string) {
    const left = x;
    const right = x + width;
    const top = PAGE_HEIGHT - y;
    const bottom = PAGE_HEIGHT - y - height;
    const r = Math.min(radius, width / 2, height / 2);
    const k = r * 0.5522848;
    const path = [
      `${left + r} ${bottom} m`,
      `${right - r} ${bottom} l`,
      `${right - r + k} ${bottom} ${right} ${bottom + r - k} ${right} ${bottom + r} c`,
      `${right} ${top - r} l`,
      `${right} ${top - r + k} ${right - r + k} ${top} ${right - r} ${top} c`,
      `${left + r} ${top} l`,
      `${left + r - k} ${top} ${left} ${top - r + k} ${left} ${top - r} c`,
      `${left} ${bottom + r} l`,
      `${left} ${bottom + r - k} ${left + r - k} ${bottom} ${left + r} ${bottom} c`,
      "h",
    ].join(" ");
    this.commands.push(`${rgb(fill)} rg ${path} f`);
    if (stroke) this.commands.push(`${rgb(stroke)} RG 0.8 w ${path} S`);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string = COLOR.line, width = 1) {
    this.commands.push(`${rgb(color)} RG ${width.toFixed(2)} w ${x1.toFixed(2)} ${(PAGE_HEIGHT - y1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_HEIGHT - y2).toFixed(2)} l S`);
  }

  circle(cx: number, cy: number, radius: number, fill: string) {
    const k = radius * 0.5522848;
    const y = PAGE_HEIGHT - cy;
    const path = [
      `${cx + radius} ${y} m`,
      `${cx + radius} ${y + k} ${cx + k} ${y + radius} ${cx} ${y + radius} c`,
      `${cx - k} ${y + radius} ${cx - radius} ${y + k} ${cx - radius} ${y} c`,
      `${cx - radius} ${y - k} ${cx - k} ${y - radius} ${cx} ${y - radius} c`,
      `${cx + k} ${y - radius} ${cx + radius} ${y - k} ${cx + radius} ${y} c h`,
    ].join(" ");
    this.commands.push(`${rgb(fill)} rg ${path} f`);
  }

  text(value: string, x: number, y: number, options: TextOptions = {}) {
    const size = options.size ?? 9;
    const maxWidth = options.maxWidth;
    const safe = maxWidth ? truncate(value, maxWidth, size) : ascii(value);
    const width = estimateWidth(safe, size);
    let textX = x;
    if (options.align === "right") textX -= width;
    if (options.align === "center") textX -= width / 2;
    const baseline = PAGE_HEIGHT - y - size * 0.82;
    this.commands.push(`${rgb(options.color ?? COLOR.ink)} rg BT /F${options.bold ? 2 : 1} ${size.toFixed(2)} Tf ${textX.toFixed(2)} ${baseline.toFixed(2)} Td (${escapePdf(safe)}) Tj ET`);
  }

  paragraph(value: string, x: number, y: number, width: number, options: TextOptions & { lineHeight?: number; maxLines?: number } = {}) {
    const size = options.size ?? 9;
    const lineHeight = options.lineHeight ?? size + 3;
    const lines = wrap(value, width, size, options.maxLines ?? 2);
    lines.forEach((line, index) => this.text(line, x, y + index * lineHeight, options));
    return lines.length * lineHeight;
  }

  content() {
    return this.commands.join("\n");
  }
}

function money(report: MonthlyReport, amountMinor: number, compact = false) {
  return formatMoney(amountMinor, report.currency, compact);
}

function changeLabel(value: number | null) {
  if (value === null) return "New vs prior month";
  if (value === 0) return "No change vs prior month";
  return `${value > 0 ? "+" : ""}${value}% vs prior month`;
}

function reportMonthDayCount(report: MonthlyReport) {
  const lastDay = new Date(`${report.monthKey}-01T00:00:00.000Z`);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
  lastDay.setUTCDate(0);
  return lastDay.getUTCDate();
}

function shareOf(amountMinor: number, totalMinor: number) {
  return totalMinor > 0 ? Math.round((amountMinor / totalMinor) * 100) : 0;
}

function chartGroups(items: readonly AmountGroup[], limit = 6) {
  if (items.length <= limit) return [...items];
  const visible = items.slice(0, limit - 1);
  const remaining = items.slice(limit - 1);
  return [...visible, {
    label: "Other",
    amountMinor: remaining.reduce((sum, item) => sum + item.amountMinor, 0),
    count: remaining.reduce((sum, item) => sum + item.count, 0),
  }];
}

function drawPanel(page: PdfPage, x: number, y: number, width: number, height: number, title: string, subtitle?: string) {
  page.roundRect(x, y, width, height, 12, COLOR.paperStrong, COLOR.line);
  page.text(title, x + 16, y + 15, { size: 12, bold: true });
  if (subtitle) page.text(subtitle, x + 16, y + 34, { size: 7.5, color: COLOR.muted, maxWidth: width - 32 });
}

function drawCategoryChart(page: PdfPage, report: MonthlyReport, items: readonly AmountGroup[], x: number, y: number, width: number, height: number, title: string, color: string, total: number) {
  drawPanel(page, x, y, width, height, title, `${items.reduce((sum, item) => sum + item.count, 0)} entries`);
  const rows = chartGroups(items, 5);
  if (!rows.length) {
    page.text("No activity recorded", x + 16, y + 92, { size: 9, color: COLOR.muted });
    return;
  }
  const maximum = Math.max(...rows.map((item) => item.amountMinor), 1);
  const rowHeight = 22;
  const startY = y + 55;
  rows.forEach((item, index) => {
    const rowY = startY + index * rowHeight;
    const amount = money(report, item.amountMinor, true);
    page.text(item.label, x + 16, rowY, { size: 8, bold: true, maxWidth: width - 105 });
    page.text(`${amount} | ${shareOf(item.amountMinor, total)}%`, x + width - 16, rowY, { size: 7, bold: true, align: "right", color });
    page.roundRect(x + 16, rowY + 12, width - 32, 5, 2.5, COLOR.line);
    page.roundRect(x + 16, rowY + 12, Math.max(3, (width - 32) * (item.amountMinor / maximum)), 5, 2.5, color);
  });
}

function drawFocusStrip(page: PdfPage, report: MonthlyReport, x: number, y: number, width: number, height: number) {
  drawPanel(page, x, y, width, height, "Month in focus", "Useful signals behind the headline totals");
  const dayCount = reportMonthDayCount(report);
  const activeDays = new Set(report.transactions.map((item) => item.occurredOn)).size;
  const largestExpense = report.transactions
    .filter((item) => item.kind === "expense")
    .reduce<MonthlyReport["transactions"][number] | null>((largest, item) => !largest || item.amountMinor > largest.amountMinor ? item : largest, null);
  const topCategory = report.categories[0];
  const overBudgetCount = report.budgets.filter((item) => item.remainingMinor < 0).length;
  const signals = [
    {
      label: "TOP SPEND",
      value: topCategory?.label ?? "No spending",
      note: topCategory ? `${money(report, topCategory.amountMinor, true)} | ${shareOf(topCategory.amountMinor, report.summary.expenseMinor)}% of spend` : "Nothing recorded",
      color: COLOR.coral,
    },
    {
      label: "AVERAGE DAILY SPEND",
      value: money(report, Math.round(report.summary.expenseMinor / dayCount), true),
      note: `Across ${dayCount} calendar days`,
      color: COLOR.ink,
    },
    {
      label: "LARGEST EXPENSE",
      value: largestExpense ? money(report, largestExpense.amountMinor, true) : "None",
      note: largestExpense ? largestExpense.note || largestExpense.categoryLabel : "Nothing recorded",
      color: COLOR.coral,
    },
    {
      label: "ACTIVITY & BUDGETS",
      value: `${activeDays} active ${activeDays === 1 ? "day" : "days"}`,
      note: report.budgets.length ? `${overBudgetCount} of ${report.budgets.length} budgets over` : "No budgets set",
      color: overBudgetCount ? COLOR.gold : COLOR.green,
    },
  ];
  const columnWidth = (width - 32) / signals.length;
  signals.forEach((signal, index) => {
    const signalX = x + 16 + index * columnWidth;
    if (index) page.line(signalX, y + 43, signalX, y + height - 13, COLOR.line, 0.65);
    page.text(signal.label, signalX + (index ? 12 : 0), y + 44, { size: 6.3, bold: true, color: COLOR.muted, maxWidth: columnWidth - 16 });
    page.text(signal.value, signalX + (index ? 12 : 0), y + 57, { size: 9.5, bold: true, color: signal.color, maxWidth: columnWidth - 16 });
    page.text(signal.note, signalX + (index ? 12 : 0), y + 72, { size: 6.2, color: COLOR.muted, maxWidth: columnWidth - 16 });
  });
}

function drawDailyChart(page: PdfPage, report: MonthlyReport, x: number, y: number, width: number, height: number) {
  drawPanel(page, x, y, width, height, "Daily cash flow", "Income and spending across the month");
  const dayCount = reportMonthDayCount(report);
  const daily = Array.from({ length: dayCount }, (_, index) => ({ day: index + 1, income: 0, expense: 0 }));
  for (const transaction of report.transactions) {
    const day = Number(transaction.occurredOn.slice(8, 10));
    if (day < 1 || day > dayCount) continue;
    daily[day - 1][transaction.kind] += transaction.amountMinor;
  }
  const max = Math.max(...daily.flatMap((item) => [item.income, item.expense]), 1);
  const chartX = x + 44;
  const chartY = y + 62;
  const chartWidth = width - 64;
  const chartHeight = height - 102;
  for (let index = 0; index <= 3; index += 1) {
    const lineY = chartY + (chartHeight / 3) * index;
    page.line(chartX, lineY, chartX + chartWidth, lineY, COLOR.line, 0.55);
    page.text(money(report, Math.round(max * (1 - index / 3)), true), chartX - 7, lineY - 3, { size: 6.5, color: COLOR.muted, align: "right" });
  }
  const slot = chartWidth / dayCount;
  const barWidth = Math.max(1.4, Math.min(4, slot * 0.34));
  daily.forEach((item, index) => {
    const incomeHeight = (item.income / max) * chartHeight;
    const expenseHeight = (item.expense / max) * chartHeight;
    const center = chartX + slot * index + slot / 2;
    if (incomeHeight > 0) page.rect(center - barWidth - 0.5, chartY + chartHeight - incomeHeight, barWidth, incomeHeight, COLOR.green);
    if (expenseHeight > 0) page.rect(center + 0.5, chartY + chartHeight - expenseHeight, barWidth, expenseHeight, COLOR.coral);
    if (item.day === 1 || item.day % 5 === 0 || item.day === dayCount) page.text(String(item.day), center, chartY + chartHeight + 8, { size: 6, color: COLOR.muted, align: "center" });
  });
  page.rect(x + width - 139, y + 19, 7, 7, COLOR.green);
  page.text("Income", x + width - 127, y + 18, { size: 7.5, color: COLOR.muted });
  page.rect(x + width - 72, y + 19, 7, 7, COLOR.coral);
  page.text("Spending", x + width - 60, y + 18, { size: 7.5, color: COLOR.muted });
}

function drawCoverPage(report: MonthlyReport) {
  const page = new PdfPage();
  page.rect(0, 0, PAGE_WIDTH, 185, COLOR.ink);
  page.circle(550, 36, 86, "#30483b");
  page.circle(518, 42, 43, COLOR.sage);
  page.roundRect(MARGIN, 27, 28, 28, 6, COLOR.sage);
  page.text("SYR", MARGIN + 14, 36, { size: 8, bold: true, color: COLOR.white, align: "center" });
  page.text("SaveYoRupee", MARGIN + 38, 33, { size: 11, bold: true, color: COLOR.white });
  page.text("MONTHLY FINANCIAL REPORT", MARGIN, 76, { size: 8, bold: true, color: "#b9cabe" });
  page.text(report.monthLabel, MARGIN, 94, { size: 27, bold: true, color: COLOR.white });
  page.text(`${report.displayName}  |  Generated ${report.generatedOn.slice(0, 10)}`, MARGIN, 133, { size: 8, color: "#d8e1db" });

  const metrics = [
    { label: "Income", value: money(report, report.summary.incomeMinor, true), note: changeLabel(report.summary.incomeChangePercentage), color: COLOR.green },
    { label: "Spending", value: money(report, report.summary.expenseMinor, true), note: changeLabel(report.summary.expenseChangePercentage), color: COLOR.coral },
    { label: "Net cash flow", value: money(report, report.summary.netMinor, true), note: report.summary.netMinor >= 0 ? "Positive month" : "Expenses exceeded income", color: report.summary.netMinor >= 0 ? COLOR.green : COLOR.coral },
    { label: "Savings rate", value: `${report.summary.savingsRate}%`, note: `${report.summary.transactionCount} ledger entries`, color: COLOR.sage },
  ];
  const gap = 10;
  const cardWidth = (CONTENT_WIDTH - gap * 3) / 4;
  metrics.forEach((metric, index) => {
    const x = MARGIN + index * (cardWidth + gap);
    page.roundRect(x, 153, cardWidth, 94, 11, COLOR.paperStrong, COLOR.line);
    page.rect(x, 153, 4, 94, metric.color);
    page.text(metric.label.toUpperCase(), x + 14, 170, { size: 7, bold: true, color: COLOR.muted, maxWidth: cardWidth - 24 });
    page.text(metric.value, x + 14, 192, { size: 16, bold: true, color: metric.color, maxWidth: cardWidth - 24 });
    page.text(metric.note, x + 14, 220, { size: 6.5, color: COLOR.muted, maxWidth: cardWidth - 24 });
  });

  drawFocusStrip(page, report, MARGIN, 268, CONTENT_WIDTH, 85);
  const panelGap = 14;
  const panelWidth = (CONTENT_WIDTH - panelGap) / 2;
  drawCategoryChart(page, report, report.categories, MARGIN, 374, panelWidth, 188, "Spending by category", COLOR.coral, report.summary.expenseMinor);
  drawCategoryChart(page, report, report.incomeCategories, MARGIN + panelWidth + panelGap, 374, panelWidth, 188, "Earnings by source", COLOR.green, report.summary.incomeMinor);
  drawDailyChart(page, report, MARGIN, 583, CONTENT_WIDTH, 201);
  return page;
}

class FlowRenderer {
  readonly pages: PdfPage[];
  private page: PdfPage;
  private y: number;
  private detailPageNumber = 0;

  constructor(private readonly report: MonthlyReport, cover: PdfPage) {
    this.pages = [cover];
    this.page = cover;
    this.y = 0;
  }

  private newPage(title: string, eyebrow: string) {
    this.detailPageNumber += 1;
    this.page = new PdfPage(COLOR.paper);
    this.pages.push(this.page);
    this.page.roundRect(MARGIN, 28, 28, 28, 6, COLOR.sage);
    this.page.text("SYR", MARGIN + 14, 37, { size: 8, bold: true, color: COLOR.white, align: "center" });
    this.page.text(eyebrow.toUpperCase(), MARGIN + 40, 30, { size: 7, bold: true, color: COLOR.sage });
    this.page.text(title, MARGIN + 40, 44, { size: 18, bold: true });
    this.page.text(this.report.monthLabel, PAGE_WIDTH - MARGIN, 35, { size: 8, color: COLOR.muted, align: "right" });
    this.page.line(MARGIN, 72, PAGE_WIDTH - MARGIN, 72, COLOR.line, 0.8);
    this.y = 92;
  }

  private ensure(height: number, title: string, eyebrow = "Monthly report") {
    if (this.pages.length === 1 || this.y + height > 792) {
      this.newPage(title, eyebrow);
      return true;
    }
    return false;
  }

  private section(title: string, description: string, firstRowHeight = 0) {
    if (this.ensure(42 + firstRowHeight, title)) {
      this.page.text(description, MARGIN, this.y, { size: 7.5, color: COLOR.muted, maxWidth: CONTENT_WIDTH });
      this.page.line(MARGIN, this.y + 17, PAGE_WIDTH - MARGIN, this.y + 17, COLOR.line, 0.7);
      this.y += 28;
      return;
    }
    this.page.text(title, MARGIN, this.y, { size: 12, bold: true });
    this.page.text(description, PAGE_WIDTH - MARGIN, this.y + 2, { size: 7.5, color: COLOR.muted, align: "right", maxWidth: 250 });
    this.page.line(MARGIN, this.y + 21, PAGE_WIDTH - MARGIN, this.y + 21, COLOR.line, 0.7);
    this.y += 34;
  }

  private detailSnapshot() {
    const overBudgetCount = this.report.budgets.filter((item) => item.remainingMinor < 0).length;
    const balanceMinor = this.report.accounts.reduce((sum, item) => sum + item.balanceMinor, 0);
    const signals = [
      {
        label: "SPENDING MIX",
        value: `${this.report.categories.length} ${this.report.categories.length === 1 ? "category" : "categories"}`,
        note: `${this.report.subcategories.length} subcategories`,
        color: COLOR.coral,
      },
      {
        label: "BUDGET HEALTH",
        value: this.report.budgets.length ? `${overBudgetCount} over limit` : "No budgets",
        note: this.report.budgets.length ? `${this.report.budgets.length - overBudgetCount} within limit` : "Add budgets to compare",
        color: overBudgetCount ? COLOR.gold : COLOR.green,
      },
      {
        label: "TRACKED BALANCE",
        value: money(this.report, balanceMinor, true),
        note: `${this.report.accounts.length} tracked ${this.report.accounts.length === 1 ? "account" : "accounts"}`,
        color: balanceMinor >= 0 ? COLOR.sage : COLOR.coral,
      },
      {
        label: "COMMITMENTS",
        value: `${this.report.dues.length} ${this.report.dues.length === 1 ? "due" : "dues"}`,
        note: `${this.report.recurring.length} recurring plans`,
        color: COLOR.ink,
      },
    ];
    drawPanel(this.page, MARGIN, this.y, CONTENT_WIDTH, 99, "Detail snapshot", "A quick index for the sections that follow");
    const columnWidth = (CONTENT_WIDTH - 32) / signals.length;
    signals.forEach((signal, index) => {
      const x = MARGIN + 16 + index * columnWidth;
      if (index) this.page.line(x, this.y + 44, x, this.y + 84, COLOR.line, 0.65);
      this.page.text(signal.label, x + (index ? 12 : 0), this.y + 47, { size: 6.3, bold: true, color: COLOR.muted, maxWidth: columnWidth - 16 });
      this.page.text(signal.value, x + (index ? 12 : 0), this.y + 62, { size: 9.5, bold: true, color: signal.color, maxWidth: columnWidth - 16 });
      this.page.text(signal.note, x + (index ? 12 : 0), this.y + 78, { size: 6.3, color: COLOR.muted, maxWidth: columnWidth - 16 });
    });
    this.y += 119;
  }

  private amountRows(title: string, description: string, items: readonly AmountGroup[], color: string) {
    this.section(title, description, items.length ? 38 : 30);
    if (!items.length) {
      this.page.text("No activity recorded.", MARGIN + 10, this.y + 4, { size: 8.5, color: COLOR.muted });
      this.y += 34;
      return;
    }
    const maximum = Math.max(...items.map((item) => item.amountMinor), 1);
    const total = items.reduce((sum, item) => sum + item.amountMinor, 0);
    items.forEach((item, index) => {
      this.ensure(38, `${title} (continued)`);
      if (index % 2 === 0) this.page.rect(MARGIN, this.y - 4, CONTENT_WIDTH, 33, "#ebe9dc");
      this.page.text(item.label, MARGIN + 9, this.y + 4, { size: 8.5, bold: true, maxWidth: 175 });
      this.page.text(`${item.count} ${item.count === 1 ? "entry" : "entries"} | ${shareOf(item.amountMinor, total)}%`, MARGIN + 190, this.y + 4, { size: 7, color: COLOR.muted });
      this.page.roundRect(MARGIN + 287, this.y + 7, 113, 6, 3, COLOR.line);
      this.page.roundRect(MARGIN + 287, this.y + 7, Math.max(3, 113 * (item.amountMinor / maximum)), 6, 3, color);
      this.page.text(money(this.report, item.amountMinor), PAGE_WIDTH - MARGIN - 8, this.y + 2, { size: 8.5, bold: true, color, align: "right" });
      this.y += 34;
    });
    this.y += 18;
  }

  private budgets() {
    this.section("Budget performance", "Actual spending against each monthly limit", this.report.budgets.length ? 56 : 30);
    if (!this.report.budgets.length) {
      this.page.text("No budgets were set for this month.", MARGIN + 10, this.y + 4, { size: 8.5, color: COLOR.muted });
      this.y += 34;
      return;
    }
    this.report.budgets.forEach((budget, index) => {
      this.ensure(56, "Budget performance (continued)");
      const over = budget.remainingMinor < 0;
      const color = over ? COLOR.coral : budget.usedPercentage >= 80 ? COLOR.gold : COLOR.green;
      const status = over ? "OVER LIMIT" : budget.usedPercentage >= 80 ? "NEAR LIMIT" : "ON TRACK";
      if (index % 2 === 0) this.page.rect(MARGIN, this.y - 4, CONTENT_WIDTH, 49, "#ebe9dc");
      this.page.text(budget.categoryLabel, MARGIN + 9, this.y + 3, { size: 8.5, bold: true, maxWidth: 150 });
      this.page.text(`${money(this.report, budget.spentMinor)} of ${money(this.report, budget.amountMinor)}`, MARGIN + 171, this.y + 3, { size: 7.5, color: COLOR.muted });
      this.page.text(`${budget.usedPercentage}% | ${status}`, PAGE_WIDTH - MARGIN - 8, this.y + 3, { size: 7.8, bold: true, color, align: "right" });
      this.page.roundRect(MARGIN + 9, this.y + 23, CONTENT_WIDTH - 18, 7, 3.5, COLOR.line);
      this.page.roundRect(MARGIN + 9, this.y + 23, Math.max(4, (CONTENT_WIDTH - 18) * Math.min(1, budget.usedPercentage / 100)), 7, 3.5, color);
      this.page.text(`${over ? "Over by" : "Remaining"} ${money(this.report, Math.abs(budget.remainingMinor))}`, PAGE_WIDTH - MARGIN - 8, this.y + 35, { size: 6.5, color, align: "right" });
      this.y += 52;
    });
    this.y += 18;
  }

  private accounts() {
    this.section("Account activity", "Latest manually tracked balance and monthly movement", this.report.accounts.length ? 70 : 30);
    if (!this.report.accounts.length) {
      this.page.text("No tracked payment accounts.", MARGIN + 10, this.y + 4, { size: 8.5, color: COLOR.muted });
      this.y += 34;
      return;
    }
    this.report.accounts.forEach((account, index) => {
      this.ensure(70, "Account activity (continued)");
      if (index % 2 === 0) this.page.rect(MARGIN, this.y - 4, CONTENT_WIDTH, 62, "#ebe9dc");
      this.page.text(account.label, MARGIN + 9, this.y + 3, { size: 9, bold: true, maxWidth: 220 });
      this.page.text(`as of ${account.balanceAsOf}`, MARGIN + 9, this.y + 18, { size: 6.5, color: COLOR.muted });
      this.page.text(`Balance ${money(this.report, account.balanceMinor)}`, PAGE_WIDTH - MARGIN - 8, this.y + 3, { size: 8.5, bold: true, color: account.balanceMinor >= 0 ? COLOR.sage : COLOR.coral, align: "right" });
      const movements = [
        { label: "INCOME", value: account.incomeMinor, color: COLOR.green },
        { label: "SPENDING", value: account.expenseMinor, color: COLOR.coral },
        { label: "TRANSFERS IN", value: account.transfersInMinor, color: COLOR.sage },
        { label: "TRANSFERS OUT", value: account.transfersOutMinor, color: COLOR.muted },
      ];
      const columnWidth = (CONTENT_WIDTH - 18) / movements.length;
      movements.forEach((movement, movementIndex) => {
        const x = MARGIN + 9 + movementIndex * columnWidth;
        this.page.text(movement.label, x, this.y + 34, { size: 5.8, bold: true, color: COLOR.muted });
        this.page.text(money(this.report, movement.value), x, this.y + 46, { size: 7.4, bold: true, color: movement.color, maxWidth: columnWidth - 9 });
      });
      this.y += 66;
    });
    this.y += 18;
  }

  private simpleTable<T>(title: string, description: string, items: readonly T[], empty: string, row: (page: PdfPage, item: T, y: number, index: number) => void, rowHeight = 30) {
    this.section(title, description, items.length ? rowHeight + 4 : 30);
    if (!items.length) {
      this.page.text(empty, MARGIN + 10, this.y + 4, { size: 8.5, color: COLOR.muted });
      this.y += 34;
      return;
    }
    items.forEach((item, index) => {
      this.ensure(rowHeight + 4, `${title} (continued)`);
      row(this.page, item, this.y, index);
      this.y += rowHeight;
    });
    this.y += 14;
  }

  private commitmentHeader() {
    const splitX = MARGIN + CONTENT_WIDTH / 2;
    this.page.rect(MARGIN, this.y, CONTENT_WIDTH, 22, COLOR.ink);
    this.page.text("DUES & RECEIVABLES", MARGIN + 9, this.y + 7, { size: 6.3, bold: true, color: COLOR.white });
    this.page.text("ACTIVE RECURRING PLANS", splitX + 10, this.y + 7, { size: 6.3, bold: true, color: COLOR.white });
    this.page.line(splitX, this.y, splitX, this.y + 22, COLOR.sageLight, 0.65);
    this.y += 22;
  }

  private commitments() {
    const rowCount = Math.max(this.report.dues.length, this.report.recurring.length);
    this.section("Commitments & schedules", "Dues, receivables, and active recurring plans", rowCount ? 68 : 30);
    if (!rowCount) {
      this.page.text("No dues or active recurring items.", MARGIN + 10, this.y + 4, { size: 8.5, color: COLOR.muted });
      this.y += 34;
      return;
    }
    this.commitmentHeader();
    const splitX = MARGIN + CONTENT_WIDTH / 2;
    const columnWidth = CONTENT_WIDTH / 2;
    for (let index = 0; index < rowCount; index += 1) {
      if (this.ensure(43, "Commitments & schedules (continued)", "Continued")) this.commitmentHeader();
      if (index % 2 === 0) this.page.rect(MARGIN, this.y, CONTENT_WIDTH, 42, "#ebe9dc");
      this.page.line(splitX, this.y, splitX, this.y + 42, COLOR.line, 0.55);
      const due = this.report.dues[index];
      if (due) {
        this.page.text(due.title, MARGIN + 9, this.y + 5, { size: 7.8, bold: true, maxWidth: columnWidth - 92 });
        this.page.text(money(this.report, due.amountMinor), splitX - 9, this.y + 5, { size: 7.6, bold: true, align: "right", maxWidth: 78 });
        this.page.text(`Due ${due.dueOn} | ${due.status}`, MARGIN + 9, this.y + 20, { size: 6.3, color: COLOR.muted, maxWidth: columnWidth - 18 });
        this.page.text(`Paid ${money(this.report, due.paidMinor)}`, MARGIN + 9, this.y + 31, { size: 6.1, color: due.paidMinor >= due.amountMinor ? COLOR.green : COLOR.muted, maxWidth: columnWidth - 18 });
      } else {
        this.page.text("No additional dues", MARGIN + 9, this.y + 15, { size: 7, color: COLOR.muted });
      }
      const recurring = this.report.recurring[index];
      if (recurring) {
        const x = splitX + 10;
        this.page.text(recurring.note || recurring.categoryLabel, x, this.y + 5, { size: 7.8, bold: true, maxWidth: columnWidth - 101 });
        this.page.text(money(this.report, recurring.amountMinor), PAGE_WIDTH - MARGIN - 8, this.y + 5, { size: 7.6, bold: true, align: "right", maxWidth: 84 });
        this.page.text(`${recurring.kind.toUpperCase()} | ${recurring.scheduleLabel}`, x, this.y + 20, { size: 6.3, bold: true, color: recurring.kind === "income" ? COLOR.green : COLOR.coral, maxWidth: columnWidth - 18 });
        this.page.text(`Next ${recurring.nextDueOn} | ${recurring.categoryLabel}`, x, this.y + 31, { size: 6.1, color: COLOR.muted, maxWidth: columnWidth - 18 });
      } else {
        this.page.text("No additional recurring plans", splitX + 10, this.y + 15, { size: 7, color: COLOR.muted });
      }
      this.y += 42;
    }
    this.y += 10;
  }

  addFinancialDetails() {
    this.newPage("Financial details", "Monthly report");
    this.detailSnapshot();
    this.amountRows("Expense categories", "Complete category-wise spending", this.report.categories, COLOR.coral);
    this.amountRows("Earning sources", "Complete category-wise income", this.report.incomeCategories, COLOR.green);
    this.amountRows("Expense subcategories", "More detail inside each spending category", this.report.subcategories, COLOR.sage);
    this.budgets();
    this.accounts();
    this.simpleTable("Transfers", "Excluded from income and spending totals", this.report.transfers, "No transfers were recorded.", (page, transfer, y, index) => {
      if (index % 2 === 0) page.rect(MARGIN, y - 4, CONTENT_WIDTH, 40, "#ebe9dc");
      const from = this.report.accounts.find((account) => account.id === transfer.fromAccountId)?.label ?? "Unknown";
      const to = this.report.accounts.find((account) => account.id === transfer.toAccountId)?.label ?? "Unknown";
      page.text(transfer.occurredOn, MARGIN + 9, y + 5, { size: 7.5, color: COLOR.muted });
      page.text(`${from} -> ${to}`, MARGIN + 96, y + 4, { size: 8, bold: true, maxWidth: 280 });
      page.text(transfer.note || "No transfer note", MARGIN + 96, y + 20, { size: 6.8, color: COLOR.muted, maxWidth: 280 });
      page.text(money(this.report, transfer.amountMinor), PAGE_WIDTH - MARGIN - 8, y + 4, { size: 8.5, bold: true, color: COLOR.sage, align: "right" });
    }, 44);
    this.commitments();
  }

  private ledgerSnapshot() {
    this.page.text("REPORT TOTALS", MARGIN, this.y, { size: 6.5, bold: true, color: COLOR.sage });
    this.y += 15;
    const metrics = [
      { label: "INCOME", value: money(this.report, this.report.summary.incomeMinor, true), note: changeLabel(this.report.summary.incomeChangePercentage), color: COLOR.green },
      { label: "SPENDING", value: money(this.report, this.report.summary.expenseMinor, true), note: changeLabel(this.report.summary.expenseChangePercentage), color: COLOR.coral },
      { label: "NET CASH FLOW", value: money(this.report, this.report.summary.netMinor, true), note: `${this.report.summary.savingsRate}% savings rate`, color: this.report.summary.netMinor >= 0 ? COLOR.green : COLOR.coral },
      { label: "LEDGER ENTRIES", value: String(this.report.summary.transactionCount), note: `${new Set(this.report.transactions.map((item) => item.occurredOn)).size} active days`, color: COLOR.sage },
    ];
    const gap = 10;
    const cardWidth = (CONTENT_WIDTH - gap * 3) / metrics.length;
    metrics.forEach((metric, index) => {
      const x = MARGIN + index * (cardWidth + gap);
      this.page.roundRect(x, this.y, cardWidth, 48, 8, COLOR.paperStrong, COLOR.line);
      this.page.rect(x, this.y, 3, 48, metric.color);
      this.page.text(metric.label, x + 12, this.y + 9, { size: 6, bold: true, color: COLOR.muted, maxWidth: cardWidth - 20 });
      this.page.text(metric.value, x + 12, this.y + 23, { size: 10, bold: true, color: metric.color, maxWidth: cardWidth - 20 });
      this.page.text(metric.note, x + 12, this.y + 38, { size: 5.9, color: COLOR.muted, maxWidth: cardWidth - 20 });
    });
    this.y += 62;
  }

  private ledgerHeader() {
    this.page.rect(MARGIN, this.y, CONTENT_WIDTH, 24, COLOR.ink);
    const labels = [
      ["DATE", MARGIN + 8],
      ["TYPE", MARGIN + 73],
      ["CATEGORY", MARGIN + 119],
      ["DETAILS", MARGIN + 239],
      ["METHOD", MARGIN + 386],
    ] as const;
    labels.forEach(([label, x]) => this.page.text(label, x, this.y + 8, { size: 6.5, bold: true, color: COLOR.white }));
    this.page.text("AMOUNT", PAGE_WIDTH - MARGIN - 8, this.y + 8, { size: 6.5, bold: true, color: COLOR.white, align: "right" });
    this.y += 24;
  }

  addLedger() {
    this.newPage("Complete transaction ledger", "Monthly report");
    this.page.text(`${this.report.summary.transactionCount} entries recorded in ${this.report.monthLabel}`, MARGIN, 77, { size: 7.5, color: COLOR.muted });
    this.y = 94;
    this.ledgerSnapshot();
    this.ledgerHeader();
    if (!this.report.transactions.length) {
      this.page.text("No transactions were logged.", MARGIN + 8, this.y + 14, { size: 9, color: COLOR.muted });
      return;
    }
    this.report.transactions.forEach((transaction, index) => {
      if (this.y + 39 > 792) {
        this.newPage("Complete transaction ledger", "Continued");
        this.y = 92;
        this.ledgerHeader();
      }
      const rowHeight = 38;
      if (index % 2 === 0) this.page.rect(MARGIN, this.y, CONTENT_WIDTH, rowHeight, "#ebe9dc");
      const color = transaction.kind === "income" ? COLOR.green : COLOR.coral;
      this.page.text(transaction.occurredOn.slice(5), MARGIN + 8, this.y + 9, { size: 7.3, color: COLOR.muted });
      this.page.text(transaction.kind === "income" ? "IN" : "OUT", MARGIN + 73, this.y + 9, { size: 7, bold: true, color });
      this.page.text(transaction.categoryLabel, MARGIN + 119, this.y + 6, { size: 7.6, bold: true, maxWidth: 112 });
      if (transaction.subcategory) this.page.text(transaction.subcategory, MARGIN + 119, this.y + 19, { size: 6.5, color: COLOR.muted, maxWidth: 112 });
      const detail = transaction.note || "No note";
      const detailLines = wrap(detail, 138, 6.8, 2);
      detailLines.forEach((line, lineIndex) => this.page.text(line, MARGIN + 239, this.y + 6 + lineIndex * 10, { size: 6.8, color: lineIndex ? COLOR.muted : COLOR.ink, maxWidth: 138 }));
      this.page.text(transaction.paymentMode, MARGIN + 386, this.y + 6, { size: 7, color: COLOR.muted, maxWidth: 57 });
      const account = this.report.accounts.find((item) => item.id === transaction.paymentAccountId);
      if (account) this.page.text(account.label, MARGIN + 386, this.y + 20, { size: 6.2, color: COLOR.sage, maxWidth: 57 });
      this.page.text(money(this.report, transaction.amountMinor), PAGE_WIDTH - MARGIN - 8, this.y + 8, { size: 7.5, bold: true, color, align: "right", maxWidth: 82 });
      this.y += rowHeight;
    });
  }

  addFooters() {
    this.pages.forEach((page, index) => {
      page.line(MARGIN, 810, PAGE_WIDTH - MARGIN, 810, COLOR.line, 0.65);
      page.text("PRIVATE FINANCIAL REPORT", MARGIN, 818, { size: 6.5, bold: true, color: COLOR.muted });
      page.text(`Page ${index + 1} of ${this.pages.length}`, PAGE_WIDTH / 2, 818, { size: 6.5, color: COLOR.muted, align: "center" });
      page.text("SaveYoRupee", PAGE_WIDTH - MARGIN, 818, { size: 6.5, bold: true, color: COLOR.sage, align: "right" });
    });
  }
}

function pdfObject(id: number, body: string | Buffer) {
  return Buffer.concat([
    Buffer.from(`${id} 0 obj\n`, "ascii"),
    Buffer.isBuffer(body) ? body : Buffer.from(body, "ascii"),
    Buffer.from("\nendobj\n", "ascii"),
  ]);
}

function assemblePdf(pages: readonly PdfPage[]) {
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
    const content = page.content();
    objects.push(pdfObject(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`));
    objects.push(pdfObject(contentId, Buffer.concat([
      Buffer.from(`<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n`, "ascii"),
      Buffer.from(content, "ascii"),
      Buffer.from("\nendstream", "ascii"),
    ])));
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

export function generateMonthlyReportPdf(report: MonthlyReport) {
  const renderer = new FlowRenderer(report, drawCoverPage(report));
  renderer.addFinancialDetails();
  renderer.addLedger();
  renderer.addFooters();
  return assemblePdf(renderer.pages);
}
