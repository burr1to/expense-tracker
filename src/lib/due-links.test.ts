import { describe, expect, it } from "vitest";
import { canStartLoanFrom, claimedOpeningAmounts, dueLinkLabel, dueLinksFor, linkMakesLoan, linkRestoreFor, loanKindFor, openingLinkCandidates, settlementLinkCandidates } from "./due-links";
import type { DueItem, DuePayment, LedgerTransaction } from "../types";

const entry = (changes: Partial<LedgerTransaction> & { clientRequestId?: string | null } = {}) => ({ id: "t1", userId: "u1", kind: "expense", category: "food", subcategory: null, amountMinor: 30_000, occurredOn: "2026-07-01", note: "Dinner", area: null, paymentMode: "cash", paymentAccountId: null, locationLabel: null, locationAddress: null, locationLatitude: null, locationLongitude: null, locationAccuracy: null, locationSource: null, savedPlaceId: null, createdAt: "2026-07-01T10:00:00.000Z", clientRequestId: null, ...changes }) as LedgerTransaction & { clientRequestId?: string | null };
const payment = (changes: Partial<DuePayment> = {}): DuePayment => ({ id: "p1", userId: "u1", dueItemId: "d1", amountMinor: 1_000, occurredOn: "2026-07-05", note: "", transactionId: null, linked: false, createdAt: "2026-07-05T00:00:00.000Z", ...changes });
const due = (changes: Partial<DueItem> = {}): DueItem => ({ id: "d1", userId: "u1", kind: "lent", title: "Dinner", person: "Mina", amountMinor: 10_000, category: "loan", occurredOn: "2026-07-01", dueOn: "2026-07-10", remindOn: null, snoozedUntil: null, note: "", status: "open", annualRatePercent: null, completedOn: null, createdAt: "2026-07-01T00:00:00.000Z", payments: [], linkedTransactionId: null, linkedRestoreCategory: null, ...changes });

