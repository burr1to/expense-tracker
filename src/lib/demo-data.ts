import { addMonths, format } from "date-fns";
import type { Budget, LedgerTransaction, Profile, RecurringEntry, SavingsGoal } from "../types";

export const DEMO_PROFILE: Profile = {
  id: "demo-user",
  displayName: "Suman",
  currency: "NPR",
  hideAmounts: false,
  autoLockMinutes: 0,
  hasPin: false,
};

const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, "0");
const date = (day: number) => `${year}-${month}-${String(day).padStart(2, "0")}`;
const cashPayment = {
  subcategory: null,
  area: null,
  paymentMode: "cash",
  paymentAccountId: null,
  locationLabel: null,
  locationAddress: null,
  locationLatitude: null,
  locationLongitude: null,
  locationAccuracy: null,
  locationSource: null,
  savedPlaceId: null,
} as const;

export const DEMO_TRANSACTIONS: LedgerTransaction[] = [
  { id: "d1", userId: "demo-user", kind: "income", category: "salary", amountMinor: 8540000, occurredOn: date(10), note: "Monthly salary", ...cashPayment, createdAt: new Date().toISOString() },
  { id: "d2", userId: "demo-user", kind: "expense", category: "housing", amountMinor: 2000000, occurredOn: date(2), note: "Apartment rent", ...cashPayment, subcategory: "Rent", createdAt: new Date().toISOString() },
  { id: "d3", userId: "demo-user", kind: "expense", category: "food", amountMinor: 165000, occurredOn: date(11), note: "Groceries", ...cashPayment, subcategory: "Groceries", area: "Bhatbhateni", createdAt: new Date().toISOString() },
  { id: "d4", userId: "demo-user", kind: "expense", category: "transport", amountMinor: 21000, occurredOn: date(11), note: "Pathao ride", ...cashPayment, subcategory: "Taxi / ride", createdAt: new Date().toISOString() },
  { id: "d5", userId: "demo-user", kind: "expense", category: "utilities", amountMinor: 425000, occurredOn: date(8), note: "Electricity and internet", ...cashPayment, subcategory: "Electricity", createdAt: new Date().toISOString() },
  { id: "d6", userId: "demo-user", kind: "expense", category: "shopping", amountMinor: 112000, occurredOn: date(10), note: "Sastodeal", ...cashPayment, createdAt: new Date().toISOString() },
  { id: "d7", userId: "demo-user", kind: "expense", category: "food", amountMinor: 28000, occurredOn: date(10), note: "Coffee", ...cashPayment, subcategory: "Cafe", createdAt: new Date().toISOString() },
  { id: "d8", userId: "demo-user", kind: "expense", category: "food", amountMinor: 840000, occurredOn: date(5), note: "Weekly groceries", ...cashPayment, subcategory: "Groceries", createdAt: new Date().toISOString() },
  { id: "d9", userId: "demo-user", kind: "expense", category: "transport", amountMinor: 510000, occurredOn: date(6), note: "Fuel and taxis", ...cashPayment, subcategory: "Fuel", createdAt: new Date().toISOString() },
  { id: "d10", userId: "demo-user", kind: "expense", category: "entertainment", amountMinor: 735000, occurredOn: date(7), note: "Weekend", ...cashPayment, createdAt: new Date().toISOString() },
  { id: "d11", userId: "demo-user", kind: "expense", category: "health", amountMinor: 640000, occurredOn: date(9), note: "Pharmacy", ...cashPayment, subcategory: "Medicine", createdAt: new Date().toISOString() },
  { id: "d12", userId: "demo-user", kind: "expense", category: "other", amountMinor: 459000, occurredOn: date(4), note: "Household", ...cashPayment, createdAt: new Date().toISOString() },
];

export const DEMO_BUDGETS: Budget[] = [
  { id: "b1", userId: "demo-user", monthKey: `${year}-${month}`, category: "food", amountMinor: 1500000 },
  { id: "b2", userId: "demo-user", monthKey: `${year}-${month}`, category: "transport", amountMinor: 800000 },
  { id: "b3", userId: "demo-user", monthKey: `${year}-${month}`, category: "shopping", amountMinor: 500000 },
];

export const DEMO_GOALS: SavingsGoal[] = [
  {
    id: "g1", userId: "demo-user", name: "Emergency fund", targetMinor: 30000000, savedMinor: 12800000, targetDate: `${year + 1}-01-31`,
    contributions: [
      { id: "gc2", userId: "demo-user", goalId: "g1", amountMinor: 4800000, isOpeningBalance: false, createdAt: new Date(year, now.getMonth(), 12, 9, 30).toISOString() },
      { id: "gc1", userId: "demo-user", goalId: "g1", amountMinor: 8000000, isOpeningBalance: false, createdAt: new Date(year, now.getMonth() - 1, 10, 9, 30).toISOString() },
    ],
  },
];

export const DEMO_RECURRING: RecurringEntry[] = [
  { id: "r1", userId: "demo-user", kind: "income", category: "salary", amountMinor: 8540000, note: "Monthly salary", tags: ["work"], dayOfMonth: 10, recurrenceUnit: "month", recurrenceInterval: 1, anchorDate: format(now, "yyyy-MM-10"), nextDueOn: format(addMonths(now, 1), "yyyy-MM-10"), active: true },
  { id: "r2", userId: "demo-user", kind: "expense", category: "housing", amountMinor: 2000000, note: "Apartment rent", tags: ["essential"], dayOfMonth: 2, recurrenceUnit: "month", recurrenceInterval: 1, anchorDate: format(now, "yyyy-MM-02"), nextDueOn: format(addMonths(now, 1), "yyyy-MM-02"), active: true },
  { id: "r3", userId: "demo-user", kind: "expense", category: "entertainment", amountMinor: 39900, note: "Music subscription", tags: ["subscription"], dayOfMonth: now.getDate(), recurrenceUnit: "month", recurrenceInterval: 1, anchorDate: format(now, "yyyy-MM-dd"), nextDueOn: format(now, "yyyy-MM-dd"), active: true },
];
