import { addDays, addMonths, addYears, format, startOfDay } from "date-fns";

export type SpendingPeriod = "weekly" | "biweekly" | "monthly" | "quarterly" | "semiannual" | "annual";

export const spendingPeriodOptions: { value: SpendingPeriod; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semiannual", label: "Semi-annually" },
  { value: "annual", label: "Annually" },
];

export function spendingPeriodRange(period: SpendingPeriod, through: Date) {
  const end = startOfDay(through);
  let start: Date;

  switch (period) {
    case "weekly":
      start = addDays(end, -6);
      break;
    case "biweekly":
      start = addDays(end, -13);
      break;
    case "monthly":
      start = addDays(addMonths(end, -1), 1);
      break;
    case "quarterly":
      start = addDays(addMonths(end, -3), 1);
      break;
    case "semiannual":
      start = addDays(addMonths(end, -6), 1);
      break;
    case "annual":
      start = addDays(addYears(end, -1), 1);
      break;
  }

  return {
    start,
    end,
    startKey: format(start, "yyyy-MM-dd"),
    endKey: format(end, "yyyy-MM-dd"),
  };
}
