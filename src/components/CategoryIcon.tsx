import type { IconWeight } from "@phosphor-icons/react";
import type { CategoryIconName, TransactionCategory } from "../types";
import { LedgerIcon } from "./LedgerIcon";

const icons: Record<string, CategoryIconName> = {
  salary: "money", freelance: "work", gift: "gift", housing: "home", food: "food",
  transport: "transport", utilities: "utilities", shopping: "shopping", health: "health",
  entertainment: "entertainment", education: "education", travel: "travel", loan: "loan", other: "tag",
};

export function CategoryIcon({ category, icon, size = 20, weight }: { category: TransactionCategory; icon?: CategoryIconName; size?: number; weight?: IconWeight }) {
  return <LedgerIcon icon={icon ?? icons[category] ?? "tag"} size={size} weight={weight} />;
}
