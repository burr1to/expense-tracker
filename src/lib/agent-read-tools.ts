import { parseISO } from "date-fns";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client";
import { attachCurrentBalances, totalCurrentBalance } from "./account-balances";
import { serializeActivity } from "./activity-recorder";
import { ACTIVITY_AREAS, ACTIVITY_RETENTION_DAYS } from "./activity-log";
import type { AgentPrincipal } from "./agent-oauth-store";
import { budgetLabel, buildBudgetCarryForward, isAllSpendingBudget } from "./budgets";
import { forecastCash } from "./cash-forecast";
import { getCategory, CATEGORIES } from "./categories";
import { formatMoney } from "./currency";
import { isInMonth, monthKey as storageMonthKey, periodRange } from "./dates";
import { buildDebtPlan, isPlannableDebt, suggestedPayoffBudgetMinor, type PayoffStrategy } from "./debt-planner";
import { dueRemaining, dueUrgency, isDebtKind } from "./dues";
import { generateInsights } from "./insights";
import { loadLedger, serialize } from "./ledger-snapshot";
import { summarizeLedger } from "./ledger";
import { financialMilestones } from "./milestones";
import { buildMonthSnapshot } from "./month-snapshot";
import { isReportPeriodKey } from "./monthly-report";
import { loadMonthlyReport } from "./monthly-report-data";
import { paymentAccountLabel } from "./payment-accounts";
import { addMonthsToKey, currentMonthKey, fromStorageKey, isMonthKey, todayInAppZone, type PeriodKey } from "./period";
import { calculateBudgetPacing, calculateSafeToSpendV2, calculateUnbudgetedSpending, committedBeforeHorizon, detectSpendingHorizon, recurringAwaitingConfirmation } from "./planning-insights";
import { calculatePlaceSpendingTrends } from "./place-spending-trends";
import { recurrenceLabel } from "./recurrence";
import { groupEntries, groupSpan, summarizeGroup } from "./transaction-groups";
import { ToolInputError, type ToolDefinition } from "./mcp-protocol";
import type {
  AccountReconciliation, AccountTransfer, Budget, CurrencyCode, CustomCategory, CustomSubcategory, DueItem, LedgerTransaction, PaymentAccount, Profile,
  RecurringEntry, SavedPlace, SavingsGoal, TransactionGroup,
} from "../types";

/**
 * Read-only tools that give an agent the same picture of the ledger the app shows. Each one is
 * computed by the app's own report, budget, forecast and insight code, so the numbers match the
 * screens. All of them only read; none can change the ledger.
 */

/** The ledger exactly as the app receives it from GET /api/ledger (dates as strings), so every helper sees the same input as the screens. */
interface Snapshot { profile: Profile; transactions: LedgerTransaction[]; budgets: Budget[]; recurringEntries: RecurringEntry[]; goals: SavingsGoal[]; customCategories: CustomCategory[]; customSubcategories: CustomSubcategory[]; paymentAccounts: PaymentAccount[]; reconciliations: AccountReconciliation[]; savedPlaces: SavedPlace[]; transfers: AccountTransfer[]; dueItems: DueItem[]; transactionGroups: TransactionGroup[] }

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const monthInput = z.string().trim().refine(isMonthKey, "Use YYYY-MM, or BS:YYYY-MM for a Bikram Sambat month.");

