import { describe, expect, it } from "vitest";
import { buildDueReminderMessage, reminderAmountText, reminderDateText, reminderShareLinks } from "./due-reminder-message";
import { adToBs, formatBs } from "./nepali-date";
import type { DueItem } from "../types";

const due = (changes: Partial<DueItem> = {}): Pick<DueItem, "title" | "person" | "amountMinor" | "dueOn" | "payments"> => ({ title: "Bike repair", person: "Ram", amountMinor: 500_000, dueOn: "2026-10-20", payments: [], ...changes });
const payment = (amountMinor: number) => ({ id: "p1", userId: "u1", dueItemId: "d1", amountMinor, occurredOn: "2026-10-01", note: "", transactionId: null, createdAt: "2026-10-01T00:00:00.000Z" });

describe("due reminder message", () => {
  it("writes rupees the way people type them in chat", () => {
    expect(reminderAmountText(300_000, "NPR")).toBe("Rs 3,000");
    expect(reminderAmountText(300_050, "NPR")).toBe("Rs 3,000.5");
    expect(reminderAmountText(300_000, "USD")).toContain("3,000");
  });

  it("uses the user's calendar for the due date", () => {
    expect(reminderDateText("2026-10-20", "AD")).toBe("Oct 20, 2026");
    expect(reminderDateText("2026-10-20", "BS")).toBe(formatBs(adToBs("2026-10-20"), "long"));
    expect(reminderDateText("2026-10-20", "BS")).toMatch(/^[A-Z][a-z]+ \d{1,2}, 20\d\d$/);
  });

  it("builds an English reminder for an upcoming, due-today and overdue loan", () => {
    const input = { currency: "NPR" as const, calendarSystem: "AD" as const, language: "en" as const };
    expect(buildDueReminderMessage({ ...input, due: due(), today: "2026-10-07" })).toBe("Hi Ram, a friendly reminder that Rs 5,000 is still pending for \"Bike repair\". It is due on Oct 20, 2026. Thank you!");
    expect(buildDueReminderMessage({ ...input, due: due(), today: "2026-10-20" })).toContain("It is due today.");
    expect(buildDueReminderMessage({ ...input, due: due(), today: "2026-10-25" })).toContain("It was due on Oct 20, 2026.");
  });

  it("mentions what is left after a partial repayment", () => {
    const text = buildDueReminderMessage({ due: due({ payments: [payment(200_000)] }), currency: "NPR", calendarSystem: "AD", language: "en", today: "2026-10-07" });
    expect(text).toContain("Rs 3,000 of Rs 5,000 is still pending");
  });

  it("builds a romanized Nepali reminder with the Bikram Sambat date", () => {
    const text = buildDueReminderMessage({ due: due({ payments: [payment(200_000)] }), currency: "NPR", calendarSystem: "BS", language: "ne", today: "2026-10-07" });
    expect(text).toBe(`Namaste Ram ji, sano reminder: "Bike repair" ko Rs 5,000 madhye Rs 3,000 baki chha. ${formatBs(adToBs("2026-10-20"), "long")} samma milaidinu hola. Dhanyabad!`);
    expect(buildDueReminderMessage({ due: due(), currency: "NPR", calendarSystem: "AD", language: "ne", today: "2026-10-21" })).toContain("Oct 20, 2026 ma tirne kura thiyo.");
  });

  it("greets without a name when the due has no person", () => {
    expect(buildDueReminderMessage({ due: due({ person: " " }), currency: "NPR", calendarSystem: "AD", language: "en", today: "2026-10-07" })).toMatch(/^Hi, a friendly reminder/);
    expect(buildDueReminderMessage({ due: due({ person: "" }), currency: "NPR", calendarSystem: "AD", language: "ne", today: "2026-10-07" })).toMatch(/^Namaste, sano reminder/);
  });

  it("encodes the message into WhatsApp, Viber and SMS links", () => {
    const links = reminderShareLinks("Hi Ram & co, Rs 5,000?");
    expect(links.whatsapp).toBe("https://wa.me/?text=Hi%20Ram%20%26%20co%2C%20Rs%205%2C000%3F");
    expect(links.viber).toBe("viber://forward?text=Hi%20Ram%20%26%20co%2C%20Rs%205%2C000%3F");
    expect(links.sms).toBe("sms:?&body=Hi%20Ram%20%26%20co%2C%20Rs%205%2C000%3F");
  });
});
