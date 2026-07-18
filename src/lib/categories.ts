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

export interface SubcategoryDefinition { label: string; options: readonly string[]; areaLabel?: string; areaPlaceholder?: string }

export const SUBCATEGORIES: Readonly<Record<string, SubcategoryDefinition>> = {
  salary: { label: "Income type", options: ["Salary", "Bonus", "Allowance", "Reimbursement"] },
  freelance: { label: "Work type", options: ["Project", "Consulting", "Contract", "Commission"] },
  gift: { label: "Gift type", options: ["Cash gift", "Festival", "Wedding", "Prize"] },
  housing: { label: "Housing type", options: ["Rent", "Maintenance", "Furniture", "Home supplies", "Property tax"] },
  food: { label: "Food type", options: ["Lunch", "Groceries", "Snacks", "Cafe", "Restaurant"], areaLabel: "Food area", areaPlaceholder: "Where was it purchased?" },
  transport: { label: "Transport type", options: ["Public transport", "Taxi / ride", "Fuel", "Parking", "Repairs"] },
  utilities: { label: "Utility type", options: ["Electricity", "Water", "Internet", "Mobile", "Gas"] },
  shopping: { label: "Shopping type", options: ["Clothing", "Electronics", "Household", "Personal care", "Gifts"] },
  health: { label: "Health type", options: ["Doctor", "Medicine", "Dental", "Lab test", "Insurance"] },
  entertainment: { label: "Entertainment type", options: ["Movies", "Music", "Games", "Events", "Subscriptions"] },
  education: { label: "Education type", options: ["Tuition", "Books", "Courses", "Supplies", "Exam fees"] },
  travel: { label: "Travel type", options: ["Transport", "Stay", "Food", "Activities", "Visa / fees"] },
  other: { label: "Subcategory", options: [] },
};

export function subcategoriesFor(category: TransactionCategory): SubcategoryDefinition {
  return SUBCATEGORIES[category] ?? { label: "Subcategory", options: [] };
}
