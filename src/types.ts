export type CurrencyCode = "NPR" | "USD" | "AUD";
export type TransactionKind = "income" | "expense";
export type AppView = "home" | "plan" | "dues" | "reports" | "transactions" | "settings";
export type TransactionCategory = string;
export type ThemePreference = "light" | "dark" | "system";
export type PaymentMode = "cash" | "cheque" | "online";
export type PaymentAccountType = "mobile_banking" | "esewa" | "khalti" | "connect_ips";

export interface Profile {
  id: string;
  displayName: string;
  currency: CurrencyCode;
  theme: ThemePreference;
  hideAmounts: boolean;
  autoLockMinutes: number;
  hasPin: boolean;
}

export interface LedgerTransaction {
  id: string;
  userId: string;
  kind: TransactionKind;
  category: TransactionCategory;
  amountMinor: number;
  occurredOn: string;
  note: string;
  subcategory: string | null;
  area: string | null;
  paymentMode: PaymentMode;
  paymentAccountId: string | null;
  paymentAccount?: PaymentAccount | null;
  createdAt: string;
  receipt?: ReceiptMeta | null;
}

export interface TransactionDraft {
  kind: TransactionKind;
  category: TransactionCategory;
  amount: string;
  occurredOn: string;
  note: string;
  subcategory: string;
  area: string;
  paymentMode: PaymentMode;
  paymentAccountId: string;
  receipt?: ReceiptUpload;
  removeReceipt?: boolean;
}

export interface CategoryDefinition {
  id: TransactionCategory;
  label: string;
  kind: TransactionKind | "both";
  color: string;
  custom?: boolean;
}

export interface PaymentAccount {
  id: string;
  userId: string;
  type: PaymentAccountType;
  provider: string;
  label: string;
  createdAt: string;
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
  contributions: SavingsGoalContribution[];
}

export interface SavingsGoalContribution {
  id: string;
  userId: string;
  goalId: string;
  amountMinor: number;
  isOpeningBalance: boolean;
  createdAt: string;
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

export type DueKind = "payment" | "receivable" | "lent" | "borrowed";
export type DueStatus = "open" | "completed";

export interface DuePayment {
  id: string;
  userId: string;
  dueItemId: string;
  amountMinor: number;
  occurredOn: string;
  note: string;
  transactionId: string | null;
  createdAt: string;
}

export interface DueItem {
  id: string;
  userId: string;
  kind: DueKind;
  title: string;
  person: string;
  amountMinor: number;
  category: string;
  occurredOn: string | null;
  dueOn: string;
  remindOn: string | null;
  note: string;
  status: DueStatus;
  completedOn: string | null;
  createdAt: string;
  payments: DuePayment[];
  receipt?: ReceiptMeta | null;
}

export interface DueDraft {
  kind: DueKind;
  title: string;
  person: string;
  amount: string;
  category: string;
  occurredOn: string;
  dueOn: string;
  remindOn: string;
  note: string;
  receipt?: ReceiptUpload;
}

export interface ReceiptMeta {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface ReceiptUpload {
  name: string;
  mimeType: string;
  size: number;
  storagePath: string;
}
