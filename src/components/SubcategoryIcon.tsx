import {
  AirplaneTilt, BagSimple, Bed, BookOpenText, BowlFood, Briefcase, Bus, Car, Carrot, Certificate,
  Coffee, Confetti, CurrencyDollar, DeviceMobile, Drop, FileText, FilmSlate, Flame, ForkKnife,
  GameController, GasPump, Gift, GraduationCap, Hammer, HandCoins, HouseLine, Lightning, MapPin, MusicNote,
  PaintBrushHousehold, PencilLine, Pill, Receipt, ShieldCheck, ShoppingCart, Sparkle, Storefront,
  Stethoscope, Taxi, TestTube, Ticket, Tooth, TShirt, Wallet, Wrench, type Icon,
} from "@phosphor-icons/react";

const icons: Record<string, Icon> = {
  Salary: CurrencyDollar, Bonus: Sparkle, Allowance: Wallet, Reimbursement: Receipt,
  Project: Briefcase, Consulting: Briefcase, Contract: FileText, Commission: HandCoins,
  "Cash gift": Gift, Festival: Confetti, Wedding: Gift, Prize: Sparkle,
  Rent: HouseLine, Maintenance: Wrench, Furniture: Hammer, "Home supplies": PaintBrushHousehold, "Property tax": Receipt,
  Lunch: BowlFood, Groceries: ShoppingCart, Snacks: Carrot, Cafe: Coffee, Restaurant: ForkKnife,
  "Public transport": Bus, "Taxi / ride": Taxi, Fuel: GasPump, Parking: Car, Repairs: Wrench,
  Electricity: Lightning, Water: Drop, Internet: DeviceMobile, Mobile: DeviceMobile, Gas: Flame,
  Clothing: TShirt, Electronics: DeviceMobile, Household: BagSimple, "Personal care": Sparkle, Gifts: Gift,
  Doctor: Stethoscope, Medicine: Pill, Dental: Tooth, "Lab test": TestTube, Insurance: ShieldCheck,
  Movies: FilmSlate, Music: MusicNote, Games: GameController, Events: Ticket, Subscriptions: Receipt,
  Tuition: GraduationCap, Books: BookOpenText, Courses: Certificate, Supplies: PencilLine, "Exam fees": Receipt,
  Transport: AirplaneTilt, Stay: Bed, Food: ForkKnife, Activities: MapPin, "Visa / fees": FileText,
};

export function SubcategoryIcon({ subcategory, size = 19 }: { subcategory: string; size?: number }) {
  const IconComponent = icons[subcategory] ?? Storefront;
  return <IconComponent size={size} weight="regular" aria-hidden="true" />;
}
