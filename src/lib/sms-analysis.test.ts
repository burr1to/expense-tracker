import { describe, expect, it } from "vitest";
import { lastEntryForMerchant, matchSmsAccount, normalizeSmsAnalysis, personalizeSmsAnalysis, smsResultToDraft, withSmsAccountMatch, type SmsAnalysis } from "./sms-analysis";
import { parseBankSms } from "./sms-templates";
import type { LearningState, LedgerTransaction, PaymentAccount } from "../types";

// Synthetic messages in the shapes Nepali banks and wallets commonly use; not real samples.
const TODAY = "2026-08-12";

const account = (overrides: Partial<PaymentAccount>): PaymentAccount => ({
  id: "account",
  importId: "11111111-1111-4111-8111-111111111111",
  userId: "user",
  type: "mobile_banking",
  provider: "Nabil Bank Limited",
  label: "",
  accountTail: null,
  balanceMinor: 0,
  balanceAsOf: "2026-08-01",
  balanceRecordedAt: "2026-08-01T00:00:00.000Z",
  currentBalanceMinor: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const nabil = account({ id: "nabil", provider: "Nabil Bank Limited" });
const nicAsia = account({ id: "nic", provider: "NIC Asia Bank Limited" });
const himalayan = account({ id: "himalayan", provider: "Himalayan Bank Limited" });
const esewa = account({ id: "esewa", type: "esewa", provider: "esewa" });
const khalti = account({ id: "khalti", type: "khalti", provider: "khalti" });
const connectIps = account({ id: "connectips", type: "connect_ips", provider: "connect_ips" });
const cash = account({ id: "cash", type: "cash", provider: "Cash" });

const draftFor = (text: string, accounts: PaymentAccount[]) => {
  const parsed = parseBankSms(text, TODAY);
  if (!parsed) throw new Error(`Could not parse: ${text}`);
  return smsResultToDraft(parsed, TODAY, accounts);
};

describe("SMS to account matching", () => {
  it("books a Nabil alert to the Nabil account despite the stored full bank name", () => {
    const result = draftFor("Dear Customer, your Nabil A/C XXXXXX4821 is debited by NPR 1,250.00 on 12/08/2026 at BHATBHATENI SUPERMARKET.", [esewa, nabil]);
    expect(result.draft).toMatchObject({ paymentMode: "online", paymentAccountId: "nabil" });
  });

  it("books an NIC Asia alert to the NIC Asia account", () => {
    const result = draftFor("NIC ASIA BANK: A/C ###1234 debited NPR 800.00 on 12/08/2026 at KKFC DURBARMARG", [nabil, nicAsia]);
    expect(result.draft).toMatchObject({ paymentMode: "online", paymentAccountId: "nic" });
  });

  it("matches a connectIPS alert to the connect_ips wallet", () => {
    const result = draftFor("connectIPS: NPR 5,000.00 paid to NEA BILL on 12/08/2026", [nabil, connectIps]);
    expect(result.draft).toMatchObject({ paymentMode: "online", paymentAccountId: "connectips" });
  });

  it("never reads a café named like a bank as that bank", () => {
    const result = draftFor("Your A/C XXXX9999 is debited NPR 450.00 on 12/08/2026 at HIMALAYAN JAVA COFFEE THAMEL", [himalayan]);
    expect(result.draft).toMatchObject({ paymentMode: "cash", paymentAccountId: "", note: "HIMALAYAN JAVA COFFEE THAMEL", area: "HIMALAYAN JAVA COFFEE THAMEL" });
    expect(result.warnings.join(" ")).toContain("ending 9999");
  });

  it("does not book an eSewa load from a bank to the eSewa wallet", () => {
    const result = draftFor("Your A/C 0010XXXXXX1234 is debited by NPR 1,000.00 on 12/08/2026 for eSewa load.", [esewa, nabil]);
    expect(result.draft.paymentAccountId).not.toBe("esewa");
  });

  it("prefers a stored account tail, including masked numbers with leading digits", () => {
    const salary = account({ id: "nabil-salary", label: "Salary", accountTail: "1234" });
    const savings = account({ id: "nabil-savings", label: "Savings", accountTail: "5678" });
    const result = draftFor("Nabil Bank: A/C 0010XXXXXX5678 credited by NPR 2,000.00 on 12/08/2026", [salary, savings]);
    expect(result.draft.paymentAccountId).toBe("nabil-savings");
  });

  it("falls back to digits in the nickname", () => {
    const labelled = account({ id: "labelled", label: "Nabil 4821" });
    expect(draftFor("A/C 12XXXXXX4821 debited NPR 100.00 at SHOP ONE", [labelled, nicAsia]).draft.paymentAccountId).toBe("labelled");
  });

  it("leaves two accounts at one bank unselected with a warning instead of picking the first", () => {
    const first = account({ id: "nabil-1", label: "Salary" });
    const second = account({ id: "nabil-2", label: "Savings" });
    const result = draftFor("Nabil Bank: NPR 500.00 debited on 12/08/2026 at CAFE SOMA", [first, second]);
    expect(result.draft).toMatchObject({ paymentMode: "online", paymentAccountId: "" });
    expect(result.warnings.join(" ")).toMatch(/2 accounts at Nabil Bank/);
  });

  it("skips an account whose stored digits differ from the message", () => {
    const tracked = account({ id: "nabil", accountTail: "1111" });
    expect(matchSmsAccount({ provider: "Nabil Bank", accountTail: "2222" }, [tracked]).account).toBeNull();
    expect(matchSmsAccount({ provider: "Nabil Bank", accountTail: null }, [tracked]).account?.id).toBe("nabil");
  });

  it("does not book a message from one bank to another bank's account that shares its last digits", () => {
    const nabilTail = account({ id: "nabil", accountTail: "1234" });
    expect(draftFor("NIC ASIA: Your A/C ###1234 debited by NPR 900 on 05/10/2026 at BHATBHATENI", [nabilTail, nicAsia]).draft.paymentAccountId).toBe("nic");
    // An NIC Asia account with other digits is not it either, so nothing is picked and the user is told.
    const otherNic = draftFor("NIC ASIA: Your A/C ###1234 debited by NPR 900 on 05/10/2026 at BHATBHATENI", [nabilTail, account({ id: "nic", provider: "NIC Asia Bank Limited", accountTail: "9999" })]);
    expect(otherNic.draft.paymentAccountId).toBe("");
    expect(otherNic.warnings.join(" ")).toContain("ending 1234");
    // With no account at the named bank, the stored digits still decide.
    expect(draftFor("NIC ASIA: Your A/C ###1234 debited by NPR 900 on 05/10/2026 at BHATBHATENI", [nabilTail]).draft.paymentAccountId).toBe("nabil");
  });

  it("matches the bank named beside Fonepay", () => {
    const result = draftFor("Your A/C ###1234 is debited by NPR 500.00 for QR payment via Fonepay at Himalayan Java on 05/10/2026. -Nabil Bank", [nabil, esewa]);
    expect(result.draft).toMatchObject({ paymentMode: "online", paymentAccountId: "nabil", note: "Himalayan Java" });
  });

  it("finds a co-op or finance account by its own name, never by generic words alone", () => {
    const sahara = account({ id: "sahara", type: "other", provider: "Sahara Saving and Credit Co-op" });
    expect(draftFor("Sahara SACCOS: Rs 2,000 deposited to your saving A/C on 05/10/2026", [nabil, sahara]).draft).toMatchObject({ paymentMode: "online", paymentAccountId: "sahara" });
    expect(draftFor("Your saving and credit co-op A/C is credited by Rs 2,000 on 05/10/2026", [nabil, sahara]).draft.paymentAccountId).toBe("");
    expect(draftFor("Rs 450 paid at SAHARA CAFE on 05/10/2026", [sahara]).draft.paymentAccountId).toBe("");
  });

  it("never matches the Cash in hand account from a bank message", () => {
    expect(matchSmsAccount({ provider: "Cash", accountTail: null }, [cash]).account).toBeNull();
  });
});

describe("Gemini path", () => {
  const aiAnalysis = (overrides: Partial<SmsAnalysis["draft"]> = {}): SmsAnalysis => normalizeSmsAnalysis({
    currency: "NPR", readable: true, occurredOn: "2026-08-12", kind: "expense", amountMinor: 75_000,
    description: overrides.note ?? "Daraz", category: "shopping", subcategory: null, confidence: 0.8, warnings: [],
  }, "NPR", [{ id: "shopping", label: "Shopping", subcategories: [] }, { id: "other", label: "Other", subcategories: [] }], TODAY);

  it("runs the same account matcher after Gemini answers", () => {
    const result = withSmsAccountMatch(aiAnalysis(), "Thank you for using Khalti. Your order with Daraz of Rs 750 is complete.", [nabil, khalti]);
    expect(result.draft).toMatchObject({ paymentMode: "online", paymentAccountId: "khalti", category: "shopping" });
  });

  it("keeps cash when the message names no tracked account", () => {
    expect(withSmsAccountMatch(aiAnalysis(), "Order 1182 of Rs 750 is complete.", [nabil]).draft.paymentMode).toBe("cash");
  });

  it("resets an unknown AI category to Other, never Salary", () => {
    const result = normalizeSmsAnalysis({
      currency: "NPR", readable: true, occurredOn: null, kind: "income", amountMinor: 1_000,
      description: "Refund", category: "made-up", subcategory: null, confidence: 0.9, warnings: [],
    }, "NPR", [{ id: "salary", label: "Salary", subcategories: [] }, { id: "other", label: "Other", subcategories: [] }], TODAY);
    expect(result.draft.category).toBe("other");
  });
});

describe("SMS reading quality", () => {
  it("does not file every credit as Salary", () => {
    expect(draftFor("Your A/C XXXX4821 is credited by NPR 500.00 on 10/08/2026. Info: REFUND DARAZ", []).draft.category).toBe("other");
    expect(draftFor("Your A/C XXXX4821 is credited by NPR 85,000.00 on 01/08/2026. Info: SALARY AUGUST", []).draft.category).toBe("salary");
  });

  it("only fills the area when the text after 'at' reads like a place", () => {
    expect(draftFor("NPR 300.00 paid to Nepal Telecom via Khalti on 12/08/2026", [khalti]).draft).toMatchObject({ note: "Nepal Telecom", area: "", paymentAccountId: "khalti" });
    expect(draftFor("NPR 300.00 debited at CAFE SOMA JHAMSIKHEL on 12/08/2026", []).draft.area).toBe("CAFE SOMA JHAMSIKHEL");
  });
});

describe("self-transfer detection", () => {
  it("offers an ATM withdrawal as a transfer into Cash in hand", () => {
    const result = draftFor("NPR 2,000.00 withdrawn from your Nabil A/C XXXXXXX5678 at ATM KTM on 12/08/2026", [nabil, cash]);
    expect(result.transfer).toMatchObject({ reason: "atm", fromAccountId: "nabil", toAccountId: "cash", ready: true, startAsTransfer: true });
  });

  it("asks for a Cash in hand account when there is none, and still allows an expense", () => {
    const result = draftFor("NPR 2,000.00 withdrawn from your Nabil A/C XXXXXXX5678 at ATM KTM on 12/08/2026", [nabil]);
    expect(result.transfer).toMatchObject({ reason: "atm", toAccountId: "", startAsTransfer: false });
    expect(result.transfer?.message).toContain("Add a Cash in hand account");
    expect(result.draft.kind).toBe("expense");
  });

  it("reads a bank debit for an eSewa load as a transfer from the bank to eSewa", () => {
    const tail = account({ id: "nabil", accountTail: "1234" });
    const result = draftFor("Your A/C 0010XXXXXX1234 is debited by NPR 1,000.00 on 12/08/2026 for eSewa load.", [esewa, tail]);
    expect(result.transfer).toMatchObject({ reason: "wallet_load", fromAccountId: "nabil", toAccountId: "esewa", startAsTransfer: true });
  });

  it("reads 'added to your Khalti wallet' from a bank as a transfer, not Salary", () => {
    const result = draftFor("Rs 1,000 added to your Khalti wallet from NIC Asia on 12/08/2026", [khalti, nicAsia]);
    expect(result.draft).toMatchObject({ kind: "income", category: "other", paymentAccountId: "khalti" });
    expect(result.transfer).toMatchObject({ reason: "wallet_load", fromAccountId: "nic", toAccountId: "khalti", startAsTransfer: true });
  });

  it("offers, but does not assume, a transfer when a message names two tracked accounts", () => {
    const result = draftFor("Nabil Bank: NPR 700.00 debited on 12/08/2026 to Khalti merchant BIG MART", [nabil, khalti]);
    expect(result.transfer).toMatchObject({ reason: "two_accounts", fromAccountId: "nabil", toAccountId: "khalti", ready: true, startAsTransfer: false });
  });

  it("does not suggest a transfer for an ordinary purchase", () => {
    expect(draftFor("Nabil Bank: NPR 700.00 debited on 12/08/2026 at BIG MART", [nabil, khalti]).transfer).toBeNull();
  });
});

describe("lastEntryForMerchant", () => {
  const entry = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
    id: "t", userId: "user", kind: "expense", category: "food", amountMinor: 100, occurredOn: "2026-08-01", note: "", subcategory: null, area: null,
    paymentMode: "cash", paymentAccountId: null, locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null,
    locationAccuracy: null, locationSource: null, savedPlaceId: null, createdAt: "2026-08-01T10:00:00.000Z", ...overrides,
  });

  it("finds the latest entry whose note, area or place names the merchant", () => {
    const older = entry({ id: "older", note: "Bhatbhateni", category: "food", occurredOn: "2026-07-01" });
    const newer = entry({ id: "newer", area: "Bhatbhateni Supermarket, Maharajgunj", category: "shopping", subcategory: "Groceries", occurredOn: "2026-08-01" });
    expect(lastEntryForMerchant([older, newer], "BHATBHATENI SUPERMARKET", "expense")?.id).toBe("newer");
  });

  it("matches whole words only and respects the kind", () => {
    expect(lastEntryForMerchant([entry({ note: "Food" })], "FOODMANDU", "expense")).toBeNull();
    expect(lastEntryForMerchant([entry({ note: "Bhatbhateni", kind: "income" })], "Bhatbhateni", "expense")).toBeNull();
  });
});