describe("due links", () => {
  it("offers only entries moving the right way for a loan's opening", () => {
    const transactions = [entry({ id: "out" }), entry({ id: "in", kind: "income", category: "salary" })];
    expect(openingLinkCandidates({ kind: "lent", transactions, dues: [] }).map((item) => item.transaction.id)).toEqual(["out"]);
    expect(openingLinkCandidates({ kind: "borrowed", transactions, dues: [] }).map((item) => item.transaction.id)).toEqual(["in"]);
    expect(openingLinkCandidates({ kind: "payment", transactions, dues: [] })).toEqual([]);
  });

  it("lets one entry cover several loans but never more than its total", () => {
    const transactions = [entry({ id: "dinner", amountMinor: 30_000 })];
    const dues = [due({ id: "a", linkedTransactionId: "dinner", amountMinor: 10_000 }), due({ id: "b", linkedTransactionId: "dinner", amountMinor: 10_000 })];
    expect(openingLinkCandidates({ kind: "lent", transactions, dues })).toEqual([{ transaction: transactions[0], availableMinor: 10_000 }]);
    // Editing one of them gives its own share back.
    expect(openingLinkCandidates({ kind: "lent", transactions, dues, dueId: "a" })[0].availableMinor).toBe(20_000);
    expect(openingLinkCandidates({ kind: "lent", transactions, dues: [...dues, due({ id: "c", linkedTransactionId: "dinner", amountMinor: 10_000 })] })).toEqual([]);
    expect(claimedOpeningAmounts(dues).get("dinner")).toBe(20_000);
  });

  it("never offers entries a due wrote itself, someone else's entries, or a repayment already recorded", () => {
    const transactions = [entry({ id: "own-opening", clientRequestId: "due-open:d9" }), entry({ id: "split", clientRequestId: "split:abc:lent" }), entry({ id: "partner", userId: "u2" }), entry({ id: "repaid" }), entry({ id: "free" })];
    const dues = [due({ id: "other", kind: "borrowed", payments: [payment({ transactionId: "repaid" })] })];
    expect(openingLinkCandidates({ kind: "lent", transactions, dues, userId: "u1" }).map((item) => item.transaction.id)).toEqual(["free"]);
  });

  it("offers settlements in the direction the money returns, nearest the date first", () => {
    const transactions = [entry({ id: "far", kind: "income", category: "other", occurredOn: "2026-06-01" }), entry({ id: "near", kind: "income", category: "other", occurredOn: "2026-07-09" }), entry({ id: "spend" })];
    expect(settlementLinkCandidates({ kind: "lent", transactions, dues: [], nearDate: "2026-07-10" }).map((item) => item.transaction.id)).toEqual(["near", "far"]);
    expect(settlementLinkCandidates({ kind: "payment", transactions, dues: [] }).map((item) => item.transaction.id)).toEqual(["spend"]);
  });

  it("never settles a due with an entry that is already some loan's opening", () => {
    const transactions = [entry({ id: "dinner" })];
    expect(settlementLinkCandidates({ kind: "borrowed", transactions, dues: [due({ linkedTransactionId: "dinner" })] })).toEqual([]);
  });

  it("turns an entry into a loan only when the whole entry is the loan", () => {
    const dinner = entry({ amountMinor: 30_000 });
    expect(linkMakesLoan("lent", 30_000, dinner)).toBe(true);
    expect(linkMakesLoan("lent", 10_000, dinner)).toBe(false);
    expect(linkMakesLoan("payment", 30_000, dinner)).toBe(false);
    expect(linkMakesLoan("lent", 30_000, entry({ category: "loan" }))).toBe(false);
    expect(linkRestoreFor("lent", 30_000, entry({ subcategory: "Restaurant" }))).toEqual({ category: "food", subcategory: "Restaurant" });
    expect(linkRestoreFor("lent", 10_000, dinner)).toBeNull();
  });

  it("labels each linked entry by the due it belongs to", () => {
    const dues = [due({ linkedTransactionId: "t1", payments: [payment({ transactionId: "t2" })] }), due({ id: "rent", kind: "payment", title: "Rent", person: "", payments: [payment({ transactionId: "t3" })] })];
    expect(dueLinksFor(entry({ id: "t1" }), dues).map(dueLinkLabel)).toEqual(["Lent to Mina"]);
    expect(dueLinksFor(entry({ id: "t2" }), dues).map(dueLinkLabel)).toEqual(["Repaid by Mina"]);
    expect(dueLinksFor(entry({ id: "t3" }), dues).map(dueLinkLabel)).toEqual(["Paid · Rent"]);
    expect(dueLinksFor(entry({ id: "t4" }), dues)).toEqual([]);
  });

  it("includes a loan's own recorded opening among its links", () => {
    const dues = [due({ id: "d9", kind: "borrowed", person: "Hari" })];
    expect(dueLinksFor(entry({ id: "auto", kind: "income", clientRequestId: "due-open:d9" }), dues).map(dueLinkLabel)).toEqual(["Borrowed from Hari"]);
  });

  it("starts a loan only from an ordinary entry nothing else claims", () => {
    const dues = [due({ linkedTransactionId: "taken" })];
    const links = (transaction: ReturnType<typeof entry>) => dueLinksFor(transaction, dues);
    expect(canStartLoanFrom(entry({ id: "free" }), links(entry({ id: "free" })))).toBe(true);
    expect(canStartLoanFrom(entry({ id: "taken" }), links(entry({ id: "taken" })))).toBe(false);
    expect(canStartLoanFrom(entry({ id: "loan", category: "loan" }), [])).toBe(false);
    expect(canStartLoanFrom(entry({ id: "own", clientRequestId: "split:a:lent" }), [])).toBe(false);
    expect(loanKindFor(entry({ kind: "income" }))).toBe("borrowed");
    expect(loanKindFor(entry())).toBe("lent");
  });
});
