import { addMonths, format } from "date-fns";
import type { Budget, LedgerTransaction, Profile, RecurringEntry, SavingsGoal } from "../types";

export const DEMO_PROFILE: Profile = {
  id: "demo-user",
  displayName: "Suman",
  currency: "NPR",
  theme: "light",
  hideAmounts: false,
  autoLockMinutes: 0,
};

const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, "0");
const date = (day: number) => `${year}-${month}-${String(day).padStart(2, "0")}`;

export const DEMO_TRANSACTIONS: LedgerTransaction[] = [
  { id: "d1", userId: "demo-user", kind: "income", category: "salary", amountMinor: 8540000, occurredOn: date(10), note: "Monthly salary", tags: ["work"], createdAt: new Date().toISOString() },
  { id: "d2", userId: "demo-user", kind: "expense", category: "housing", amountMinor: 2000000, occurredOn: date(2), note: "Apartment rent", tags: ["essential"], createdAt: new Date().toISOString() },
  { id: "d3", userId: "demo-user", kind: "expense", category: "food", amountMinor: 165000, occurredOn: date(11), note: "Groceries", tags: ["essential"], createdAt: new Date().toISOString() },
  { id: "d4", userId: "demo-user", kind: "expense", category: "transport", amountMinor: 21000, occurredOn: date(11), note: "Pathao ride", tags: [], createdAt: new Date().toISOString() },
  { id: "d5", userId: "demo-user", kind: "expense", category: "utilities", amountMinor: 425000, occurredOn: date(8), note: "Electricity and internet", tags: ["essential"], createdAt: new Date().toISOString() },
  { id: "d6", userId: "demo-user", kind: "expense", category: "shopping", amountMinor: 112000, occurredOn: date(10), note: "Sastodeal", tags: [], createdAt: new Date().toISOString() },
  { id: "d7", userId: "demo-user", kind: "expense", category: "food", amountMinor: 28000, occurredOn: date(10), note: "Coffee", tags: [], createdAt: new Date().toISOString() },
  { id: "d8", userId: "demo-user", kind: "expense", category: "food", amountMinor: 840000, occurredOn: date(5), note: "Weekly groceries", tags: ["essential"], createdAt: new Date().toISOString() },
  { id: "d9", userId: "demo-user", kind: "expense", category: "transport", amountMinor: 510000, occurredOn: date(6), note: "Fuel and taxis", tags: [], createdAt: new Date().toISOString() },
  { id: "d10", userId: "demo-user", kind: "expense", category: "entertainment", amountMinor: 735000, occurredOn: date(7), note: "Weekend", tags: ["fun"], createdAt: new Date().toISOString() },
  { id: "d11", userId: "demo-user", kind: "expense", category: "health", amountMinor: 640000, occurredOn: date(9), note: "Pharmacy", tags: ["medical"], createdAt: new Date().toISOString() },
  { id: "d12", userId: "demo-user", kind: "expense", category: "other", amountMinor: 459000, occurredOn: date(4), note: "Household", tags: [], createdAt: new Date().toISOString() },
];

export const DEMO_BUDGETS: Budget[] = [
  { id: "b1", userId: "demo-user", monthKey: `${year}-${month}`, category: "food", amountMinor: 1500000 },
  { id: "b2", userId: "demo-user", monthKey: `${year}-${month}`, category: "transport", amountMinor: 800000 },
  { id: "b3", userId: "demo-user", monthKey: `${year}-${month}`, category: "shopping", amountMinor: 500000 },
];

export const DEMO_GOALS: SavingsGoal[] = [
  { id: "g1", userId: "demo-user", name: "Emergency fund", targetMinor: 30000000, savedMinor: 12800000, targetDate: `${year + 1}-01-31` },
];

export const DEMO_RECURRING: RecurringEntry[] = [
  { id: "r1", userId: "demo-user", kind: "income", category: "salary", amountMinor: 8540000, note: "Monthly salary", tags: ["work"], dayOfMonth: 10, nextDueOn: format(addMonths(now, 1), "yyyy-MM-10"), active: true },
  { id: "r2", userId: "demo-user", kind: "expense", category: "housing", amountMinor: 2000000, note: "Apartment rent", tags: ["essential"], dayOfMonth: 2, nextDueOn: format(addMonths(now, 1), "yyyy-MM-02"), active: true },
  { id: "r3", userId: "demo-user", kind: "expense", category: "entertainment", amountMinor: 39900, note: "Music subscription", tags: ["subscription"], dayOfMonth: now.getDate(), nextDueOn: format(now, "yyyy-MM-dd"), active: true },
];
