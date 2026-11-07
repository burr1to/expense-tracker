import { Briefcase, Confetti, FlowerLotus, FolderSimple, Gift, GraduationCap, Heart, Heartbeat, House, Island, Mountains, SuitcaseRolling } from "@phosphor-icons/react";
import type { TransactionGroupIconName } from "../types";

const icons: Record<TransactionGroupIconName, typeof House> = {
  trip: SuitcaseRolling,
  mountain: Mountains,
  beach: Island,
  party: Confetti,
  festival: FlowerLotus,
  wedding: Heart,
  home: House,
  work: Briefcase,
  gift: Gift,
  health: Heartbeat,
  education: GraduationCap,
  folder: FolderSimple,
};

export function GroupIcon({ icon, size = 20, weight = "duotone" }: { icon: TransactionGroupIconName; size?: number; weight?: "regular" | "fill" | "duotone" | "bold" }) {
  const Icon = icons[icon] ?? FolderSimple;
  return <Icon size={size} weight={weight} />;
}
