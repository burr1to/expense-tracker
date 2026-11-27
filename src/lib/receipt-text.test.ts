import { describe, expect, it } from "vitest";
import { chooseReceiptRoute, cleanReceiptText, localReceiptAnalysis, parseReceiptText } from "./receipt-text";

const categories = [
  { id: "food", label: "Food & Dining", subcategories: ["Groceries", "Cafe", "Restaurant"] },
  { id: "transport", label: "Transport", subcategories: ["Fuel"] },
  { id: "health", label: "Health", subcategories: ["Medicine"] },
  { id: "other", label: "Other", subcategories: [] },
];
const input = { today: "2026-11-12", categories };

const supermarket = `BHAT-BHATENI SUPER MARKET
Maharajgunj, Kathmandu
PAN No: 300123456
Tax Invoice
Bill No: 45122   Date: 2026/11/10
Rice 5kg          1,050.00
Soap bar             95.00
Sub Total         1,145.00
VAT 13%             148.85
Grand Total       1,293.85
Cash              1,300.00
Change                6.15`;

describe("parseReceiptText", () => {
  it("reads a supermarket receipt whose own arithmetic agrees with the total", () => {
    const parsed = parseReceiptText(supermarket, input);
    expect(parsed).toMatchObject({ merchant: "Bhat-Bhateni Super Market", occurredOn: "2026-11-10", totalMinor: 129385, category: "food", subcategory: "Groceries" });
    expect(parsed.confidence).toBeGreaterThanOrEqual(0.9);
    expect(chooseReceiptRoute(parsed, { text: supermarket, ocrConfidence: 82 })).toBe("device");
  });

  it("never takes the sub total, item count or change as the paid total", () => {
    const parsed = parseReceiptText("Corner Cafe\nTotal Qty: 3\nSub Total 400\nTotal 452.00\nChange 48", input);
    expect(parsed.totalMinor).toBe(45200);
    expect(parsed.subcategory).toBe("Cafe");
  });

  it("keeps a rounded grand total and reads an amount OCR split onto the next line", () => {
    expect(parseReceiptText("Shop\nGrand Total (Rounded)\n2,300/-", input).totalMinor).toBe(230000);
  });

  it("fixes O read for 0 only inside numbers", () => {
    expect(parseReceiptText("Momo King\nNet Amount Rs. 1,2O0.00", input)).toMatchObject({ totalMinor: 120000, currency: "NPR", category: "food", subcategory: "Restaurant" });
  });

  it("converts a Bikram Sambat date and rejects implausible ones", () => {
    expect(parseReceiptText("Pharmacy Plus\nMiti: 2083/07/26\nTotal 300", input)).toMatchObject({ occurredOn: "2026-11-12", category: "health" });
    expect(parseReceiptText("Shop\nDate: 01/01/2019\nTotal 300", input).occurredOn).toBeNull();
    expect(parseReceiptText("Shop\nDate: 13/12/2026\nTotal 300", input).occurredOn).toBeNull();
  });

  it("reads day-first and month-name dates", () => {
    expect(parseReceiptText("Shop\nDate 05/11/2026\nTotal 10", input).occurredOn).toBe("2026-11-05");
    expect(parseReceiptText("Shop\n7 Nov 2026\nTotal 10", input).occurredOn).toBe("2026-11-07");
  });

  it("does not use a VAT registration number in the arithmetic", () => {
    const parsed = parseReceiptText("Fuel Point Filling Station\nVAT No. 600123456\nPetrol 10 L 1,700.00\nSub Total 1,700.00\nTotal 1,700.00", input);
    expect(parsed).toMatchObject({ totalMinor: 170000, category: "transport", subcategory: "Fuel" });
    // Bare "Total" 0.55 + agreeing sub total 0.2 + merchant 0.05; no date printed.
    expect(parsed.confidence).toBe(0.8);
  });

  it("is unsure when only a bare total appears", () => {
    const parsed = parseReceiptText("x7 ;; ##\nTotal 500", input);
    expect(parsed.merchant).toBeNull();
    expect(parsed.confidence).toBe(0.55);
  });
});

