import { CATEGORIES, SUBCATEGORIES } from "./categories";
import type { CategoryIconName, CustomCategory, CustomSubcategory, PaymentAccount, PaymentMode, TransactionDraft, TransactionKind } from "../types";

export interface CsvCategoryDraft { key: string; name: string; kind: TransactionKind | "both"; icon: CategoryIconName }
export interface CsvSubcategoryDraft { key: string; category: string; name: string; icon: CategoryIconName }
export interface CsvParseResult { rows: TransactionDraft[]; errors: string[]; newCategories: CsvCategoryDraft[]; newSubcategories: CsvSubcategoryDraft[] }

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

const subcategoryKey = (category: string, name: string) => `csvsub:${category}:${name.toLowerCase()}`;

export function parseTransactionCsv(csv: string, customCategories: readonly CustomCategory[] = [], paymentAccounts: readonly PaymentAccount[] = [], customSubcategories: readonly CustomSubcategory[] = []): CsvParseResult {
  const lines = csv.replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n").filter((line) => line.trim());
  if (lines.length < 2) return { rows: [], errors: ["The CSV needs a header and at least one data row."], newCategories: [], newSubcategories: [] };
  const headers = parseLine(lines[0]).map((header) => header.toLowerCase());
  const required = ["date", "type", "category", "amount"];
  const missing = required.filter((column) => !headers.includes(column));
  if (missing.length) return { rows: [], errors: [`Missing columns: ${missing.join(", ")}.`], newCategories: [], newSubcategories: [] };
  const categoryEntries: [string, string][] = [
    ...CATEGORIES.map((item): [string, string] => [item.label.toLowerCase(), item.id]),
    ...CATEGORIES.map((item): [string, string] => [item.id, item.id]),
    ...customCategories.map((item): [string, string] => [item.name.toLowerCase(), item.id]),
  ];
  const validCategories = new Map<string, string>(categoryEntries);
  const errors: string[] = [];
  const rows: TransactionDraft[] = [];
  const newCategories = new Map<string, CsvCategoryDraft>();
  const newSubcategories = new Map<string, CsvSubcategoryDraft>();
  lines.slice(1).forEach((line, rowIndex) => {
    const cells = parseLine(line);
    const get = (column: string) => cells[headers.indexOf(column)]?.trim() ?? "";
    const kind = get("type").toLowerCase();
    const categoryName = get("category");
    const normalizedCategory = categoryName.toLowerCase();
    let category = validCategories.get(normalizedCategory);
    const amount = get("amount").replace(/[^0-9.-]/g, "");
    const date = get("date");
    const paymentMode = (get("payment mode").toLowerCase() || "cash") as PaymentMode;
    const paymentAccountImportId = get("payment account id");
    const paymentAccount = paymentAccounts.find((account) => account.importId === paymentAccountImportId || account.id === paymentAccountImportId);
    const rowErrors: string[] = [];
    if (kind !== "income" && kind !== "expense") rowErrors.push("type must be income or expense");
    if (!categoryName) rowErrors.push("category is required");
    else if (!category && categoryName.length > 30) rowErrors.push("new category names must be 30 characters or fewer");
    else if (!category && (kind === "income" || kind === "expense")) {
      const key = `csv:${normalizedCategory}`;
      const existing = newCategories.get(key);
      newCategories.set(key, { key, name: existing?.name ?? categoryName, kind: existing && existing.kind !== kind ? "both" : kind as TransactionKind, icon: existing?.icon ?? "tag" });
      category = key;
    }
    const subcategoryName = get("subcategory");
    let subcategory = subcategoryName;
    if (subcategoryName.length > 80) rowErrors.push("new subcategory names must be 80 characters or fewer");
    else if (category && subcategoryName) {
      const existingSubcategory = [
        ...(SUBCATEGORIES[category]?.options ?? []),
        ...customSubcategories.filter((item) => item.categoryId === category).map((item) => item.name),
      ].find((name) => name.toLowerCase() === subcategoryName.toLowerCase());
      if (existingSubcategory) subcategory = existingSubcategory;
      else {
        const key = subcategoryKey(category, subcategoryName);
        newSubcategories.set(key, { key, category, name: subcategoryName, icon: "tag" });
      }
    }
    if (!(Number(amount) > 0)) rowErrors.push("amount must be positive");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) rowErrors.push("date must be YYYY-MM-DD");
    if (!["cash", "cheque", "online"].includes(paymentMode)) rowErrors.push("payment mode must be cash, cheque, or online");
    if (paymentMode === "online" && !paymentAccount) rowErrors.push("online payment account id is missing or unknown");
    if (rowErrors.length) errors.push(`Row ${rowIndex + 2}: ${rowErrors.join("; ")}.`);
    else rows.push({ kind: kind as "income" | "expense", category: category!, amount, occurredOn: date, note: get("note").slice(0, 80), subcategory, area: get("area").slice(0, 120), paymentMode, paymentAccountId: paymentMode === "online" ? paymentAccount!.id : "" });
  });
  const usedCategoryIds = new Set(rows.map((row) => row.category));
  const usedSubcategoryKeys = new Set(rows.filter((row) => row.subcategory).map((row) => subcategoryKey(row.category, row.subcategory)));
  return {
    rows,
    errors,
    newCategories: [...newCategories.values()].filter((category) => usedCategoryIds.has(category.key)),
    newSubcategories: [...newSubcategories.values()].filter((subcategory) => usedSubcategoryKeys.has(subcategory.key)),
  };
}
