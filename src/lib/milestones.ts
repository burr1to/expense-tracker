import { format, parseISO } from "date-fns";
import type { DueItem, LedgerTransaction } from "../types";

export interface FinancialMilestone { id: string; date: string; title: string; detail: string; tone: "blue" | "green" | "gold" }

export function financialMilestones(transactions: readonly LedgerTransaction[], dues: readonly DueItem[]): FinancialMilestone[] {
  const milestones: FinancialMilestone[] = [];
  const ordered = [...transactions].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  if (ordered[0]) milestones.push({ id: "first-entry", date: ordered[0].occurredOn, title: "Ledger started", detail: `Your first entry was “${ordered[0].note || ordered[0].category}”.`, tone: "blue" });

  const largest = [...transactions].sort((a, b) => b.amountMinor - a.amountMinor)[0];
  if (largest) milestones.push({ id: "largest-entry", date: largest.occurredOn, title: "Largest money movement", detail: `${largest.note || largest.category} became your largest ${largest.kind} entry.`, tone: "gold" });

  const months = new Map<string, { income: number; expenses: number }>();
  for (const item of transactions) {
    const key = item.occurredOn.slice(0, 7); const current = months.get(key) ?? { income: 0, expenses: 0 };
    current[item.kind === "income" ? "income" : "expenses"] += item.amountMinor; months.set(key, current);
  }
  const best = [...months.entries()].map(([key, value]) => ({ key, saved: value.income - value.expenses })).filter((item) => item.saved > 0).sort((a, b) => b.saved - a.saved)[0];
  if (best) milestones.push({ id: "best-month", date: `${best.key}-01`, title: "Best saving month", detail: `${format(parseISO(`${best.key}-01`), "MMMM yyyy")} currently holds your highest net savings.`, tone: "green" });

  for (const item of dues.filter((due) => due.status === "completed" && due.completedOn).slice(-4)) {
    const title = item.kind === "lent" ? "Money returned" : item.kind === "borrowed" ? "Borrowing repaid" : item.kind === "receivable" ? "Expected money received" : "Payment completed";
    milestones.push({ id: `due-${item.id}`, date: item.completedOn!, title, detail: item.person ? `${item.title} with ${item.person} was settled.` : `${item.title} was settled.`, tone: item.kind === "lent" || item.kind === "receivable" ? "green" : "blue" });
  }
  return milestones.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
}