/** Money as exact minor units (1/100) plus a ready-to-read string in the user's currency. */
export function moneyOf(currency: CurrencyCode) {
  return (minor: number) => ({ minor, text: formatMoney(minor, currency) });
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A month the user asked for, or their current month in their own calendar. */
function resolveMonth(input: string | undefined, snapshot: Snapshot): PeriodKey {
  return input ? fromStorageKey(input) : currentMonthKey(snapshot.profile.calendarSystem);
}

function categoryName(category: string, custom: readonly CustomCategory[]) {
  return getCategory(category, custom).label;
}

export function ledgerReadTools(db: PrismaClient, principal: AgentPrincipal): ToolDefinition[] {
  const userId = principal.userId;
  // One snapshot per request: several tools in one call share it, and it is never cached across requests.
  let cached: Promise<Snapshot> | null = null;
  const snapshot = () => (cached ??= loadLedger(userId).then((data) => JSON.parse(JSON.stringify(serialize(data))) as Snapshot));

  const context = async () => {
    const data = await snapshot();
    const currency = data.profile.currency as CurrencyCode;
    const accountName = new Map(data.paymentAccounts.map((account) => [account.id, paymentAccountLabel(account)]));
    return { data, currency, money: moneyOf(currency), today: todayInAppZone(), accountName, category: (id: string) => categoryName(id, data.customCategories) };
  };

  const getLedgerContext: ToolDefinition<Record<string, never>> = {
    name: "get_ledger_context",
    title: "Ledger context",
    description: "Start here. The user's name, currency, calendar (AD or BS), today's date in Nepal, every category, payment account and group id, saved places, and household sharing. Amounts everywhere are { minor, text }: minor is exact 1/100 units.",
    scope: "ledger:read",
    readOnly: true,
    input: z.object({}).strict(),
    run: async () => {
      const { data, money, today } = await context();
      return {
        name: data.profile.displayName,
        currency: data.profile.currency,
        calendar: data.profile.calendarSystem,
        today,
        current_month: currentMonthKey(data.profile.calendarSystem),
        safe_to_spend_buffer: money(data.profile.safeToSpendBufferMinor),
        household: data.profile.household ? { name: data.profile.household.name, status: data.profile.household.status, members: data.profile.household.members.map((member) => member.name) } : null,
        categories: [
          ...CATEGORIES.map((category) => ({ id: category.id, name: category.label, kind: category.kind, custom: false })),
          ...data.customCategories.map((category) => ({ id: category.id, name: category.name, kind: category.kind, custom: true })),
        ],
        subcategories: data.customSubcategories.map((item) => ({ category: item.categoryId, name: item.name })),
        accounts: data.paymentAccounts.map((account) => ({ id: account.id, name: paymentAccountLabel(account), type: account.type, account_tail: account.accountTail ?? null, shared: Boolean(account.shared), mine: account.userId === userId })),
        groups: data.transactionGroups.map((group) => ({ id: group.id, name: group.name, from: group.startOn, to: group.endOn })),
        saved_places: data.savedPlaces.map((place) => ({ id: place.id, name: place.name, address: place.address })),
        transactions_on_record: data.transactions.length,
        first_entry_on: data.transactions.at(-1)?.occurredOn ?? null,
      };
    },
  };

  const listTransactions: ToolDefinition<{ from?: string; to?: string; kind?: "expense" | "income"; category?: string; account_id?: string; group_id?: string; search?: string; min_amount?: number; max_amount?: number; limit?: number }> = {
    name: "list_transactions",
    title: "List transactions",
    description: "Ledger entries, newest first, with filters. Defaults to the last 30 days. Includes a partner's entries they marked shared (mine: false).",
    scope: "ledger:read",
    readOnly: true,
    input: z.object({
      from: dateOnly.optional().describe("First day, YYYY-MM-DD."),
      to: dateOnly.optional().describe("Last day, YYYY-MM-DD. Defaults to today."),
      kind: z.enum(["expense", "income"]).optional(),
      category: z.string().max(64).optional().describe("Category id from get_ledger_context."),
      account_id: z.string().max(64).optional(),
      group_id: z.string().max(64).optional(),
      search: z.string().trim().min(1).max(80).optional().describe("Text in the note, place or subcategory."),
      min_amount: z.number().nonnegative().optional().describe("In major units, e.g. 500 for NPR 500."),
      max_amount: z.number().nonnegative().optional(),
      limit: z.number().int().min(1).max(500).optional().describe("Default 100."),
    }).strict(),
    run: async (input) => {
      const { data, money, today, accountName, category } = await context();
      const to = input.to ?? today;
      const from = input.from ?? addDays(to, -29);
      if (from > to) throw new ToolInputError("from must be on or before to.");
      const needle = input.search?.toLowerCase();
      const groupName = new Map(data.transactionGroups.map((group) => [group.id, group.name]));
      const matches = data.transactions.filter((item) =>
        item.occurredOn >= from && item.occurredOn <= to
        && (!input.kind || item.kind === input.kind)
        && (!input.category || item.category === input.category)
        && (!input.account_id || item.paymentAccountId === input.account_id)
        && (!input.group_id || item.groupId === input.group_id)
        && (input.min_amount === undefined || item.amountMinor >= Math.round(input.min_amount * 100))
        && (input.max_amount === undefined || item.amountMinor <= Math.round(input.max_amount * 100))
        && (!needle || [item.note, item.locationLabel, item.subcategory, item.area].some((value) => value?.toLowerCase().includes(needle))));
      const limit = input.limit ?? 100;
      const income = matches.filter((item) => item.kind === "income").reduce((sum, item) => sum + item.amountMinor, 0);
      const expense = matches.filter((item) => item.kind === "expense").reduce((sum, item) => sum + item.amountMinor, 0);
      return {
        from, to, matched: matches.length, returned: Math.min(limit, matches.length),
        totals: { income: money(income), expense: money(expense) },
        transactions: matches.slice(0, limit).map((item) => ({
          id: item.id, date: item.occurredOn, kind: item.kind, amount: money(item.amountMinor),
          category: item.category, category_name: category(item.category), subcategory: item.subcategory, area: item.area,
          note: item.note, place: item.locationLabel, payment_mode: item.paymentMode,
          account: item.paymentAccountId ? accountName.get(item.paymentAccountId) ?? null : null,
          group: item.groupId ? groupName.get(item.groupId) ?? null : null,
          shared: item.shared, mine: item.userId === userId, has_receipt: Boolean(item.receipt),
        })),
      };
    },
  };

  const listTransfers: ToolDefinition<{ from?: string; to?: string }> = {
    name: "list_transfers",
    title: "List transfers",
    description: "Money moved between the user's own accounts (wallet loads, ATM withdrawals, bank to bank). Not income or spending. Defaults to the last 30 days.",
    scope: "ledger:read",
    readOnly: true,
    input: z.object({ from: dateOnly.optional(), to: dateOnly.optional() }).strict(),
    run: async (input) => {
      const { data, money, today, accountName } = await context();
      const to = input.to ?? today;
      const from = input.from ?? addDays(to, -29);
      return {
        from, to,
        transfers: data.transfers.filter((item) => item.occurredOn >= from && item.occurredOn <= to).map((item) => ({
          id: item.id, date: item.occurredOn, amount: money(item.amountMinor), from_account: accountName.get(item.fromAccountId) ?? null, to_account: accountName.get(item.toAccountId) ?? null, note: item.note,
        })),
      };
    },
  };

  const getMonthlyReport: ToolDefinition<{ period?: string; include_transactions?: boolean }> = {
    name: "get_monthly_report",
    title: "Monthly report",
    description: "The same report as the app's PDF: income, spending, net and savings rate with change from the previous period; spending and income by category and subcategory; budgets used; each account's movement and balance; transfers; dues due or settled; recurring entries. Works for a running month too (numbers so far).",
    scope: "ledger:read",
    readOnly: true,
    input: z.object({
      period: z.string().trim().refine(isReportPeriodKey, "Use YYYY-MM, BS:YYYY-MM or FY:YYYY-YY.").optional().describe("A month (2026-10), a Bikram Sambat month (BS:2083-06) or a Nepali fiscal year (FY:2082-83). Defaults to last month."),
      include_transactions: z.boolean().optional().describe("Also list every entry in the period. Default false."),
    }).strict(),
    run: async (input) => {
      const { data } = await context();
      const period = input.period ?? storageMonthKey(addMonthsToKey(currentMonthKey(data.profile.calendarSystem), -1));
      const report = await loadMonthlyReport(db, userId, period);
      const money = moneyOf(report.currency);
      const group = (rows: typeof report.categories) => rows.map((row) => ({ ...row, amount: money(row.amountMinor) }));
      return {
        period: report.monthKey, label: report.monthLabel, starts_on: report.periodStart, days: report.dayCount, compared_with: `previous ${report.periodNoun}`,
        summary: {
          income: money(report.summary.incomeMinor), spending: money(report.summary.expenseMinor), net: money(report.summary.netMinor),
          savings_rate_percent: report.summary.savingsRate, entries: report.summary.transactionCount,
          income_change_percent: report.summary.incomeChangePercentage, spending_change_percent: report.summary.expenseChangePercentage,
        },
        spending_by_category: group(report.categories),
        income_by_category: group(report.incomeCategories),
        spending_by_subcategory: group(report.subcategories),
        budgets: report.budgets.map((row) => ({ category: row.categoryLabel, limit: money(row.amountMinor), spent: money(row.spentMinor), remaining: money(row.remainingMinor), used_percent: row.usedPercentage })),
        accounts: report.accounts.map((row) => ({ account: row.label, income: money(row.incomeMinor), spending: money(row.expenseMinor), transfers_in: money(row.transfersInMinor), transfers_out: money(row.transfersOutMinor), balance_now: money(row.balanceMinor) })),
        transfers: report.transfers.map((row) => ({ date: row.occurredOn, amount: money(row.amountMinor), note: row.note })),
        dues: report.dues.map((row) => ({ title: row.title, kind: row.kind, amount: money(row.amountMinor), paid: money(row.paidMinor), due_on: row.dueOn, status: row.status, completed_on: row.completedOn })),
        recurring: report.recurring.map((row) => ({ kind: row.kind, category: row.categoryLabel, amount: money(row.amountMinor), note: row.note, schedule: row.scheduleLabel, next_due_on: row.nextDueOn })),
        ...(input.include_transactions ? { transactions: report.transactions.map((row) => ({ id: row.id, date: row.occurredOn, kind: row.kind, category: row.categoryLabel, subcategory: row.subcategory, amount: money(row.amountMinor), note: row.note })) } : {}),
      };
    },
  };

  const getMonthOverview: ToolDefinition<{ month?: string }> = {
    name: "get_month_overview",
    title: "Month overview and what needs attention",
    description: "The dashboard for a month, with what to work on: spending against budget or last month, where the month is heading (projected net), safe-to-spend until the next payday, budgets at risk, bills and dues coming up, recurring entries waiting for confirmation, and the app's own insights (unusual spending, busiest day, biggest category changes).",
    scope: "ledger:read",
    readOnly: true,
    input: z.object({ month: monthInput.optional().describe("Defaults to the current month.") }).strict(),
    run: async (input) => {
      const { data, money, today, currency, category } = await context();
      const month = resolveMonth(input.month, data);
      const stored = storageMonthKey(month);
      const { transactions, recurringEntries, dueItems, customCategories } = data;
      const monthBudgets = data.budgets.filter((item) => item.monthKey === stored);
      const pacing = calculateBudgetPacing(monthBudgets, transactions, recurringEntries, dueItems, month, parseISO(today));
      const monthSnapshot = buildMonthSnapshot({ month, today, transactions, recurringEntries, dueItems, budgetPacing: pacing });
      const summary = summarizeLedger(transactions.filter((item) => isInMonth(item.occurredOn, month)), customCategories);
      const insights = generateInsights(transactions, month, currency, customCategories, { recurringEntries, dueItems, calendarSystem: data.profile.calendarSystem, today });
      const isCurrent = monthSnapshot.timing === "current";
      const balance = totalCurrentBalance(data.paymentAccounts);
      let safeToSpend = null;
      if (isCurrent && data.paymentAccounts.length) {
        const horizon = detectSpendingHorizon(recurringEntries, transactions, month, today);
        const committed = committedBeforeHorizon(recurringEntries, dueItems, horizon, today);
        const result = calculateSafeToSpendV2(balance, committed, horizon, data.profile.safeToSpendBufferMinor, recurringAwaitingConfirmation(recurringEntries, today));
        safeToSpend = {
          total: money(result.totalMinor), per_day: money(result.perDayMinor), through: result.horizon.throughDate, days: result.horizon.daysRemaining, horizon_from: result.horizon.source,
          balance: money(result.balanceMinor), committed: money(result.committedMinor), overdue_recurring: money(result.overdueRecurringMinor), buffer: money(result.bufferMinor),
        };
      }
      const range = periodRange(month);
      const target = monthSnapshot.target;
      return {
        month: stored, from: range.start, to: range.end, timing: monthSnapshot.timing,
        income: money(monthSnapshot.incomeMinor), spending: money(monthSnapshot.spentMinor),
        net: { ...money(monthSnapshot.netMinor), is_estimate: monthSnapshot.netIsEstimate },
        target: target.kind === "none" ? null
          : target.kind === "previousMonth" ? { against: "previous month", previous_month: target.previousMonth, this_month: money(target.currentMinor), previous: money(target.previousMinor), through_day: target.throughDay, change_percent: target.changePercentage }
          : { against: target.kind === "allSpending" ? "all-spending budget" : `${target.count} category budgets`, limit: money(target.limitMinor), spent: money(target.spentMinor), used_percent: target.percentage },
        budget_daily_allowance: monthSnapshot.budgetDailyMinor === null ? null : money(monthSnapshot.budgetDailyMinor),
        safe_to_spend: safeToSpend,
        top_spending: summary.categories.slice(0, 6).map((row) => ({ category: row.label, amount: money(row.value), percent: row.percentage })),
        budgets_needing_attention: pacing.filter((item) => item.tone !== "healthy").map((item) => ({
          budget: isAllSpendingBudget(item.budget) ? "All spending" : budgetLabel(item.budget.category, customCategories), tone: item.tone,
          spent: money(item.spentMinor), projected: money(item.projectedMinor), limit: money(item.budget.amountMinor), projected_percent: item.projectedPercentage, alert: `${item.alertTitle}. ${item.alertDetail}`,
        })),
        recurring_awaiting_confirmation: recurringEntries.filter((entry) => entry.active && entry.nextDueOn <= today).map((entry) => ({ id: entry.id, kind: entry.kind, category: category(entry.category), amount: money(entry.amountMinor), due_on: entry.nextDueOn, note: entry.note })),
        dues_overdue_or_today: dueItems.filter((item) => item.status === "open" && dueUrgency(item, today) !== "later").map((item) => ({ id: item.id, title: item.title, kind: item.kind, person: item.person, remaining: money(dueRemaining(item)), due_on: item.dueOn })),
        // As on the dashboard: the pace-only projection insight is a second, different estimate of `net`, so it is left out.
        insights: insights.filter((item) => item.id !== "projection").map((item) => ({ tone: item.tone, title: item.title, detail: item.detail, amount: item.amountMinor === undefined ? null : money(item.amountMinor) })),
      };
    },
  };

  const getAccounts: ToolDefinition<Record<string, never>> = {
    name: "get_accounts",
    title: "Accounts and balances",
    description: "Every payment account (cash, bank, wallet, card) with its current tracked balance, the total, and when each was last reconciled against the real balance.",
    scope: "ledger:read",
    readOnly: true,
    input: z.object({}).strict(),
    run: async () => {
      const { data, money } = await context();
      const accounts = attachCurrentBalances(data.paymentAccounts, data.transactions, data.transfers);
      const lastCheck = new Map<string, (typeof data.reconciliations)[number]>();
      for (const item of data.reconciliations) if (!lastCheck.has(item.paymentAccountId)) lastCheck.set(item.paymentAccountId, item);
      return {
        total: money(totalCurrentBalance(accounts)),
        accounts: accounts.map((account) => {
          const check = lastCheck.get(account.id);
          return {
            id: account.id, name: paymentAccountLabel(account), type: account.type, provider: account.provider, account_tail: account.accountTail ?? null,
            balance: money(account.currentBalanceMinor), opening_balance: money(account.balanceMinor), opening_balance_as_of: account.balanceAsOf,
            shared: Boolean(account.shared), mine: account.userId === userId,
            last_reconciled: check ? { on: check.checkedOn, expected: money(check.expectedBalanceMinor), actual: money(check.actualBalanceMinor), adjustment: money(check.adjustmentMinor), note: check.adjustmentNote } : null,
          };
        }),
      };
    },
  };

  const getBudgets: ToolDefinition<{ month?: string }> = {
    name: "get_budgets",
    title: "Budgets",
    description: "A month's budgets with pacing: spent, upcoming bills, projected end-of-month, daily allowance left and a health tone. Also spending in categories with no budget, and last month's limits and actuals for planning the next one.",
    scope: "ledger:read",
    readOnly: true,
    input: z.object({ month: monthInput.optional().describe("Defaults to the current month.") }).strict(),
    run: async (input) => {
      const { data, money, today, category } = await context();
      const month = resolveMonth(input.month, data);
      const stored = storageMonthKey(month);
      const monthBudgets = data.budgets.filter((item) => item.monthKey === stored);
      const pacing = calculateBudgetPacing(monthBudgets, data.transactions, data.recurringEntries, data.dueItems, month, parseISO(today));
      const unbudgeted = calculateUnbudgetedSpending(monthBudgets, data.transactions, month);
      const carry = buildBudgetCarryForward(data.budgets, data.transactions, stored, userId, today);
      const months = [...new Set(data.budgets.map((item) => item.monthKey))].sort().reverse().slice(0, 12);
      return {
        month: stored,
        months_with_budgets: months,
        budgets: pacing.map((item) => ({
          id: item.budget.id, budget: isAllSpendingBudget(item.budget) ? "All spending" : budgetLabel(item.budget.category, data.customCategories), shared: Boolean(item.budget.shared),
          limit: money(item.budget.amountMinor), spent: money(item.spentMinor), upcoming: money(item.upcomingMinor), projected: money(item.projectedMinor), remaining: money(item.remainingMinor),
          spent_percent: item.spentPercentage, projected_percent: item.projectedPercentage, month_elapsed_percent: item.elapsedPercentage,
          days_left: item.remainingDays, daily_allowance: money(item.dailyAllowanceMinor), tone: item.tone, alert: item.tone === "healthy" ? null : `${item.alertTitle}. ${item.alertDetail}`,
        })),
        unbudgeted_spending: unbudgeted,
        from_last_month: carry ? { month: carry.previousMonthKey, rows: carry.rows.map((row) => ({ budget: row.category === "__total" ? "All spending" : category(row.category), last_limit: money(row.lastLimitMinor), last_actual: money(row.lastActualMinor), three_month_average: row.averageMinor === null ? null : money(row.averageMinor) })) } : null,
      };
    },
  };

  const getDues: ToolDefinition<{ status?: "open" | "completed" | "all"; payoff_strategy?: PayoffStrategy; monthly_payoff_budget?: number }> = {
    name: "get_dues",
    title: "Dues, loans and money owed",
    description: "Bills to pay, money others owe the user, money lent and borrowed: remaining amount, due date, urgency (overdue, today, later), interest rate and payment history. Includes a debt payoff plan for borrowed money.",
    scope: "ledger:read",
    readOnly: true,
    input: z.object({
      status: z.enum(["open", "completed", "all"]).optional().describe("Default open."),
      payoff_strategy: z.enum(["snowball", "avalanche", "dueDate"]).optional().describe("For the payoff plan. Default snowball (smallest first)."),
      monthly_payoff_budget: z.number().positive().optional().describe("Major units per month for the payoff plan. Default: the same suggestion the Dues page starts from."),
    }).strict(),
    run: async (input) => {
      const { data, money, today } = await context();
      const status = input.status ?? "open";
      const items = data.dueItems.filter((item) => status === "all" || item.status === status);
      const debts = data.dueItems.filter(isPlannableDebt);
      let plan = null;
      if (debts.length) {
        const strategy = input.payoff_strategy ?? "snowball";
        const budget = input.monthly_payoff_budget ? Math.round(input.monthly_payoff_budget * 100) : suggestedPayoffBudgetMinor(debts);
        const result = buildDebtPlan(debts, budget, strategy, today);
        plan = {
          strategy, monthly_budget: money(budget), minimum_monthly: money(result.minimumMonthlyMinor), total_remaining: money(result.totalRemainingMinor),
          months_to_debt_free: result.impossible ? null : result.monthsToDebtFree, debt_free_on: result.debtFreeOn, total_interest: money(result.totalInterestMinor), impossible: result.impossible,
          order: result.entries.map((entry) => ({ title: entry.item.title, remaining: money(entry.remainingMinor), months_to_clear: entry.monthsToClear, cleared_on: entry.projectedClearedOn, interest: money(entry.interestMinor) })),
        };
      }
      const open = data.dueItems.filter((item) => item.status === "open");
      const totalOf = (kinds: string[]) => money(open.filter((item) => kinds.includes(item.kind)).reduce((sum, item) => sum + dueRemaining(item), 0));
      return {
        totals_open: { you_owe: totalOf(["payment", "borrowed"]), owed_to_you: totalOf(["receivable", "lent"]) },
        dues: items.map((item) => ({
          id: item.id, title: item.title, kind: item.kind, is_loan: isDebtKind(item.kind), person: item.person, status: item.status,
          amount: money(item.amountMinor), remaining: money(dueRemaining(item)), due_on: item.dueOn, urgency: item.status === "open" ? dueUrgency(item, today) : null,
          remind_on: item.remindOn, annual_rate_percent: item.annualRatePercent, started_on: item.occurredOn, completed_on: item.completedOn, note: item.note,
          payments: item.payments.map((payment) => ({ date: payment.occurredOn, amount: money(payment.amountMinor), note: payment.note })),
        })),
        payoff_plan: plan,
      };
    },
  };

  const getRecurring: ToolDefinition<{ days_ahead?: number }> = {
    name: "get_recurring",
    title: "Recurring income and bills",
    description: "Salary, rent, subscriptions and other repeating entries: amount, schedule, next due date, and which are due but not yet confirmed in the app.",
    scope: "ledger:read",
    readOnly: true,
    input: z.object({ days_ahead: z.number().int().min(1).max(366).optional().describe("Also list what falls due in this many days. Default 30.") }).strict(),
    run: async (input) => {
      const { data, money, today, accountName, category } = await context();
      const until = addDays(today, input.days_ahead ?? 30);
      const rows = data.recurringEntries.map((entry) => ({
        id: entry.id, kind: entry.kind, category: category(entry.category), amount: money(entry.amountMinor), note: entry.note, schedule: recurrenceLabel(entry),
        next_due_on: entry.nextDueOn, active: entry.active, account: entry.paymentAccountId ? accountName.get(entry.paymentAccountId) ?? null : null,
        awaiting_confirmation: entry.active && entry.nextDueOn <= today,
      }));
      const upcoming = rows.filter((row) => row.active && row.next_due_on <= until);
      const monthly = (kind: string) => data.recurringEntries.filter((entry) => entry.active && entry.kind === kind && entry.recurrenceUnit === "month" && entry.recurrenceInterval === 1).reduce((sum, entry) => sum + entry.amountMinor, 0);
      return { monthly_recurring_income: money(monthly("income")), monthly_recurring_bills: money(monthly("expense")), due_by: until, upcoming, all: rows };
    },
  };

  const getSavingsGoals: ToolDefinition<Record<string, never>> = {
    name: "get_savings_goals",
    title: "Savings goals",
    description: "Savings goals with target, saved so far, percent, target date and the monthly amount needed to get there on time.",
    scope: "ledger:read",
    readOnly: true,
    input: z.object({}).strict(),
    run: async () => {
      const { data, money, today } = await context();
      return {
        goals: data.goals.map((goal) => {
          const left = Math.max(0, goal.targetMinor - goal.savedMinor);
          const monthsLeft = goal.targetDate ? Math.max(0, (Number(goal.targetDate.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(goal.targetDate.slice(5, 7)) - Number(today.slice(5, 7))) : null;
          return {
            id: goal.id, name: goal.name, target: money(goal.targetMinor), saved: money(goal.savedMinor), left: money(left),
            percent: goal.targetMinor > 0 ? Math.round((goal.savedMinor / goal.targetMinor) * 100) : 0, target_date: goal.targetDate,
            needed_per_month: monthsLeft === null ? null : money(monthsLeft > 0 ? Math.ceil(left / monthsLeft) : left),
            last_contribution: goal.contributions[0] ? { amount: money(goal.contributions[0].amountMinor), on: goal.contributions[0].createdAt.slice(0, 10) } : null,
          };
        }),
      };
    },
  };

  const getCashForecast: ToolDefinition<{ days?: number }> = {
    name: "get_cash_forecast",
    title: "Cash forecast",
    description: "Projected balance across tracked accounts for the coming days: scheduled income and bills, open dues, and the recent daily spending pace. Shows the lowest point and when it happens.",
    scope: "ledger:read",
    readOnly: true,
    input: z.object({ days: z.number().int().min(7).max(90).optional().describe("Default 30.") }).strict(),
    run: async (input) => {
      const { data, money, today } = await context();
      const days = input.days ?? 30;
      const forecast = forecastCash({ startingBalanceMinor: totalCurrentBalance(data.paymentAccounts), transactions: data.transactions, recurringEntries: data.recurringEntries, dueItems: data.dueItems, today, days });
      const last = forecast.days.at(-1) ?? forecast.day30;
      const point = (day: typeof last) => ({ date: day.date, balance: money(day.balanceMinor), income: money(day.incomeMinor), bills: money(day.billsMinor), dues: money(day.duesMinor), pace: money(day.paceMinor) });
      return {
        starting_balance: money(forecast.startingBalanceMinor), daily_spending_pace: money(forecast.dailyPaceMinor),
        lowest: point(forecast.lowest), end: point(last),
        notable_days: forecast.days.filter((day) => day.incomeMinor || day.billsMinor || day.duesMinor).map(point),
      };
    },
  };

  const getPlaceTrends: ToolDefinition<{ months?: 1 | 3 | 6 | 12 }> = {
    name: "get_place_trends",
    title: "Spending by place",
    description: "Where spending changed most, place by place (shops, cafes, restaurants), compared with the period before: totals, visits, average bill and whether visits or bill size drove the change.",
    scope: "ledger:read",
    readOnly: true,
    input: z.object({ months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]).optional().describe("Period length. Default 1.") }).strict(),
    run: async (input) => {
      const { data, money, today } = await context();
      const trends = calculatePlaceSpendingTrends(data.transactions, data.savedPlaces, input.months ?? 1, parseISO(today));
      return {
        months: input.months ?? 1,
        places: trends.map((trend) => ({
          place: trend.label, address: trend.address, now: money(trend.currentTotalMinor), before: money(trend.previousTotalMinor), change_percent: trend.totalChangePercent,
          visits_now: trend.currentPurchases, visits_before: trend.previousPurchases, average_now: money(trend.currentAverageMinor), average_before: money(trend.previousAverageMinor), driver: trend.driver,
        })),
      };
    },
  };

  const listGroups: ToolDefinition<{ group_id?: string }> = {
    name: "list_groups",
    title: "Groups (trips, events)",
    description: "Named sets of entries such as a trip or a wedding: dates, entries, spent, received, net and top categories. Pass group_id for one group with its entries.",
    scope: "ledger:read",
    readOnly: true,
    input: z.object({ group_id: z.string().max(64).optional() }).strict(),
    run: async (input) => {
      const { data, money, category } = await context();
      const groups = input.group_id ? data.transactionGroups.filter((group) => group.id === input.group_id) : data.transactionGroups;
      if (input.group_id && !groups.length) throw new ToolInputError("No group with that id.");
      return {
        groups: groups.map((group) => {
          const entries = groupEntries(group.id, data.transactions);
          const summary = summarizeGroup(entries);
          const span = groupSpan(group, summary);
          return {
            id: group.id, name: group.name, icon: group.icon, from: span.from, to: span.to, note: group.note, entries: summary.count,
            spent: money(summary.spentMinor), received: money(summary.receivedMinor), net: money(summary.netMinor),
            top_categories: summary.categories.slice(0, 5).map((row) => ({ category: category(row.category), amount: money(row.amountMinor), entries: row.count })),
            ...(input.group_id ? { transactions: entries.map((item) => ({ id: item.id, date: item.occurredOn, kind: item.kind, category: category(item.category), amount: money(item.amountMinor), note: item.note })) } : {}),
          };
        }),
      };
    },
  };

  const getMilestones: ToolDefinition<Record<string, never>> = {
    name: "get_milestones",
    title: "Milestones",
    description: "Financial milestones the app recognises: best savings months, debts cleared, streaks and similar wins, newest first.",
    scope: "ledger:read",
    readOnly: true,
    input: z.object({}).strict(),
    run: async () => {
      const { data } = await context();
      return { milestones: financialMilestones(data.transactions, data.dueItems).map((item) => ({ date: item.date, title: item.title, detail: item.detail })) };
    },
  };

  const getActivity: ToolDefinition<{ area?: typeof ACTIVITY_AREAS[number]; limit?: number }> = {
    name: "get_activity_log",
    title: "Recent changes",
    description: `What changed in the ledger recently (added, edited and deleted entries, budgets, accounts, security events), newest first. Kept for ${ACTIVITY_RETENTION_DAYS} days.`,
    scope: "ledger:read",
    readOnly: true,
    input: z.object({ area: z.enum(ACTIVITY_AREAS).optional(), limit: z.number().int().min(1).max(100).optional().describe("Default 30.") }).strict(),
    run: async (input) => {
      const rows = await db.activityLog.findMany({ where: { userId, ...(input.area ? { area: input.area } : {}) }, orderBy: { createdAt: "desc" }, take: input.limit ?? 30 });
      return {
        entries: rows.map(serializeActivity).map((entry) => ({ at: entry.createdAt, area: entry.area, action: entry.action, title: entry.title, subject: entry.subject, amount: entry.amountMinor === null ? null : moneyOf(entry.currency)(entry.amountMinor), changes: entry.changes })),
      };
    },
  };

  return [getLedgerContext, listTransactions, listTransfers, getMonthlyReport, getMonthOverview, getAccounts, getBudgets, getDues, getRecurring, getSavingsGoals, getCashForecast, getPlaceTrends, listGroups, getMilestones, getActivity] as ToolDefinition[];
}
