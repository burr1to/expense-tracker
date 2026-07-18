import type { PaymentAccount, PaymentAccountType } from "../types";

export const PAYMENT_ACCOUNT_TYPES: readonly { value: PaymentAccountType; label: string }[] = [
  { value: "mobile_banking", label: "Mobile banking" },
  { value: "esewa", label: "eSewa" },
  { value: "khalti", label: "Khalti" },
  { value: "connect_ips", label: "connectIPS" },
];

// NRB-licensed commercial and development banks, verified against the June 2026 BFI list.
export const NEPAL_MOBILE_BANKS = [
  "Agriculture Development Bank Limited", "Citizens Bank International Limited", "Everest Bank Limited", "Global IME Bank Limited",
  "Himalayan Bank Limited", "Kumari Bank Limited", "Laxmi Sunrise Bank Limited", "Machhapuchchhre Bank Limited",
  "Nabil Bank Limited", "Nepal Bank Limited", "Nepal Investment Mega Bank Limited", "Nepal SBI Bank Limited",
  "NIC Asia Bank Limited", "NMB Bank Limited", "Prabhu Bank Limited", "Prime Commercial Bank Limited",
  "Rastriya Banijya Bank Limited", "Sanima Bank Limited", "Siddhartha Bank Limited", "Standard Chartered Bank Nepal Limited",
  "Corporate Development Bank Limited", "Excel Development Bank Limited", "Garima Bikas Bank Limited", "Green Development Bank Limited",
  "Jyoti Bikas Bank Limited", "Kamana Sewa Bikas Bank Limited", "Karnali Development Bank Limited", "Lumbini Bikas Bank Limited",
  "Mahalaxmi Bikas Bank Limited", "Miteri Development Bank Limited", "Muktinath Bikas Bank Limited", "Narayani Development Bank Limited",
  "Salapa Bikas Bank Limited", "Saptakoshi Development Bank Limited", "Shangrila Development Bank Limited",
  "Shine Resunga Development Bank Limited", "Sindhu Bikas Bank Limited",
] as const;

export function paymentAccountTypeLabel(type: PaymentAccountType) {
  return PAYMENT_ACCOUNT_TYPES.find((item) => item.value === type)?.label ?? type;
}

export function paymentAccountLabel(account: PaymentAccount) {
  const provider = account.type === "mobile_banking" ? account.provider : paymentAccountTypeLabel(account.type);
  return account.label ? `${account.label} · ${provider}` : provider;
}
