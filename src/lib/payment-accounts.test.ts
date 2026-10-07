import { describe, expect, it } from "vitest";
import { accountProviderName, accountTailsMatch, normalizeAccountTail, normalizeProviderName, onlinePaymentAccounts, paymentAccountLabel, paymentAccountProviderError, providerForAccountType, providersMatch, transferAccountDefaults } from "./payment-accounts";
import type { PaymentAccount } from "../types";

const account = (overrides: Partial<PaymentAccount>): PaymentAccount => ({
  id: "a", importId: "i", userId: "u", type: "mobile_banking", provider: "Nabil Bank Limited", label: "", balanceMinor: 0,
  balanceAsOf: "2026-08-01", balanceRecordedAt: "2026-08-01T00:00:00.000Z", currentBalanceMinor: 0, createdAt: "2026-08-01T00:00:00.000Z", ...overrides,
});

describe("provider names", () => {
  it("normalises stored bank names and SMS names to the same key", () => {
    expect(normalizeProviderName("Nabil Bank Limited")).toBe("nabil");
    expect(normalizeProviderName("Nabil Bank")).toBe("nabil");
    expect(normalizeProviderName("connect_ips")).toBe(normalizeProviderName("ConnectIPS"));
    expect(normalizeProviderName("Garima Bikas Bank Limited")).toBe("garima");
  });

  it("matches by prefix in either direction", () => {
    expect(providersMatch("NIC Asia Bank Limited", "NIC Asia")).toBe(true);
    expect(providersMatch("Standard Chartered Bank Nepal Limited", "Standard Chartered")).toBe(true);
    expect(providersMatch("Nepal Investment Mega Bank Limited", "Nepal Investment")).toBe(true);
    expect(providersMatch("Laxmi Sunrise Bank Limited", "Laxmi Sunrise")).toBe(true);
  });

  it("keeps similarly named banks apart", () => {
    expect(providersMatch("Nepal Bank Limited", "Nepal Investment")).toBe(false);
    expect(providersMatch("Nepal Bank Limited", "Nepal SBI")).toBe(false);
    expect(providersMatch("Global IME Bank Limited", "IME Pay")).toBe(false);
    expect(providersMatch("Mahalaxmi Bikas Bank Limited", "Laxmi Sunrise")).toBe(false);
  });

  it("names wallets the way an SMS does and gives cash no provider", () => {
    expect(accountProviderName(account({ type: "connect_ips", provider: "connect_ips" }))).toBe("connectIPS");
    expect(accountProviderName(account({ type: "ime_pay", provider: "ime_pay" }))).toBe("IME Pay");
    expect(accountProviderName(account({ type: "cash", provider: "Cash" }))).toBe("");
    expect(accountProviderName(account({ type: "other", provider: "Shree Saving Co-op" }))).toBe("Shree Saving Co-op");
  });
});

describe("account types", () => {
  it("validates providers per type", () => {
    expect(paymentAccountProviderError("mobile_banking", "Nabil Bank Limited")).toBeNull();
    expect(paymentAccountProviderError("mobile_banking", "Fake Bank")).not.toBeNull();
    expect(paymentAccountProviderError("ime_pay", "ime_pay")).toBeNull();
    expect(paymentAccountProviderError("cash", "Cash")).toBeNull();
    expect(paymentAccountProviderError("cash", "Nabil")).not.toBeNull();
    expect(paymentAccountProviderError("other", "Shree Saving Co-op")).toBeNull();
    expect(paymentAccountProviderError("other", " ")).not.toBeNull();
  });

  it("derives the stored provider", () => {
    expect(providerForAccountType("cash", "")).toBe("Cash");
    expect(providerForAccountType("esewa", "")).toBe("esewa");
    expect(providerForAccountType("other", "  Card  ")).toBe("Card");
  });

  it("labels free-text and cash accounts readably", () => {
    expect(paymentAccountLabel(account({ type: "other", provider: "Shree Saving Co-op", label: "Monthly" }))).toBe("Monthly · Shree Saving Co-op");
    expect(paymentAccountLabel(account({ type: "cash", provider: "Cash" }))).toBe("Cash in hand");
  });

  it("keeps Cash in hand out of online payment pickers", () => {
    expect(onlinePaymentAccounts([account({ id: "bank" }), account({ id: "cash", type: "cash" })]).map((item) => item.id)).toEqual(["bank"]);
  });
});

describe("account tails", () => {
  it("keeps 3-4 digits only", () => {
    expect(normalizeAccountTail(" 4821 ")).toBe("4821");
    expect(normalizeAccountTail("12")).toBeNull();
    expect(normalizeAccountTail("12345")).toBeNull();
    expect(normalizeAccountTail(null)).toBeNull();
  });

  it("matches when one tail ends with the other", () => {
    expect(accountTailsMatch("4821", "821")).toBe(true);
    expect(accountTailsMatch("4821", "4822")).toBe(false);
  });
});

describe("transfer defaults", () => {
  const three = [{ id: "nabil" }, { id: "esewa" }, { id: "cash" }];

  it("uses what the caller asked for, then the last route saved", () => {
    expect(transferAccountDefaults(three, {}, { fromAccountId: "nabil", toAccountId: "esewa" })).toEqual({ fromAccountId: "nabil", toAccountId: "esewa" });
    expect(transferAccountDefaults(three, { fromAccountId: "cash" }, { fromAccountId: "nabil", toAccountId: "esewa" })).toEqual({ fromAccountId: "cash", toAccountId: "esewa" });
    expect(transferAccountDefaults(three, { toAccountId: "cash" }, { fromAccountId: "nabil", toAccountId: "esewa" })).toEqual({ fromAccountId: "nabil", toAccountId: "cash" });
  });

  it("suggests the way back when opened from the account that last received money", () => {
    expect(transferAccountDefaults(three, { fromAccountId: "esewa" }, { fromAccountId: "nabil", toAccountId: "esewa" })).toEqual({ fromAccountId: "esewa", toAccountId: "nabil" });
  });

  it("ignores removed accounts and never names one account twice", () => {
    expect(transferAccountDefaults(three, { fromAccountId: "gone" }, { fromAccountId: "old", toAccountId: "older" })).toEqual({ fromAccountId: "", toAccountId: "" });
    expect(transferAccountDefaults(three, { fromAccountId: "nabil", toAccountId: "nabil" }, null)).toEqual({ fromAccountId: "nabil", toAccountId: "" });
    expect(transferAccountDefaults(three, { toAccountId: "nabil" }, { fromAccountId: "nabil", toAccountId: "esewa" })).toEqual({ fromAccountId: "", toAccountId: "nabil" });
  });

  it("fills the other side when there are only two accounts", () => {
    expect(transferAccountDefaults([{ id: "nabil" }, { id: "cash" }], { fromAccountId: "cash" })).toEqual({ fromAccountId: "cash", toAccountId: "nabil" });
    expect(transferAccountDefaults([{ id: "nabil" }, { id: "cash" }], { toAccountId: "cash" })).toEqual({ fromAccountId: "nabil", toAccountId: "cash" });
  });
});
