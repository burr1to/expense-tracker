import { describe, expect, it } from "vitest";
import { detectProvider, extractSmsDate, parseBankSms, SMS_REVIEW_THRESHOLD } from "./sms-templates";

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
