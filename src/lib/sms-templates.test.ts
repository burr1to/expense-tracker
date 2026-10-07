import { describe, expect, it } from "vitest";
import { detectProvider, detectProviders, extractSmsDate, mentionsCurrencyAmount, parseBankSms, SMS_REVIEW_THRESHOLD } from "./sms-templates";

// These fixtures are synthetic messages written in the shapes providers
// commonly use. They are not captured from any real sender — replace them with
// redacted real samples as you collect them.
const TODAY = "2026-08-12";

describe("parseBankSms direction", () => {
  it("reads a debit alert as an expense", () => {
    const result = parseBankSms("Your A/C XXXXXX4821 is debited by NPR 1,250.00 on 12/08/2026 at BHATBHATENI SUPERMARKET. Avl Bal: NPR 43,910.25", TODAY);
    expect(result).toMatchObject({
      kind: "expense",
      amountMinor: 125_000,
      occurredOn: "2026-08-12",
      merchant: "BHATBHATENI SUPERMARKET",
      accountTail: "4821",
      balanceMinor: 4_391_025,
    });
  });

  it("reads a credit alert as income", () => {
    const result = parseBankSms("Your A/C XXXXXX4821 is credited by NPR 85,000.00 on 01/08/2026. Info: SALARY AUGUST. Balance: NPR 128,910.25", TODAY);
    expect(result).toMatchObject({ kind: "income", amountMinor: 8_500_000, occurredOn: "2026-08-01", merchant: "SALARY AUGUST" });
  });

  it("resolves a message containing both words using the earlier verb", () => {
    expect(parseBankSms("NPR 500 debited from your wallet and credited to merchant ABC", TODAY)?.kind).toBe("expense");
    expect(parseBankSms("NPR 500 credited to your wallet from merchant ABC refund debit ref", TODAY)?.kind).toBe("income");
  });

  it("returns null when no direction can be read", () => {
    expect(parseBankSms("Your statement for NPR 1,200.00 is ready to view", TODAY)).toBeNull();
  });

  it("returns null when there is no currency-tagged amount", () => {
    expect(parseBankSms("Your account was debited today. Ref 889231", TODAY)).toBeNull();
  });

  it("ignores a bare reference number as an amount", () => {
    // 889231 has no currency tag; only the tagged 240.00 should be taken.
    expect(parseBankSms("Txn ref 889231 debited NPR 240.00 at CAFE SOMA", TODAY)?.amountMinor).toBe(24_000);
  });

  it("handles Rs. and rupee-symbol prefixes", () => {
    expect(parseBankSms("Rs. 350 debited at PATAN CAFE", TODAY)?.amountMinor).toBe(35_000);
    expect(parseBankSms("रू 1,000 credited to your account", TODAY)?.amountMinor).toBe(100_000);
  });
});

describe("extractSmsDate", () => {
  it("reads ISO dates", () => {
    expect(extractSmsDate("posted on 2026-08-12 ref 1")).toBe("2026-08-12");
  });

  it("reads day-first numeric dates", () => {
    expect(extractSmsDate("on 12/08/2026")).toBe("2026-08-12");
    expect(extractSmsDate("on 05-06-2026")).toBe("2026-06-05");
  });

  it("falls back to month-first when day-first is impossible", () => {
    expect(extractSmsDate("on 08/25/2026")).toBe("2026-08-25");
  });

  it("reads named-month dates and two-digit years", () => {
    expect(extractSmsDate("on 12-Aug-2026")).toBe("2026-08-12");
    expect(extractSmsDate("on 3 Sep 26")).toBe("2026-09-03");
  });

  it("rejects impossible dates", () => {
    expect(extractSmsDate("on 32/13/2026")).toBeNull();
    expect(extractSmsDate("on 31/02/2026")).toBeNull();
  });

  it("returns null when no date is present", () => {
    expect(extractSmsDate("debited NPR 100 at SHOP")).toBeNull();
  });
});

describe("provider detection", () => {
  it("names known wallets and banks", () => {
    expect(detectProvider("eSewa payment of NPR 100")).toBe("eSewa");
    expect(detectProvider("Khalti load successful")).toBe("Khalti");
    expect(detectProvider("NIC ASIA BANK alert")).toBe("NIC Asia");
  });

  it("returns null for an unknown sender", () => {
    expect(detectProvider("Some other bank alert")).toBeNull();
  });
});

describe("confidence", () => {
  it("scores a complete message above the review threshold", () => {
    const result = parseBankSms("eSewa: NPR 1,250.00 debited on 12/08/2026 to DARAZ NEPAL. A/C XXXX4821. Bal NPR 4,000.00", TODAY);
    expect(result!.confidence).toBeGreaterThan(SMS_REVIEW_THRESHOLD);
  });

  it("scores a sparse message at or below the review threshold", () => {
    const result = parseBankSms("NPR 400 debited", TODAY);
    expect(result!.confidence).toBeLessThanOrEqual(SMS_REVIEW_THRESHOLD);
    expect(result!.occurredOn).toBeNull();
    expect(result!.merchant).toBeNull();
  });

  it("never reports a merchant that is only digits", () => {
    expect(parseBankSms("NPR 400 debited at 889231", TODAY)?.merchant).toBeNull();
  });
});

