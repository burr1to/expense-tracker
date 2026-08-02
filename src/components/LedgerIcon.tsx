import {
  AirplaneTilt, BookOpenText, Briefcase, Bus, ForkKnife, Gift, GraduationCap, Heartbeat,
  HouseLine, Lightning, Money, ShoppingBagOpen, Sparkle, Tag, type Icon,
} from "@phosphor-icons/react";
import type { CategoryIconName } from "../types";

const icons: Record<CategoryIconName, Icon> = {
  tag: Tag,
  money: Money,
  work: Briefcase,
  gift: Gift,
  home: HouseLine,
  food: ForkKnife,
  transport: Bus,
  utilities: Lightning,
  shopping: ShoppingBagOpen,
  health: Heartbeat,
  entertainment: Sparkle,
  education: GraduationCap,
  travel: AirplaneTilt,
};

export function LedgerIcon({ icon, size = 20 }: { icon: CategoryIconName; size?: number }) {
  const IconComponent = icons[icon] ?? BookOpenText;
  return <IconComponent size={size} weight="regular" aria-hidden="true" />;
}
