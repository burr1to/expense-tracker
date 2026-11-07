import { describe, expect, it } from "vitest";
import { groupDatesText, groupDraftError, groupEntries, groupsCovering, groupSpan, sortGroups, summarizeGroup, withinGroupDates } from "./transaction-groups";
import type { LedgerTransaction, TransactionGroup } from "../types";

const entry = (over: Partial<LedgerTransaction>): LedgerTransaction => ({
  id: "tx", userId: "user-1", kind: "expense", category: "food", amountMinor: 1000, occurredOn: "2026-10-12", note: "", subcategory: null, area: null,
  paymentMode: "cash", paymentAccountId: null, locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null,
  locationAccuracy: null, locationSource: null, savedPlaceId: null, groupId: null, createdAt: "2026-10-12T08:00:00.000Z", ...over,
});
const group = (over: Partial<TransactionGroup>): TransactionGroup => ({ id: "g1", userId: "user-1", name: "Pokhara trip", icon: "trip", startOn: null, endOn: null, note: "", createdAt: "2026-10-01T08:00:00.000Z", ...over });

describe("summarizing a group", () => {
  it("totals spending and income separately and ranks expense categories", () => {
    const entries = [
      entry({ id: "a", category: "food", amountMinor: 1500, occurredOn: "2026-10-13" }),
      entry({ id: "b", category: "transport", amountMinor: 4000, occurredOn: "2026-10-12" }),
      entry({ id: "c", category: "food", amountMinor: 2000, occurredOn: "2026-10-15" }),
      entry({ id: "d", kind: "income", category: "gift", amountMinor: 1000, occurredOn: "2026-10-14" }),
    ];
    const summary = summarizeGroup(entries);
    expect(summary).toMatchObject({ count: 4, spentMinor: 7500, receivedMinor: 1000, netMinor: -6500, firstOn: "2026-10-12", lastOn: "2026-10-15" });
    expect(summary.categories).toEqual([{ category: "transport", amountMinor: 4000, count: 1 }, { category: "food", amountMinor: 3500, count: 2 }]);
  });

  it("is empty for a group with no entries", () => {
    expect(summarizeGroup([])).toEqual({ count: 0, spentMinor: 0, receivedMinor: 0, netMinor: 0, firstOn: null, lastOn: null, categories: [] });
  });

  it("only counts entries in that group", () => {
    expect(groupEntries("g1", [entry({ id: "a", groupId: "g1" }), entry({ id: "b", groupId: "g2" }), entry({ id: "c" })]).map((item) => item.id)).toEqual(["a"]);
  });
});

describe("group dates", () => {
  it("prefers the group's own dates over the span of its entries", () => {
    expect(groupSpan(group({ startOn: "2026-10-10", endOn: "2026-10-16" }), { firstOn: "2026-10-12", lastOn: "2026-10-13" })).toEqual({ from: "2026-10-10", to: "2026-10-16" });
    expect(groupSpan(group({}), { firstOn: "2026-10-12", lastOn: "2026-10-13" })).toEqual({ from: "2026-10-12", to: "2026-10-13" });
  });

  it("reads a range, a single day, an open end, or nothing", () => {
    expect(groupDatesText({ from: "2026-10-12", to: "2026-10-16" })).toBe("Oct 12, 2026 – Oct 16, 2026");
    expect(groupDatesText({ from: "2026-10-12", to: "2026-10-12" })).toBe("Oct 12, 2026");
    expect(groupDatesText({ from: "2026-10-12", to: null })).toBe("From Oct 12, 2026");
    expect(groupDatesText({ from: null, to: null })).toBeNull();
  });

  it("matches days inside the dates, inclusive of both ends, with open ends unbounded", () => {
    const trip = group({ startOn: "2026-10-12", endOn: "2026-10-16" });
    expect(["2026-10-11", "2026-10-12", "2026-10-16", "2026-10-17"].map((day) => withinGroupDates(day, trip))).toEqual([false, true, true, false]);
    expect(withinGroupDates("2030-01-01", group({ startOn: "2026-10-12" }))).toBe(true);
    expect(withinGroupDates("2020-01-01", group({}))).toBe(true);
  });

  it("suggests only dated groups that cover the day", () => {
    const groups = [group({ id: "dated", startOn: "2026-10-12", endOn: "2026-10-16" }), group({ id: "undated" }), group({ id: "later", startOn: "2026-11-01" })];
    expect(groupsCovering("2026-10-14", groups).map((item) => item.id)).toEqual(["dated"]);
  });

  it("refuses a nameless group and an end before the start", () => {
    expect(groupDraftError({ name: "  ", startOn: "", endOn: "" })?.field).toBe("name");
    expect(groupDraftError({ name: "Trip", startOn: "2026-10-16", endOn: "2026-10-12" })?.field).toBe("endOn");
    expect(groupDraftError({ name: "Trip", startOn: "2026-10-12", endOn: "2026-10-12" })).toBeNull();
  });
});

describe("ordering groups", () => {
  it("puts the most recent activity first", () => {
    const groups = [group({ id: "old", endOn: "2026-01-05" }), group({ id: "recent" }), group({ id: "empty", createdAt: "2026-09-01T00:00:00.000Z" })];
    const transactions = [entry({ groupId: "recent", occurredOn: "2026-10-20" })];
    expect(sortGroups(groups, transactions).map((item) => item.id)).toEqual(["recent", "empty", "old"]);
  });
});
