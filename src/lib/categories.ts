import type { CategoryDefinition, CustomCategory, CustomSubcategory, TransactionCategory } from "../types";

export const CATEGORIES: readonly CategoryDefinition[] = [
  { id: "salary", label: "Salary", kind: "income", color: "#3f6653", icon: "money" },
  { id: "freelance", label: "Freelance", kind: "income", color: "#557f69", icon: "work" },
  { id: "gift", label: "Gift", kind: "income", color: "#789685", icon: "gift" },
  { id: "housing", label: "Housing", kind: "expense", color: "#745d56", icon: "home" },
  { id: "food", label: "Food & Dining", kind: "expense", color: "#8f4c49", icon: "food" },
  { id: "transport", label: "Transport", kind: "expense", color: "#9b625a", icon: "transport" },
  { id: "utilities", label: "Utilities", kind: "expense", color: "#80635b", icon: "utilities" },
  { id: "shopping", label: "Shopping", kind: "expense", color: "#a77662", icon: "shopping" },
  { id: "health", label: "Health", kind: "expense", color: "#995b59", icon: "health" },
  { id: "entertainment", label: "Entertainment", kind: "expense", color: "#826a5d", icon: "entertainment" },
  { id: "education", label: "Education", kind: "expense", color: "#916b61", icon: "education" },
  { id: "travel", label: "Travel", kind: "expense", color: "#a48470", icon: "travel" },
  { id: "other", label: "Other", kind: "both", color: "#6c7069", icon: "tag" },
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

export function subcategoryOptionsFor(category: TransactionCategory, custom: readonly CustomSubcategory[] = []) {
  return [
    ...subcategoriesFor(category).options.map((name) => ({ name, icon: undefined })),
    ...custom.filter((item) => item.categoryId === category).map((item) => ({ name: item.name, icon: item.icon })),
  ];
}

const importedCategoryColors = ["#557f69", "#789685", "#8f4c49", "#a76d62", "#745d56", "#80635b"] as const;

export function importedCategoryColor(name: string) {
  const hash = [...name.toLowerCase()].reduce((total, character) => total + character.charCodeAt(0), 0);
  return importedCategoryColors[hash % importedCategoryColors.length];
}