describe("personalizeSmsAnalysis", () => {
  const categoryIds = ["food", "shopping", "other", "salary"];
  const learning = (paymentMode: "cash" | "online"): LearningState => ({
    enabled: true, summary: [], lastTransactionId: null, lastRunAt: null,
    suggestions: [{ place: "CAFE SOMA JHAMSIKHEL", kind: "expense", category: "food", subcategory: "Cafe", paymentMode, confidence: 0.9, evidenceCount: 6 }],
  });
  const off: LearningState = { enabled: false, suggestions: [], summary: [], lastTransactionId: null, lastRunAt: null };
  const past = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
    id: "past", userId: "user", kind: "expense", category: "shopping", amountMinor: 100, occurredOn: "2026-08-01", note: "Bhatbhateni", subcategory: "Groceries", area: null,
    paymentMode: "cash", paymentAccountId: null, locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null,
    locationAccuracy: null, locationSource: null, savedPlaceId: null, createdAt: "2026-08-01T10:00:00.000Z", ...overrides,
  });

  it("never lets a habit replace the account the message named", () => {
    const matched = draftFor("Nabil Bank: NPR 300.00 debited at CAFE SOMA JHAMSIKHEL on 12/08/2026", [nabil]);
    const result = personalizeSmsAnalysis(matched, learning("cash"), [], categoryIds);
    expect(result.analysis.draft).toMatchObject({ category: "food", subcategory: "Cafe", paymentMode: "online", paymentAccountId: "nabil" });
    expect(result.note).toBe("Category filled from what you usually record at CAFE SOMA JHAMSIKHEL.");
  });

  it("applies the learned payment method when the message named no account", () => {
    const unmatched = draftFor("NPR 300.00 debited at CAFE SOMA JHAMSIKHEL on 12/08/2026", []);
    const result = personalizeSmsAnalysis(unmatched, learning("online"), [], categoryIds);
    expect(result.analysis.draft).toMatchObject({ category: "food", paymentMode: "online", paymentAccountId: "" });
    expect(result.note).toMatch(/^Category and payment method/);
  });

  it("falls back to the latest entry at the merchant and says so", () => {
    const parsed = draftFor("Nabil Bank: NPR 2,450.00 debited at BHATBHATENI on 12/08/2026", [nabil]);
    const result = personalizeSmsAnalysis(parsed, off, [past({})], categoryIds);
    expect(result.analysis.draft).toMatchObject({ category: "shopping", subcategory: "Groceries", paymentMode: "online", paymentAccountId: "nabil" });
    expect(result.note).toBe("Filled from your last BHATBHATENI entry.");
  });

  it("skips a past entry whose category no longer exists", () => {
    const parsed = draftFor("NPR 2,450.00 debited at BHATBHATENI on 12/08/2026", []);
    const result = personalizeSmsAnalysis(parsed, off, [past({ category: "deleted-custom" })], categoryIds);
    expect(result.analysis.draft.category).toBe("other");
    expect(result.note).toBeNull();
  });
});
