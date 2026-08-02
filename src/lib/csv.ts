import { CATEGORIES } from "./categories";
import type { CustomCategory, PaymentAccount, PaymentMode, TransactionDraft } from "../types";

export interface CsvParseResult { rows: TransactionDraft[]; errors: string[] }

export const TRANSACTION_CSV_TEMPLATE = `date,type,category,subcategory,area,note,amount,payment mode,payment account id
2026-07-15,expense,Food & Dining,Lunch,Thamel,"Lunch, team",1250,cash,
2026-07-15,income,Salary,Salary,,Monthly salary,85000,cash,`;

function parseLine(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(value.trim()); value = ""; }
    else value += character;
  }
  cells.push(value.trim());
  return cells;
}

export function parseTransactionCsv(csv: string, customCategories: readonly CustomCategory[] = [], paymentAccounts: readonly PaymentAccount[] = []): CsvParseResult {
  const lines = csv.replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n").filter((line) => line.trim());
  if (lines.length < 2) return { rows: [], errors: ["The CSV needs a header and at least one data row."] };
  const headers = parseLine(lines[0]).map((header) => header.toLowerCase());
  const required = ["date", "type", "category", "amount"];
  const missing = required.filter((column) => !headers.includes(column));
  if (missing.length) return { rows: [], errors: [`Missing columns: ${missing.join(", ")}.`] };
  const categoryEntries: [string, string][] = [
    ...CATEGORIES.map((item): [string, string] => [item.label.toLowerCase(), item.id]),
    ...CATEGORIES.map((item): [string, string] => [item.id, item.id]),
    ...customCategories.map((item): [string, string] => [item.name.toLowerCase(), item.id]),
  ];
  const validCategories = new Map<string, string>(categoryEntries);
  const errors: string[] = [];
  const rows: TransactionDraft[] = [];
  lines.slice(1).forEach((line, rowIndex) => {
    const cells = parseLine(line);
    const get = (column: string) => cells[headers.indexOf(column)]?.trim() ?? "";
    const kind = get("type").toLowerCase();
    const category = validCategories.get(get("category").toLowerCase());
    const amount = get("amount").replace(/[^0-9.-]/g, "");
    const date = get("date");
    const paymentMode = (get("payment mode").toLowerCase() || "cash") as PaymentMode;
    const paymentAccountImportId = get("payment account id");
    const paymentAccount = paymentAccounts.find((account) => account.importId === paymentAccountImportId || account.id === paymentAccountImportId);
    const rowErrors: string[] = [];
    if (kind !== "income" && kind !== "expense") rowErrors.push("type must be income or expense");
    if (!category) rowErrors.push("category is unknown");
    if (!(Number(amount) > 0)) rowErrors.push("amount must be positive");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) rowErrors.push("date must be YYYY-MM-DD");
    if (!["cash", "cheque", "online"].includes(paymentMode)) rowErrors.push("payment mode must be cash, cheque, or online");
    if (paymentMode === "online" && !paymentAccount) rowErrors.push("online payment account id is missing or unknown");
    if (rowErrors.length) errors.push(`Row ${rowIndex + 2}: ${rowErrors.join("; ")}.`);
    else rows.push({ kind: kind as "income" | "expense", category: category!, amount, occurredOn: date, note: get("note").slice(0, 80), subcategory: get("subcategory").slice(0, 80), area: get("area").slice(0, 120), paymentMode, paymentAccountId: paymentMode === "online" ? paymentAccount!.id : "" });
  });
  return { rows, errors };
}
