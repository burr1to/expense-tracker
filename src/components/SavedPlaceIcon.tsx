import { Buildings, ForkKnife, Heartbeat, House, MapPin, ShoppingBag, Star } from "@phosphor-icons/react";
import type { SavedPlaceIconName } from "../types";

export function SavedPlaceIcon({ icon, size = 18, weight = "duotone" }: { icon: SavedPlaceIconName; size?: number; weight?: "regular" | "fill" | "duotone" }) {
  const props = { size, weight };
  if (icon === "home") return <House {...props} />;
  if (icon === "work") return <Buildings {...props} />;
  if (icon === "food") return <ForkKnife {...props} />;
  if (icon === "shopping") return <ShoppingBag {...props} />;
  if (icon === "health") return <Heartbeat {...props} />;
  if (icon === "favorite") return <Star {...props} />;
  return <MapPin {...props} />;
}
