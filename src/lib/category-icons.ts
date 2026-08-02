import type { CategoryIconName } from "../types";

export const CATEGORY_ICON_NAMES = ["tag", "money", "work", "gift", "home", "food", "transport", "utilities", "shopping", "health", "entertainment", "education", "travel"] as const satisfies readonly CategoryIconName[];

export const CATEGORY_ICON_OPTIONS: readonly { value: CategoryIconName; label: string }[] = [
  { value: "tag", label: "General" },
  { value: "money", label: "Money" },
  { value: "work", label: "Work" },
  { value: "gift", label: "Gift" },
  { value: "home", label: "Home" },
  { value: "food", label: "Food" },
  { value: "transport", label: "Transport" },
  { value: "utilities", label: "Utilities" },
  { value: "shopping", label: "Shopping" },
  { value: "health", label: "Health" },
  { value: "entertainment", label: "Entertainment" },
  { value: "education", label: "Education" },
  { value: "travel", label: "Travel" },
];
