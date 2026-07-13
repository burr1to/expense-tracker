import {
  AirplaneTilt,
  BookOpenText,
  Briefcase,
  Bus,
  ForkKnife,
  Gift,
  GraduationCap,
  Heartbeat,
  HouseLine,
  Lightning,
  Money,
  ShoppingBagOpen,
  Sparkle,
  type Icon,
} from "@phosphor-icons/react";
import type { TransactionCategory } from "../types";

const icons: Record<string, Icon> = {
  salary: Money,
  freelance: Briefcase,
  gift: Gift,
  housing: HouseLine,
  food: ForkKnife,
  transport: Bus,
  utilities: Lightning,
  shopping: ShoppingBagOpen,
  health: Heartbeat,
  entertainment: Sparkle,
  education: GraduationCap,
  travel: AirplaneTilt,
  other: BookOpenText,
};

export function CategoryIcon({ category, size = 20 }: { category: TransactionCategory; size?: number }) {
  const IconComponent = icons[category] ?? BookOpenText;
  return <IconComponent size={size} weight="regular" aria-hidden="true" />;
}
