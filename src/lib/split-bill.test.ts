import { describe, expect, it } from "vitest";
import { applyBillCharges, buildSplitPlan, personSuggestions, splitDueDate, splitDueTitle, splitEvenly } from "./split-bill";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe("split bill", () => {
  it("adds the service charge before VAT, the way Nepali restaurant bills do", () => {
    expect(applyBillCharges(100_000, { serviceCharge: true, vat: true })).toEqual({ subtotalMinor: 100_000, serviceMinor: 10_000, vatMinor: 14_300, totalMinor: 124_300 });
    expect(applyBillCharges(100_000, { serviceCharge: false, vat: true }).totalMinor).toBe(113_000);
    expect(applyBillCharges(100_000, { serviceCharge: true, vat: false }).totalMinor).toBe(110_000);
    expect(applyBillCharges(-5, { serviceCharge: true, vat: true }).totalMinor).toBe(0);
  });

  it("keeps friends' shares in whole rupees and gives the odd amount to the first share", () => {
    expect(splitEvenly(100_000, 3)).toEqual([33_400, 33_300, 33_300]);
    expect(splitEvenly(100_050, 3)).toEqual([33_450, 33_300, 33_300]);
    expect(splitEvenly(240_000, 4)).toEqual([60_000, 60_000, 60_000, 60_000]);
  });

  it("always adds the shares back to the total", () => {
    for (const total of [1, 99, 100, 101, 12_345, 124_300, 999_999]) {
      for (const count of [1, 2, 3, 4, 7, 13, 20]) {
        const shares = splitEvenly(total, count);
        expect(shares).toHaveLength(count);
        expect(sum(shares)).toBe(total);
        expect(shares.every((share) => share >= 0)).toBe(true);
      }
    }
  });

  it("splits equally with me as the first share", () => {
    const plan = buildSplitPlan({ totalMinor: 100_000, includeMe: true, mode: "equal", people: [{ name: "Ram" }, { name: " Sita  Rai " }] });
    expect(plan.error).toBeNull();
    expect(plan.myShareMinor).toBe(33_400);
    expect(plan.shares).toEqual([{ person: "Ram", amountMinor: 33_300 }, { person: "Sita Rai", amountMinor: 33_300 }]);
    expect(plan.myShareMinor + plan.othersTotalMinor).toBe(100_000);
    expect(plan.unallocatedMinor).toBe(0);
  });

  it("puts the whole bill on friends when I am not part of it", () => {
    const plan = buildSplitPlan({ totalMinor: 50_000, includeMe: false, mode: "equal", people: [{ name: "Ram" }, { name: "Sita" }] });
    expect(plan.myShareMinor).toBe(0);
    expect(plan.othersTotalMinor).toBe(50_000);
    expect(plan.error).toBeNull();
  });

  it("checks that custom shares add up to the bill exactly", () => {
    const people = [{ name: "Ram", amountMinor: 40_000 }, { name: "Sita", amountMinor: 30_000 }];
    expect(buildSplitPlan({ totalMinor: 100_000, includeMe: true, mode: "custom", people, myAmountMinor: 30_000 })).toMatchObject({ myShareMinor: 30_000, othersTotalMinor: 70_000, unallocatedMinor: 0, error: null });
    expect(buildSplitPlan({ totalMinor: 100_000, includeMe: true, mode: "custom", people, myAmountMinor: 20_000 })).toMatchObject({ unallocatedMinor: 10_000, error: "Part of the bill is not assigned to anyone yet." });
    expect(buildSplitPlan({ totalMinor: 100_000, includeMe: true, mode: "custom", people, myAmountMinor: 40_000 })).toMatchObject({ unallocatedMinor: -10_000, error: "The shares add up to more than the bill." });
    expect(buildSplitPlan({ totalMinor: 100_000, includeMe: false, mode: "custom", people, myAmountMinor: 30_000 }).myShareMinor).toBe(0);
  });

  it("rejects splits that cannot become one due per person", () => {
    expect(buildSplitPlan({ totalMinor: 0, includeMe: true, mode: "equal", people: [{ name: "Ram" }] }).error).toBe("Enter what the bill came to.");
    expect(buildSplitPlan({ totalMinor: 1_000, includeMe: true, mode: "equal", people: [] }).error).toBe("Add at least one person to split with.");
    expect(buildSplitPlan({ totalMinor: 1_000, includeMe: true, mode: "equal", people: [{ name: "Ram" }, { name: "  " }] }).error).toBe("Give every person a name.");
    expect(buildSplitPlan({ totalMinor: 1_000, includeMe: true, mode: "equal", people: [{ name: "Ram" }, { name: "ram" }] }).error).toBe("Each person can appear only once.");
    expect(buildSplitPlan({ totalMinor: 1_000, includeMe: true, mode: "custom", myAmountMinor: 1_000, people: [{ name: "Ram", amountMinor: 0 }] }).error).toBe("Every person needs a share above zero.");
  });

  it("suggests past people once each, most recent first, ignoring case", () => {
    const due = (person: string, createdAt: string) => ({ person, createdAt });
    expect(personSuggestions([due("ram", "2026-01-01T00:00:00Z"), due("Sita", "2026-02-01T00:00:00Z"), due("Ram ", "2026-03-01T00:00:00Z"), due("", "2026-04-01T00:00:00Z")])).toEqual(["Ram", "Sita"]);
  });

  it("names and dates the dues it creates", () => {
    expect(splitDueTitle(" Momo night ", "Food & Dining")).toBe("Momo night split");
    expect(splitDueTitle("", "Food & Dining")).toBe("Food & Dining split");
    expect(splitDueTitle("x".repeat(120), "Food").length).toBeLessThanOrEqual(100);
    expect(splitDueDate("2026-10-07")).toBe("2026-11-06");
  });
});
