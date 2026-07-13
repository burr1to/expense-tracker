export type CurrencyCode = "NPR" | "USD" | "AUD";
export type TransactionKind = "income" | "expense";
export type AppView = "home" | "plan" | "reports" | "transactions" | "settings";
export type TransactionCategory = string;
export type ThemePreference = "light" | "dark" | "system";

export interface Profile {
  id: string;
  displayName: string;
  currency: CurrencyCode;
  theme: ThemePreference;
  hideAmounts: boolean;
  autoLockMinutes: number;
}

export interface LedgerTransaction {
  id: string;
  userId: string;
  kind: TransactionKind;
  category: TransactionCategory;
  amountMinor: number;
  occurredOn: string;
  note: string;
  tags: string[];
  createdAt: string;
}

export interface TransactionDraft {
  kind: TransactionKind;
  category: TransactionCategory;
  amount: string;
  occurredOn: string;
  note: string;
  tags: string;
}

export interface CategoryDefinition {
  id: TransactionCategory;
  label: string;
  kind: TransactionKind | "both";
  color: string;
  custom?: boolean;
}

export interface Budget {
  id: string;
  userId: string;
  monthKey: string;
  category: TransactionCategory;
  amountMinor: number;
}

export interface RecurringEntry {
  id: string;
  userId: string;
  kind: TransactionKind;
  category: TransactionCategory;
  amountMinor: number;
  note: string;
  tags: string[];
  dayOfMonth: number;
  nextDueOn: string;
  active: boolean;
}

export interface SavingsGoal {
  id: string;
  userId: string;
  name: string;
  targetMinor: number;
  savedMinor: number;
  targetDate: string | null;
}

export interface CustomCategory extends CategoryDefinition {
  userId: string;
  name: string;
  custom: true;
}

export interface Insight {
  id: string;
  tone: "positive" | "attention" | "neutral";
  title: string;
  detail: string;
}
