import { describe, expect, it } from "vitest";
import { activityToast } from "./ActivityIcon";
import type { ActivityEntry } from "../lib/activity-log";

const entry = { action: "transactions.bulk_edited", area: "transactions", title: "Edited 2 transactions", subject: null, amountMinor: null, currency: "NPR", meta: { count: 2 }, changes: [{ field: "Date", from: { date: "2026-11-06" }, to: { date: "2026-11-05" } }] } as unknown as ActivityEntry;

describe("activityToast", () => {
  it("shows changed dates the way the ledger does, not as ISO strings", () => {
    const body = activityToast(entry).body ?? "";
    expect(body).not.toContain("2026-11-06");
    expect(body).toContain("Nov 6, 2026");
    expect(body).toContain("Nov 5, 2026");
  });
});
