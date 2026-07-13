import type { CategoryDefinition, CustomCategory, TransactionCategory } from "../types";

export const CATEGORIES: readonly CategoryDefinition[] = [
  { id: "salary", label: "Salary", kind: "income", color: "#2b8a50" },
  { id: "freelance", label: "Freelance", kind: "income", color: "#427d62" },
  { id: "gift", label: "Gift", kind: "income", color: "#6a8f78" },
  { id: "housing", label: "Housing", kind: "expense", color: "#5f5ce6" },
  { id: "food", label: "Food & Dining", kind: "expense", color: "#e8675a" },
  { id: "transport", label: "Transport", kind: "expense", color: "#2878c8" },
  { id: "utilities", label: "Utilities", kind: "expense", color: "#8867c7" },
  { id: "shopping", label: "Shopping", kind: "expense", color: "#d69531" },
  { id: "health", label: "Health", kind: "expense", color: "#dc5877" },
  { id: "entertainment", label: "Entertainment", kind: "expense", color: "#705ea8" },
  { id: "education", label: "Education", kind: "expense", color: "#3a8e91" },
  { id: "travel", label: "Travel", kind: "expense", color: "#3b70a2" },
  { id: "other", label: "Other", kind: "both", color: "#8a857e" },
] as const;

export function getCategory(category: TransactionCategory, custom: readonly CustomCategory[] = []): CategoryDefinition {
  return custom.find((item) => item.id === category) ?? CATEGORIES.find((item) => item.id === category) ?? { ...CATEGORIES[CATEGORIES.length - 1], label: category };
}

export function categoriesFor(kind: "income" | "expense"): readonly CategoryDefinition[] {
  return CATEGORIES.filter((category) => category.kind === kind || category.kind === "both");
}

export function allCategoriesFor(kind: "income" | "expense", custom: readonly CustomCategory[] = []): readonly CategoryDefinition[] {
  return [...categoriesFor(kind), ...custom.filter((category) => category.kind === kind || category.kind === "both")];
}
