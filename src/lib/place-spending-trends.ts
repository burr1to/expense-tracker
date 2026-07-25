import { addDays, addMonths, format, startOfDay } from "date-fns";
import type { LedgerTransaction, SavedPlace, SavedPlaceIconName } from "../types";

export type PlaceTrendPeriodMonths = 1 | 3 | 6 | 12;
export type PlaceTrendDriver = "frequency" | "average" | "both" | "steady";

export const placeTrendPeriodOptions: { value: PlaceTrendPeriodMonths; shortLabel: string; label: string }[] = [
  { value: 1, shortLabel: "1M", label: "1 month" },
  { value: 3, shortLabel: "3M", label: "3 months" },
  { value: 6, shortLabel: "6M", label: "6 months" },
  { value: 12, shortLabel: "12M", label: "12 months" },
];

export interface PlaceSpendingTrend {
  key: string;
  label: string;
  address: string;
  icon: SavedPlaceIconName;
  currentTotalMinor: number;
  previousTotalMinor: number;
  currentPurchases: number;
  previousPurchases: number;
  currentAverageMinor: number;
  previousAverageMinor: number;
  totalChangePercent: number;
  averageChangePercent: number;
  purchaseChange: number;
  driver: PlaceTrendDriver;
}

export function transactionPlaceKey(transaction: LedgerTransaction) {
  if (transaction.savedPlaceId) return transaction.savedPlaceId;
  if (transaction.locationLatitude == null || transaction.locationLongitude == null) return null;
  return `${transaction.locationLatitude.toFixed(5)}-${transaction.locationLongitude.toFixed(5)}`;
}

export function placeTrendRanges(periodMonths: PlaceTrendPeriodMonths, through: Date) {
  const currentEnd = startOfDay(through);
  const currentStart = addDays(addMonths(currentEnd, -periodMonths), 1);
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(addMonths(previousEnd, -periodMonths), 1);
  return {
    currentStartKey: format(currentStart, "yyyy-MM-dd"),
    currentEndKey: format(currentEnd, "yyyy-MM-dd"),
    previousStartKey: format(previousStart, "yyyy-MM-dd"),
    previousEndKey: format(previousEnd, "yyyy-MM-dd"),
  };
}

function percentageChange(current: number, previous: number) {
  if (!previous) return 0;
  return Math.round(((current - previous) / previous) * 100);
}

function trendDriver(currentTotal: number, previousTotal: number, currentPurchases: number, previousPurchases: number): PlaceTrendDriver {
  const delta = currentTotal - previousTotal;
  if (Math.abs(delta) <= Math.max(100, previousTotal * 0.05)) return "steady";
  const previousAverage = previousTotal / previousPurchases;
  const currentAverage = currentTotal / currentPurchases;
  const frequencyEffect = (currentPurchases - previousPurchases) * previousAverage;
  const averageEffect = (currentAverage - previousAverage) * currentPurchases;
  const frequencyWeight = Math.abs(frequencyEffect);
  const averageWeight = Math.abs(averageEffect);
  if (frequencyWeight >= averageWeight * 1.4) return "frequency";
  if (averageWeight >= frequencyWeight * 1.4) return "average";
  return "both";
}

export function calculatePlaceSpendingTrends(
  transactions: readonly LedgerTransaction[],
  savedPlaces: readonly SavedPlace[],
  periodMonths: PlaceTrendPeriodMonths,
  through: Date,
): PlaceSpendingTrend[] {
  const ranges = placeTrendRanges(periodMonths, through);
  const savedById = new Map(savedPlaces.map((place) => [place.id, place]));
  const grouped = new Map<string, {
    label: string;
    address: string;
    icon: SavedPlaceIconName;
    currentTotalMinor: number;
    previousTotalMinor: number;
    currentPurchases: number;
    previousPurchases: number;
  }>();

  transactions.forEach((transaction) => {
    if (transaction.kind !== "expense") return;
    const key = transactionPlaceKey(transaction);
    if (!key) return;
    const inCurrent = transaction.occurredOn >= ranges.currentStartKey && transaction.occurredOn <= ranges.currentEndKey;
    const inPrevious = transaction.occurredOn >= ranges.previousStartKey && transaction.occurredOn <= ranges.previousEndKey;
    if (!inCurrent && !inPrevious) return;
    const saved = transaction.savedPlaceId ? savedById.get(transaction.savedPlaceId) : undefined;
    const group = grouped.get(key) ?? {
      label: saved?.name ?? transaction.locationLabel ?? transaction.area ?? "Pinned location",
      address: saved?.address ?? transaction.locationAddress ?? "Kathmandu, Nepal",
      icon: saved?.icon ?? "pin",
      currentTotalMinor: 0,
      previousTotalMinor: 0,
      currentPurchases: 0,
      previousPurchases: 0,
    };
    if (inCurrent) {
      group.currentTotalMinor += transaction.amountMinor;
      group.currentPurchases += 1;
    } else {
      group.previousTotalMinor += transaction.amountMinor;
      group.previousPurchases += 1;
    }
    grouped.set(key, group);
  });

  return [...grouped.entries()].flatMap(([key, group]): PlaceSpendingTrend[] => {
    if (!group.currentPurchases || !group.previousPurchases || group.currentPurchases + group.previousPurchases < 3) return [];
    const currentAverageMinor = Math.round(group.currentTotalMinor / group.currentPurchases);
    const previousAverageMinor = Math.round(group.previousTotalMinor / group.previousPurchases);
    return [{
      key,
      label: group.label,
      address: group.address,
      icon: group.icon,
      currentTotalMinor: group.currentTotalMinor,
      previousTotalMinor: group.previousTotalMinor,
      currentPurchases: group.currentPurchases,
      previousPurchases: group.previousPurchases,
      currentAverageMinor,
      previousAverageMinor,
      totalChangePercent: percentageChange(group.currentTotalMinor, group.previousTotalMinor),
      averageChangePercent: percentageChange(currentAverageMinor, previousAverageMinor),
      purchaseChange: group.currentPurchases - group.previousPurchases,
      driver: trendDriver(group.currentTotalMinor, group.previousTotalMinor, group.currentPurchases, group.previousPurchases),
    }];
  }).sort((a, b) =>
    Math.abs(b.currentTotalMinor - b.previousTotalMinor) - Math.abs(a.currentTotalMinor - a.previousTotalMinor)
    || b.currentTotalMinor - a.currentTotalMinor,
  );
}
