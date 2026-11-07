import { describe, expect, it } from "vitest";
import { applyBulkChanges, bulkEditTargets, hasBulkChanges, lockedByReconciliation, previewBulkEdit } from "./bulk-edit";
import type { AccountReconciliation, LedgerTransaction } from "../types";

const entry = (over: Partial<LedgerTransaction>) => ({ id: "t", userId: "u1", kind: "expense", category: "food", subcategory: null, amountMinor: 5000, occurredOn: "2026-10-01", createdAt: "2026-10-01T08:00:00.000Z", note: "Tea", paymentMode: "cash", paymentAccountId: null, area: "Thamel", locationLabel: "Cafe", ...over }) as LedgerTransaction;
const reconciliation = (over: Partial<AccountReconciliation>) => ({ id: "r1", paymentAccountId: "acc-1", checkedOn: "2026-10-15", approvedAt: "2026-10-15T12:00:00.000Z", ...over }) as AccountReconciliation;

describe("bulk edit changes", () => {
  it("changes only the chosen fields and keeps everything else", () => {
    const next = applyBulkChanges(entry({ subcategory: "Lunch" }), { occurredOn: "2026-10-03" });
    expect(next).toMatchObject({ occurredOn: "2026-10-03", category: "food", subcategory: "Lunch", area: "Thamel", locationLabel: "Cafe", amountMinor: 5000 });
  });

  it("replaces the subcategory with the category and drops the account for cash", () => {
    const online = entry({ paymentMode: "online", paymentAccountId: "acc-1", subcategory: "Lunch" });
    expect(applyBulkChanges(online, { category: { kind: "expense", category: "transport", subcategory: "" }, payment: { paymentMode: "cash", paymentAccountId: "acc-1" } }))
      .toMatchObject({ category: "transport", subcategory: null, paymentMode: "cash", paymentAccountId: null });
  });

  it("knows when nothing has been chosen", () => {
    expect(hasBulkChanges({})).toBe(false);
    expect(hasBulkChanges({ occurredOn: "2026-10-03" })).toBe(true);
  });
});

describe("bulk edit preview", () => {
  const selected = [
    entry({ id: "a", category: "food" }),
    entry({ id: "b", category: "transport" }),
    entry({ id: "c", kind: "income", category: "salary" }),
  ];

  it("counts what changes, what already matches, and type switches", () => {
    const changes = { category: { kind: "expense" as const, category: "food", subcategory: "" } };
    expect(previewBulkEdit(selected, changes, [])).toEqual({ changed: 2, unchanged: 1, kindSwitches: 1, intoLocked: 0 });
    expect(bulkEditTargets(selected, changes).map((item) => item.id)).toEqual(["b", "c"]);
  });

  it("flags entries that would move into a reconciled period", () => {
    const changes = { payment: { paymentMode: "online" as const, paymentAccountId: "acc-1" } };
    expect(previewBulkEdit(selected, changes, [reconciliation({})], new Date("2026-11-01T00:00:00Z")).intoLocked).toBe(3);
    expect(previewBulkEdit(selected, { ...changes, occurredOn: "2026-10-20" }, [reconciliation({})], new Date("2026-11-01T00:00:00Z")).intoLocked).toBe(0);
  });
});

describe("reconciliation locks", () => {
  const locks = [reconciliation({})];

  it("locks entries on the account up to the checked day", () => {
    expect(lockedByReconciliation(entry({ paymentAccountId: "acc-1", occurredOn: "2026-10-10" }), locks)).not.toBeNull();
    expect(lockedByReconciliation(entry({ paymentAccountId: "acc-1", occurredOn: "2026-10-16" }), locks)).toBeNull();
    expect(lockedByReconciliation(entry({ paymentAccountId: "acc-2", occurredOn: "2026-10-10" }), locks)).toBeNull();
    expect(lockedByReconciliation(entry({ occurredOn: "2026-10-10" }), locks)).toBeNull();
  });

  it("on the checked day, locks only entries recorded before the approval", () => {
    expect(lockedByReconciliation(entry({ paymentAccountId: "acc-1", occurredOn: "2026-10-15", createdAt: "2026-10-15T09:00:00.000Z" }), locks)).not.toBeNull();
    expect(lockedByReconciliation(entry({ paymentAccountId: "acc-1", occurredOn: "2026-10-15", createdAt: "2026-10-15T13:00:00.000Z" }), locks)).toBeNull();
  });
});