describe("account tails", () => {
  it("reads masked numbers with visible leading digits", () => {
    expect(parseBankSms("Your A/C 0010XXXXXX1234 is debited by NPR 100.00", TODAY)?.accountTail).toBe("1234");
    expect(parseBankSms("A/C 12XXXXXX4821 debited NPR 100.00", TODAY)?.accountTail).toBe("4821");
    expect(parseBankSms("NPR 100.00 debited from 12XXXXXX4821 at SHOP", TODAY)?.accountTail).toBe("4821");
  });

  it("still reads hash and X masks", () => {
    expect(parseBankSms("A/C ###1234 debited NPR 100.00", TODAY)?.accountTail).toBe("1234");
    expect(parseBankSms("Your A/C XXXXXX4821 is debited by NPR 100.00", TODAY)?.accountTail).toBe("4821");
  });

  it("does not read a masked phone number as an account", () => {
    expect(parseBankSms("NPR 1,000.00 has been sent to 98XXXXXX12 from your eSewa wallet", TODAY)?.accountTail).toBeNull();
  });
});

describe("merchant reading", () => {
  it("skips 'your A/C' and keeps reading to the place", () => {
    expect(parseBankSms("NPR 2,000.00 withdrawn from your A/C XXXXXXX5678 at ATM KTM", TODAY)).toMatchObject({ merchant: "ATM KTM", merchantIsPlace: false, transferHint: "atm" });
  });

  it("rejects masked numbers and wallet phrases as merchants", () => {
    expect(parseBankSms("NPR 1,000.00 has been sent to 98XXXXXX12 from your eSewa wallet", TODAY)).toMatchObject({ merchant: null, provider: "eSewa" });
  });

  it("strips a trailing 'via <provider>' and a leading 'QR PAYMENT TO'", () => {
    expect(parseBankSms("paid Rs. 200 to Nepal Telecom via Khalti", TODAY)).toMatchObject({ merchant: "Nepal Telecom", provider: "Khalti" });
    expect(parseBankSms("NPR 350.00 debited. Info: QR PAYMENT TO CAFE SOMA", TODAY)?.merchant).toBe("CAFE SOMA");
  });

  it("marks only an 'at' merchant that reads like a place", () => {
    expect(parseBankSms("NPR 450.00 debited at HIMALAYAN JAVA COFFEE", TODAY)?.merchantIsPlace).toBe(true);
    expect(parseBankSms("NPR 450.00 paid to DARAZ NEPAL", TODAY)?.merchantIsPlace).toBe(false);
  });
});

describe("provider outside the merchant", () => {
  it("never takes the bank from a café's name", () => {
    expect(parseBankSms("debited NPR 450 at HIMALAYAN JAVA COFFEE", TODAY)?.provider).toBeNull();
  });

  it("never takes the account from what the money was for", () => {
    expect(parseBankSms("Your A/C XXXX1234 debited by NPR 1,000.00 for eSewa load", TODAY)).toMatchObject({ provider: null, otherProvider: "eSewa", transferHint: "wallet_load" });
  });

  it("lists every named provider in order", () => {
    expect(detectProviders("Rs 1,000 added to your Khalti wallet from NIC Asia")).toEqual(["Khalti", "NIC Asia"]);
    expect(detectProviders("Himalayan Java")).toEqual([]);
  });

  it("flags salary words, and own-account transfers", () => {
    expect(parseBankSms("A/C XXXX1234 credited NPR 5,000.00. Info: SALARY SEPT", TODAY)?.mentionsSalary).toBe(true);
    expect(parseBankSms("NPR 5,000.00 transferred to your own account on 12/08/2026", TODAY)?.transferHint).toBe("own_account");
  });

  it("does not read a mobile top-up paid by wallet as a wallet load", () => {
    expect(parseBankSms("Topup of NTC Rs 100 paid via eSewa", TODAY)?.transferHint).toBeNull();
  });

  it("does not treat an ATM in another bank's name as the account's bank", () => {
    const parsed = parseBankSms("Rs 5,000.00 withdrawn from A/C XXXX1234 at NABIL ATM NEWROAD on 05/10/2026", TODAY);
    expect(parsed).toMatchObject({ transferHint: "atm", provider: null, otherProvider: "Nabil Bank", accountTail: "1234" });
  });
});

describe("mentionsCurrencyAmount", () => {
  it("passes alerts and holds back clipboard text that is not one", () => {
    expect(mentionsCurrencyAmount("Your A/C XXXX4821 is debited by NPR 1,250.00")).toBe(true);
    expect(mentionsCurrencyAmount("रू 500 received")).toBe(true);
    expect(mentionsCurrencyAmount("Your OTP is 482193. Do not share it.")).toBe(false);
    expect(mentionsCurrencyAmount("hunter2")).toBe(false);
  });
});