describe("total cross-checks", () => {
  it("trusts a plain total when the item prices add up to it", () => {
    const parsed = parseReceiptText("Himalayan Java Coffee\nMiti: 2083-07-24\nAmericano 220\nMuffin 110\nTotal 330", input);
    expect(parsed).toMatchObject({ totalMinor: 33000, occurredOn: "2026-11-10" });
    expect(parsed.confidence).toBe(0.85);
  });

  it("trusts a plain total when paid minus change equals it", () => {
    const parsed = parseReceiptText("New Life Pharmacy\nVitamin C x30 250.00\nCetirizine x10 40.00\nTotal: 435.00\nPaid 500.00\nReturn 65.00", input);
    expect(parsed.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("does not trust items that don't add up", () => {
    expect(parseReceiptText("Shop Name\nTea 50\nBun 30\nTotal 95", input).confidence).toBe(0.6);
  });
});

describe("merchant names", () => {
  it("keeps a hotel name and joins OCR-spaced hyphens", () => {
    expect(parseReceiptText("HOTEL ANNAPURNA VIEW\nLakeside, Pokhara\nBill Amount 14,760.00", input).merchant).toBe("Hotel Annapurna View");
    expect(parseReceiptText("BHAT -BHATENI SUPER MARKET\nTotal 10", input).merchant).toBe("Bhat-Bhateni Super Market");
  });
});

describe("chooseReceiptRoute", () => {
  it("asks before sending text that has no money in it, such as a note", () => {
    const text = "Remember to bring warm clothes\nUno cards and thick socks\nMeet at Basantapur after lunch";
    expect(chooseReceiptRoute(parseReceiptText(text, input), { text, ocrConfidence: 95 })).toBe("photo");
  });

  it("sends unsure but readable text to Gemini as text", () => {
    // The items don't add up to the total, so the rules can't confirm it.
    const text = "Some Shop Kathmandu\nItem one 200\nItem two 250\nTotal 500";
    expect(chooseReceiptRoute(parseReceiptText(text, input), { text, ocrConfidence: 70 })).toBe("text");
  });

  it("does not trust a clear total from a blurry read", () => {
    expect(chooseReceiptRoute(parseReceiptText(supermarket, input), { text: supermarket, ocrConfidence: 50 })).toBe("text");
  });

  it("asks about the photo when there is too little text", () => {
    expect(chooseReceiptRoute(parseReceiptText("~~ ., 4", input), { text: "~~ ., 4", ocrConfidence: 20 })).toBe("photo");
  });
});

describe("localReceiptAnalysis", () => {
  it("builds one reviewable split that matches the total", () => {
    const analysis = localReceiptAnalysis(parseReceiptText(supermarket, input), { fallbackOccurredOn: "2026-11-12", categories });
    expect(analysis.splits).toEqual([expect.objectContaining({ amountMinor: 129385, category: "food", subcategory: "Groceries", label: "Groceries" })]);
    expect(analysis.warnings[0]).toContain("without AI");
  });

  it("falls back to Other and today, and says so", () => {
    const analysis = localReceiptAnalysis(parseReceiptText("Unknown Traders\nGrand Total 900", input), { fallbackOccurredOn: "2026-11-12", categories });
    expect(analysis).toMatchObject({ occurredOn: "2026-11-12", splits: [expect.objectContaining({ category: "other", confidence: 0 })] });
    expect(analysis.warnings).toEqual(expect.arrayContaining(["Choose a category for this receipt.", expect.stringContaining("No date")]));
  });
});

describe("cleanReceiptText", () => {
  it("strips control characters and caps the length", () => {
    expect(cleanReceiptText("a\u0000b\t\tc\n\n\n\nd")).toBe("ab c\n\nd");
    expect(cleanReceiptText("x".repeat(7000))).toHaveLength(6000);
  });
});
