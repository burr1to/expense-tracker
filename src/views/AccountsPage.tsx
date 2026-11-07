import { ArrowCounterClockwise, Bank, CalendarBlank, CaretDown, CaretLeft, ArrowsLeftRight, Check, CheckCircle, Copy, LockKey, PencilSimple, Plus, Scales, ShieldCheck, Trash } from "@phosphor-icons/react";
import { Modal, NumberInput, Select, Switch, TextInput } from "@mantine/core";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useContext, useEffect, useMemo, useState, type CSSProperties } from "react";
import { EntryRow } from "../components/V2Entries";
import { AccountTile, CategoryTile } from "../components/ToneIcon";
import { countsAsIncomeOrSpending, getCategory } from "../lib/categories";
import { dayGroupLabel, groupLedgerActivityByDay, takeWholeDays } from "../lib/day-groups";
import { activityKey, plainAmount } from "../lib/entry-labels";
import { accountMonthDetail, CASH_BUCKET, compareMonthSpend, spendBucket, type AccountSpend } from "../lib/month-compare";
import { addMonthsToKey, currentMonthKey, monthLabel, type PeriodKey } from "../lib/period";
import { appRoutes } from "../lib/routes";
import { accountLook, categoryTone } from "../lib/tones";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { EmptyState } from "../components/EmptyState";
import { useLedger } from "../context/LedgerContext";
import { LedgerWorkspaceContext } from "../context/LedgerWorkspaceContext";
import { accountActivityThrough, activityHasMovement, expectedAccountBalanceThrough, reconciliationSpendingGap, transactionPostsTo, transferRemovalEffects, type AccountActivity } from "../lib/account-balances";
import { formatMoney, majorToMinor } from "../lib/currency";
import { formatLedgerDate, formatLedgerDay, formatLedgerMonth, todayInput } from "../lib/dates";
import { listLedgerActivity } from "../lib/transaction-history";
import { isCashAccount, NEPAL_MOBILE_BANKS, normalizeAccountTail, PAYMENT_ACCOUNT_TYPES, paymentAccountLabel, paymentAccountTypeLabel, paymentAccountProviderError, providerForAccountType } from "../lib/payment-accounts";
import type { CurrencyCode, LedgerTransaction, PaymentAccount, PaymentAccountType } from "../types";
import { FormError } from "../components/FormError";
import { BalanceLocked, HiddenBalance } from "../components/BalancePrivacy";

const monthName = (key: PeriodKey) => monthLabel(key).split(" ")[0];
/** The bank or wallet behind an account: its provider for banks and "other", else the wallet's name. */
const providerText = (account: PaymentAccount) => account.type === "mobile_banking" || account.type === "other" ? account.provider : paymentAccountTypeLabel(account.type);

interface AccountsPageProps {
  onAdd: () => void;
  onEdit: (transaction: LedgerTransaction) => void;
  onDelete: (transaction: LedgerTransaction) => void;
}

export function AccountsPage({ onAdd, onEdit, onDelete }: AccountsPageProps) {
  const {
    profile,
    transactions,
    customCategories,
    paymentAccounts,
    reconciliations,
    transfers,
    savePaymentAccount,
    updatePaymentAccountBalance,
    setPaymentAccountShared,
    approveAccountReconciliation,
    resetAccountReconciliation,
    deletePaymentAccount,
    updatePaymentAccountTail,
    deleteTransfer,
  } = useLedger();
  const workspace = useContext(LedgerWorkspaceContext);
  // The same session unlock as the dashboard and Reports: no PIN shows balances, a PIN hides them until unlocked.
  const balancesShown = workspace ? workspace.balancesVisible : !profile.hasPin;
  const searchParams = useSearchParams();
  // /accounts?account=<id> opens that one account; without it the page is the overview.
  const detailId = searchParams.get("account");
  const detailAccount = detailId ? paymentAccounts.find((account) => account.id === detailId) ?? null : null;
  const [selectedAccountId, setSelectedAccountId] = useState(() => detailId && paymentAccounts.some((account) => account.id === detailId) ? detailId : paymentAccounts[0]?.id ?? "");
  const [detailCount, setDetailCount] = useState(30);
  const [accountType, setAccountType] = useState<PaymentAccountType>("mobile_banking");
  const [accountProvider, setAccountProvider] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [accountTail, setAccountTail] = useState("");
  const [editingTailId, setEditingTailId] = useState<string | null>(null);
  const [editingTail, setEditingTail] = useState("");
  const [accountBalance, setAccountBalance] = useState("");
  const [accountBalanceAsOf, setAccountBalanceAsOf] = useState(todayInput());
  const [accountShared, setAccountShared] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountAction, setAccountAction] = useState<string | null>(null);
  const [copiedImportId, setCopiedImportId] = useState<string | null>(null);
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  const [editingBalance, setEditingBalance] = useState("");
  const [editingBalanceAsOf, setEditingBalanceAsOf] = useState(todayInput());
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferAction, setTransferAction] = useState<string | null>(null);
  const ownAccounts = paymentAccounts.filter((account) => account.userId === profile.id);
  const hasCashAccount = ownAccounts.some(isCashAccount);
  const accountTypeOptions = PAYMENT_ACCOUNT_TYPES.map((item) => item.value === "cash" && hasCashAccount ? { ...item, label: "Cash in hand (already added)", disabled: true } : item);
  const today = todayInput();
  const period = workspace?.period ?? currentMonthKey(profile.calendarSystem);
  const overview = useMemo(() => compareMonthSpend(transactions, paymentAccounts, period, today), [transactions, paymentAccounts, period, today]);
  // Each account's largest expense in the month so far, for the "Biggest" line on its card.
  const biggestByBucket = useMemo(() => {
    const biggest = new Map<string, LedgerTransaction>();
    if (!overview.elapsedDays) return biggest;
    for (const transaction of transactions) {
      if (transaction.kind !== "expense" || !countsAsIncomeOrSpending(transaction) || transaction.occurredOn < overview.start || transaction.occurredOn > overview.through) continue;
      const bucket = spendBucket(transaction, paymentAccounts);
      const current = biggest.get(bucket);
      if (!current || transaction.amountMinor > current.amountMinor) biggest.set(bucket, transaction);
    }
    return biggest;
  }, [overview, paymentAccounts, transactions]);
  const detail = useMemo(() => detailAccount ? accountMonthDetail(transactions, paymentAccounts, detailAccount.id, period, today) : null, [detailAccount, paymentAccounts, period, today, transactions]);
  const [reconciliationMonth, setReconciliationMonth] = useState(today.slice(0, 7));
  const [reconciliationCheckedOn, setReconciliationCheckedOn] = useState(today);
  const [reconciliationActual, setReconciliationActual] = useState("");
  const [reconciliationNote, setReconciliationNote] = useState("");
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [resetAccount, setResetAccount] = useState<typeof paymentAccounts[number] | null>(null);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!paymentAccounts.some((account) => account.id === selectedAccountId)) {
      setSelectedAccountId(paymentAccounts[0]?.id ?? "");
    }
  }, [paymentAccounts, selectedAccountId]);

  useEffect(() => {
    if (detailAccount && detailAccount.id !== selectedAccountId) {
      setSelectedAccountId(detailAccount.id);
      setDetailCount(30);
      setReconciliationActual(""); setReconciliationNote(""); setReconciliationError(null);
    }
  }, [detailAccount, selectedAccountId]);
  const selectedAccount = paymentAccounts.find((account) => account.id === selectedAccountId) ?? null;

  const copyImportId = async (importId: string) => {
    try {
      await navigator.clipboard.writeText(importId);
      setCopiedImportId(importId);
      window.setTimeout(() => setCopiedImportId((current) => current === importId ? null : current), 2_000);
    } catch {
      setAccountError("Could not copy the CSV import ID. Select and copy it manually.");
    }
  };
  // Cash in hand has no entries of its own: it collects its owner's cash entries.
  const selectedIsCash = Boolean(selectedAccount && isCashAccount(selectedAccount));
  const accountTransactions = useMemo(
    () => selectedAccount ? transactions.filter((transaction) => transactionPostsTo(transaction, selectedAccount)) : [],
    [selectedAccount, transactions],
  );
  const accountEntries = useMemo(
    () => selectedAccountId ? listLedgerActivity(selectedIsCash ? accountTransactions : transactions, selectedIsCash ? transfers.filter((transfer) => transfer.fromAccountId === selectedAccountId || transfer.toAccountId === selectedAccountId) : transfers, paymentAccounts, customCategories, {
      scope: "history", selectedDayKey: today, kind: "all", category: "all", from: "", to: "", minMinor: null, maxMinor: null, paymentMode: "all", query: "", accountId: selectedIsCash ? undefined : selectedAccountId,
    }) : [],
    [accountTransactions, customCategories, paymentAccounts, selectedAccountId, selectedIsCash, today, transactions, transfers],
  );
  const detailDays = useMemo(() => takeWholeDays(groupLedgerActivityByDay(accountEntries), detailCount), [accountEntries, detailCount]);
  const selectedReconciliations = reconciliations.filter((item) => item.paymentAccountId === selectedAccountId);
  const existingReconciliation = selectedReconciliations.find((item) => item.monthKey === reconciliationMonth) ?? null;
  const latestReconciliation = selectedReconciliations[0] ?? null;
  const postReconciliationActivity = latestReconciliation?.id === existingReconciliation?.id && selectedAccount
    ? accountActivityThrough(selectedAccount, transactions, transfers)
    : null;
  const reconciliationPreview = selectedAccount && reconciliationCheckedOn >= selectedAccount.balanceAsOf
    ? expectedAccountBalanceThrough(selectedAccount, transactions, transfers, reconciliationCheckedOn)
    : null;
  const spendingGap = selectedAccount && reconciliationPreview
    ? reconciliationSpendingGap(selectedAccount, transactions, transfers, reconciliationMonth, reconciliationCheckedOn)
    : null;
  const actualMinor = reconciliationActual.trim() ? majorToMinor(reconciliationActual) : null;
  const adjustmentMinor = actualMinor !== null && reconciliationPreview ? actualMinor - reconciliationPreview.expectedBalanceMinor : null;
  const monthEnd = (monthKey: string) => {
    const [year, month] = monthKey.split("-").map(Number);
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  };
  const maximumCheckedOn = reconciliationMonth === today.slice(0, 7) ? today : monthEnd(reconciliationMonth);
  const reconciliationDateInvalid = !selectedAccount
    || !reconciliationCheckedOn.startsWith(`${reconciliationMonth}-`)
    || reconciliationCheckedOn > today
    || reconciliationCheckedOn < selectedAccount.balanceAsOf;

  const addPaymentAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (accountAction) return;
    const isCash = accountType === "cash";
    if (isCash && hasCashAccount) { setAccountError("You already track Cash in hand."); return; }
    const provider = providerForAccountType(accountType, accountProvider);
    const providerError = paymentAccountProviderError(accountType, provider);
    if (providerError) { setAccountError(providerError); return; }
    const tail = isCash ? null : normalizeAccountTail(accountTail);
    if (!isCash && accountTail.trim() && !tail) { setAccountError("Enter the last 3 or 4 digits of the account number, or leave it empty."); return; }
    setAccountAction("add");
    try {
      setAccountError(null);
      await savePaymentAccount({ type: accountType, provider, label: isCash ? "" : accountLabel, accountTail: tail, balance: accountBalance || "0", balanceAsOf: accountBalanceAsOf, shared: isCash ? false : accountShared });
      if (isCash) setAccountType("mobile_banking");
      setAccountProvider("");
      setAccountLabel("");
      setAccountTail("");
      setAccountBalance("");
      setAccountBalanceAsOf(todayInput());
      setAccountShared(false);
    } catch (caught) {
      setAccountError(caught instanceof Error ? caught.message : "Could not add the account.");
    } finally {
      setAccountAction(null);
    }
  };
  const shareAccount = async (id: string, shared: boolean) => {
    if (accountAction) return;
    setAccountAction(id);
    try { setAccountError(null); await setPaymentAccountShared(id, shared); }
    catch (caught) { setAccountError(caught instanceof Error ? caught.message : "Could not update sharing."); }
    finally { setAccountAction(null); }
  };
  const beginBalanceEdit = (account: typeof paymentAccounts[number]) => {
    // The form opens prefilled with the balance, so it needs balances unlocked first.
    if (!balancesShown) { workspace?.requestBalanceUnlock(); return; }
    setEditingBalanceId(account.id);
    setEditingBalance(String(account.currentBalanceMinor / 100));
    // A cash count is what is in your wallet right now.
    setEditingBalanceAsOf(isCashAccount(account) ? todayInput() : account.balanceAsOf);
    setAccountError(null);
  };
  const beginTailEdit = (account: PaymentAccount) => {
    setEditingTailId(account.id);
    setEditingTail(account.accountTail ?? "");
    setAccountError(null);
  };
  const saveTail = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingTailId || accountAction) return;
    const tail = normalizeAccountTail(editingTail);
    if (editingTail.trim() && !tail) { setAccountError("Enter the last 3 or 4 digits of the account number, or leave it empty."); return; }
    setAccountAction(editingTailId);
    try {
      setAccountError(null);
      await updatePaymentAccountTail(editingTailId, tail);
      setEditingTailId(null);
    } catch (caught) {
      setAccountError(caught instanceof Error ? caught.message : "Could not save the account's last digits.");
    } finally {
      setAccountAction(null);
    }
  };
  /** Says what removing an account does to the rest of the ledger, so nothing changes silently. */
  const removalSummary = (account: PaymentAccount) => {
    const effects = transferRemovalEffects(account.id, paymentAccounts, transfers);
    const transferCount = effects.reduce((sum, effect) => sum + effect.transferCount, 0);
    const onlineCount = transactions.filter((transaction) => transaction.paymentAccountId === account.id).length;
    const amountsHidden = typeof document !== "undefined" && document.body.dataset.hideAmounts === "true";
    const lines = [`Remove ${paymentAccountLabel(account)}?`];
    if (transferCount) {
      lines.push(`Its ${transferCount} transfer${transferCount === 1 ? "" : "s"} with your other accounts will be removed too, which changes ${effects.length === 1 ? "that account's" : "those accounts'"} balance:`);
      for (const effect of effects) {
        const other = paymentAccounts.find((item) => item.id === effect.accountId);
        const change = effect.changeMinor === 0 ? (effect.countedCount ? "no change (money in and out cancels out)" : "no change (those transfers are older than its last checked balance)") : amountsHidden ? (effect.changeMinor > 0 ? "goes up" : "goes down") : `${effect.changeMinor > 0 ? "+" : "−"}${formatMoney(Math.abs(effect.changeMinor), profile.currency)}`;
        lines.push(`• ${other ? paymentAccountLabel(other) : "Another account"}: ${change}`);
      }
    }
    if (onlineCount) lines.push(`${onlineCount} ${onlineCount === 1 ? "entry" : "entries"} paid through it will become cash entries, so you can still edit them.`);
    else if (isCashAccount(account)) lines.push("Your cash entries stay as they are.");
    return { message: lines.join("\n"), removeTransfers: transferCount > 0 };
  };
  const saveBalance = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingBalanceId || accountAction) return;
    setAccountAction(editingBalanceId);
    try {
      setAccountError(null);
      await updatePaymentAccountBalance(editingBalanceId, editingBalance, editingBalanceAsOf);
      setEditingBalanceId(null);
    } catch (caught) {
      setAccountError(caught instanceof Error ? caught.message : "Could not update the account balance.");
    } finally {
      setAccountAction(null);
    }
  };
  const removePaymentAccount = async (account: PaymentAccount) => {
    if (accountAction) return;
    const { message, removeTransfers } = removalSummary(account);
    if (!window.confirm(message)) return;
    const id = account.id;
    setAccountAction(id);
    try {
      setAccountError(null);
      await deletePaymentAccount(id, { removeTransfers });
    } catch (caught) {
      setAccountError(caught instanceof Error ? caught.message : "Could not remove the account.");
    } finally {
      setAccountAction(null);
    }
  };
  const closeReset = () => {
    if (resetting) return;
    setResetAccount(null);
    setResetConfirmation("");
    setResetError(null);
  };
  const resetAuditHistory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resetAccount || resetting || resetConfirmation !== "RESET") return;
    setResetting(true);
    try {
      setResetError(null);
      await resetAccountReconciliation(resetAccount.id);
      setResetAccount(null);
      setResetConfirmation("");
    } catch (caught) {
      setResetError(caught instanceof Error ? caught.message : "Could not reset this account's reconciliation history.");
    } finally {
      setResetting(false);
    }
  };
  const approveReconciliation = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedAccount || !reconciliationPreview || actualMinor === null || adjustmentMinor === null || reconciliationDateInvalid || existingReconciliation || reconciling) return;
    if (adjustmentMinor !== 0 && !reconciliationNote.trim()) {
      setReconciliationError("Explain the difference before approving this reconciliation.");
      return;
    }
    if (!window.confirm(`Approve ${reconciliationMonth} for ${paymentAccountLabel(selectedAccount)}? This creates a locked audit record.`)) return;
    setReconciling(true);
    try {
      setReconciliationError(null);
      await approveAccountReconciliation(selectedAccount.id, reconciliationMonth, reconciliationCheckedOn, reconciliationActual, reconciliationNote);
      setReconciliationActual("");
      setReconciliationNote("");
    } catch (caught) {
      setReconciliationError(caught instanceof Error ? caught.message : "Could not approve this reconciliation.");
    } finally {
      setReconciling(false);
    }
  };
  const removeTransfer = async (id: string) => {
    if (transferAction || !window.confirm("Delete this transfer? Account balances will be recalculated.")) return;
    setTransferAction(id);
    try {
      setTransferError(null);
      await deleteTransfer(id);
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : "Could not delete the transfer.");
    } finally {
      setTransferAction(null);
    }
  };

  const manageSection = <>
    <div className="accounts-management-grid">
      <section className="settings-panel" id="add-account"><div className="settings-title"><span className="settings-icon"><Bank size={23} /></span><div><h2>Add and manage accounts</h2><p>Enter the real balance currently shown by your bank or wallet. Create this account before importing its past online transactions.</p></div></div>
        {profile.hasPin ? <form className="settings-form" onSubmit={addPaymentAccount} aria-busy={accountAction === "add"}>
          <Select label="Account type" value={accountType} onChange={(value) => { if (!value) return; setAccountType(value as PaymentAccountType); setAccountProvider(""); setAccountError(null); }} data={accountTypeOptions} allowDeselect={false} disabled={Boolean(accountAction)} />
          {accountType === "mobile_banking" && <Select label="Bank" placeholder="Search Nepal banks" value={accountProvider || null} onChange={(value) => setAccountProvider(value ?? "")} data={NEPAL_MOBILE_BANKS.map((bank) => ({ value: bank, label: bank }))} searchable required disabled={Boolean(accountAction)} />}
          {accountType === "other" && <TextInput label="Provider" description="The co-op, finance company or card, as it appears in its messages." placeholder="e.g. Sahara Saving and Credit Co-op" value={accountProvider} onChange={(event) => setAccountProvider(event.currentTarget.value)} maxLength={100} required disabled={Boolean(accountAction)} />}
          {accountType === "cash" && <p className="field-hint account-cash-hint">Cash in hand keeps a running count of the money in your wallet. Your cash entries and ATM withdrawals moved into it change its balance.</p>}
          {accountType !== "cash" && <TextInput label="Nickname" description="Optional — useful if you have more than one account." placeholder={accountType === "mobile_banking" ? "e.g. Salary account" : "e.g. Personal wallet"} value={accountLabel} onChange={(event) => setAccountLabel(event.target.value)} maxLength={60} disabled={Boolean(accountAction)} />}
          {accountType !== "cash" && <TextInput label="Last 4 digits (as shown in your SMS)" description="Optional. Lets a pasted bank SMS find this account, even with two accounts at one bank." placeholder="e.g. 4821" inputMode="numeric" autoComplete="off" value={accountTail} onChange={(event) => setAccountTail(event.currentTarget.value.replace(/\D/g, "").slice(0, 4))} maxLength={4} disabled={Boolean(accountAction)} />}
          <NumberInput label={accountType === "cash" ? "Cash you have now" : "Balance today"} description={accountType === "cash" ? "Count the notes in your wallet." : "Use the balance currently shown by your bank or wallet."} value={accountBalance} onChange={(value) => setAccountBalance(String(value))} decimalScale={2} thousandSeparator="," disabled={Boolean(accountAction)} />
          <TextInput label={accountType === "cash" ? "Counted on" : "Balance as of"} type="date" leftSection={<CalendarBlank size={16} aria-hidden />} value={accountBalanceAsOf} onChange={(event) => setAccountBalanceAsOf(event.currentTarget.value)} required disabled={Boolean(accountAction)} />
          {profile.household?.status === "active" && accountType !== "cash" && <Switch label="Share with household" description="Your partner can see this balance and post Ours entries to it." checked={accountShared} onChange={(event) => setAccountShared(event.currentTarget.checked)} disabled={Boolean(accountAction)} />}
          <FormError message={accountError} />
          <button className="primary-button" disabled={Boolean(accountAction) || (accountType === "mobile_banking" && !accountProvider) || (accountType === "other" && accountProvider.trim().length < 2) || (accountType === "cash" && hasCashAccount)}>{accountAction === "add" ? <><ButtonSpinner />Adding…</> : <><Plus size={17} />{accountType === "cash" ? "Add Cash in hand" : "Add account"}</>}</button>
        </form> : <div className="account-pin-required"><span><LockKey size={21} weight="duotone" /></span><div><strong>PIN required to add an account</strong><p>Set up a 4–6 digit ledger PIN in Profile first. It keeps your balances hidden on every page until you unlock them.</p></div><Link className="primary-button" href="/profile#security-heading">Go to PIN setup</Link></div>}
        <div className="payment-account-list">{paymentAccounts.map((account) => {
          const hasAuditHistory = reconciliations.some((item) => item.paymentAccountId === account.id);
          const isCash = isCashAccount(account);
          return <div key={account.id} className="payment-account-item" aria-busy={accountAction === account.id}><div className="payment-account-summary"><span><b className="payment-account-name">{paymentAccountLabel(account)}{account.shared ? <span className="ours-chip">Shared</span> : null}</b><small>{balancesShown ? <span className="payment-account-money">{formatMoney(account.currentBalanceMinor, profile.currency)}</span> : <HiddenBalance />} · {isCash ? "counted" : "checked"} {formatLedgerDate(account.balanceAsOf, profile.calendarSystem)}{account.accountTail ? ` · ends ${account.accountTail}` : ""}</small>{!isCash && <span className="account-import-id"><span>Use this ID in CSV imports</span><code>{account.importId}</code><button type="button" onClick={() => void copyImportId(account.importId)} aria-label={`Copy CSV import ID for ${paymentAccountLabel(account)}`}>{copiedImportId === account.importId ? <Check size={13} /> : <Copy size={13} />}{copiedImportId === account.importId ? "Copied" : "Copy"}</button></span>}</span><div className="payment-account-actions">{account.userId !== profile.id ? <small>Shared with you</small> : <>{profile.household?.status === "active" && !isCash && <Switch label="Share" checked={account.shared === true} disabled={Boolean(accountAction)} onChange={(event) => void shareAccount(account.id, event.currentTarget.checked)} />}{!isCash && <button type="button" className="text-button" disabled={Boolean(accountAction)} onClick={() => beginTailEdit(account)} aria-label={`Edit the last digits for ${paymentAccountLabel(account)}`}><PencilSimple size={14} />{account.accountTail ? "Last digits" : "Add last digits"}</button>}{hasAuditHistory ? <><small className="account-audit-managed"><ShieldCheck size={14} />Reconciled</small><button type="button" className="text-button danger-text" disabled={Boolean(accountAction)} onClick={() => { setResetAccount(account); setResetError(null); }}><ArrowCounterClockwise size={15} />Reset audit history</button></> : <button type="button" className="text-button" disabled={Boolean(accountAction)} onClick={() => beginBalanceEdit(account)}>{isCash ? "Update cash count" : "Correct opening balance"}</button>}<button type="button" className="icon-button danger" disabled={Boolean(accountAction) || hasAuditHistory} title={hasAuditHistory ? "Reset this account's audit history before removing it." : undefined} onClick={() => void removePaymentAccount(account)} aria-label={`Remove ${paymentAccountLabel(account)}`}>{accountAction === account.id ? <ButtonSpinner /> : <Trash size={16} />}</button></>}</div></div>{editingTailId === account.id && !isCash && <form className="account-balance-form account-tail-form" onSubmit={saveTail}><TextInput label="Last 4 digits (as shown in your SMS)" description="Leave empty to match this account by its bank or wallet name only." placeholder="e.g. 4821" inputMode="numeric" autoComplete="off" value={editingTail} onChange={(event) => setEditingTail(event.currentTarget.value.replace(/\D/g, "").slice(0, 4))} maxLength={4} disabled={Boolean(accountAction)} /><div className="inline-actions"><button type="button" className="secondary-button" onClick={() => setEditingTailId(null)} disabled={Boolean(accountAction)}>Cancel</button><button className="primary-button" disabled={Boolean(accountAction)}>{accountAction === account.id ? <><ButtonSpinner />Saving…</> : "Save last digits"}</button></div></form>}{editingBalanceId === account.id && !hasAuditHistory && <form className="account-balance-form" onSubmit={saveBalance}><NumberInput label={isCash ? "Cash you have now" : "Opening balance"} value={editingBalance} onChange={(value) => setEditingBalance(String(value))} decimalScale={2} thousandSeparator="," required disabled={Boolean(accountAction)} /><TextInput label={isCash ? "Counted on" : "Balance as of"} type="date" leftSection={<CalendarBlank size={16} aria-hidden />} value={editingBalanceAsOf} onChange={(event) => setEditingBalanceAsOf(event.currentTarget.value)} required disabled={Boolean(accountAction)} /><div className="inline-actions"><button type="button" className="secondary-button" onClick={() => setEditingBalanceId(null)} disabled={Boolean(accountAction)}>Cancel</button><button className="primary-button" disabled={Boolean(accountAction)}>{accountAction === account.id ? <><ButtonSpinner />Saving…</> : isCash ? "Save cash count" : "Save opening balance"}</button></div></form>}</div>;
        })}{!paymentAccounts.length && <p>No tracked accounts yet.</p>}</div>
      </section>


    </div>

  </>;
  const reconciliationSection = <>
    <section className="account-reconciliation-section" aria-labelledby="account-reconciliation-title">
      <div className="section-heading reconciliation-heading">
        <div><span className="section-label">Optional account check</span><h2 id="account-reconciliation-title">Reconcile an account</h2><p>This compares one account with the balance shown by your bank or wallet, then locks the result. The month names the check. The figures run from the last confirmed balance through the date you check.</p></div>
        <Scales size={25} weight="duotone" />
      </div>

      {paymentAccounts.length > 0 && !balancesShown ? <BalanceLocked title="Reconciliation is hidden" detail="A reconciliation shows each account's expected and actual balance. Unlock balances with your ledger PIN to check one." /> : paymentAccounts.length > 0 ? <div className="reconciliation-layout">
        <article className="reconciliation-workspace">
          <div className="reconciliation-controls">
            {!detailAccount && <Select label="Account" value={selectedAccountId} onChange={(value) => { setSelectedAccountId(value ?? ""); setReconciliationActual(""); setReconciliationNote(""); setReconciliationError(null); }} data={paymentAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} allowDeselect={false} />}
            <TextInput label="Month" type="month" value={reconciliationMonth} max={today.slice(0, 7)} onChange={(event) => {
              const nextMonth = event.currentTarget.value;
              setReconciliationMonth(nextMonth);
              setReconciliationCheckedOn(nextMonth === today.slice(0, 7) ? today : monthEnd(nextMonth));
              setReconciliationActual("");
              setReconciliationNote("");
              setReconciliationError(null);
            }} />
          </div>

          {selectedIsCash ? <p className="plan-empty-copy">Cash in hand is not reconciled monthly, because cash entries are not locked to an account. Count your cash and use “Update cash count” above instead.</p> : selectedAccount && selectedAccount.userId !== profile.id ? <p className="plan-empty-copy">This account is shared with you. The person who added it checks it against their statement.</p> : existingReconciliation ?<div className="reconciliation-approved">
            <div className="reconciliation-approved-title"><span><CheckCircle size={22} weight="fill" /></span><div><strong>Approved and locked</strong><small>Checked {existingReconciliation.checkedOn} · approved {new Date(existingReconciliation.approvedAt).toLocaleString()}</small></div></div>
            <div className="reconciliation-period-copy"><span>Activity after {existingReconciliation.startingBalanceAsOf} through {existingReconciliation.checkedOn}</span><small>The expense line is activity on this account across that span. Transfers stay on their own lines because they move money between your accounts. {reconciliationMonthLabel(existingReconciliation.monthKey)} spending elsewhere in the app also counts cash, cheque, and your other accounts.</small></div>
            <div className="reconciliation-calculation">
              <div><span>Starting balance on {existingReconciliation.startingBalanceAsOf}</span><strong>{formatMoney(existingReconciliation.startingBalanceMinor, profile.currency)}</strong></div>
              <div><span>Account income</span><strong className="positive">+{formatMoney(existingReconciliation.incomeMinor, profile.currency)}</strong></div>
              <div><span>Account expenses</span><strong className="negative">−{formatMoney(existingReconciliation.expenseMinor, profile.currency)}</strong></div>
              <div><span>Transfers in</span><strong>+{formatMoney(existingReconciliation.transfersInMinor, profile.currency)}</strong></div>
              <div><span>Transfers out</span><strong>−{formatMoney(existingReconciliation.transfersOutMinor, profile.currency)}</strong></div>
              <div className="reconciliation-total"><span>Expected balance</span><strong>{formatMoney(existingReconciliation.expectedBalanceMinor, profile.currency)}</strong></div>
              <div><span>Actual balance</span><strong>{formatMoney(existingReconciliation.actualBalanceMinor, profile.currency)}</strong></div>
              <div className="reconciliation-total"><span>Adjustment</span><strong>{formatMoney(existingReconciliation.adjustmentMinor, profile.currency)}</strong></div>
            </div>
            {postReconciliationActivity && <div>
              <div className="reconciliation-period-copy"><span>Activity after this reconciliation was approved</span><small>These account entries are not part of the locked audit above. They are included in the current tracked balance.</small></div>
              <div className="reconciliation-calculation">
                <div><span>New account income</span><strong className="positive">+{formatMoney(postReconciliationActivity.incomeMinor, profile.currency)}</strong></div>
                <div><span>New account expenses</span><strong className="negative">−{formatMoney(postReconciliationActivity.expenseMinor, profile.currency)}</strong></div>
                <div><span>New transfers in</span><strong>+{formatMoney(postReconciliationActivity.transfersInMinor, profile.currency)}</strong></div>
                <div><span>New transfers out</span><strong>−{formatMoney(postReconciliationActivity.transfersOutMinor, profile.currency)}</strong></div>
                <div className="reconciliation-total"><span>Current tracked balance</span><strong>{formatMoney(selectedAccount?.currentBalanceMinor ?? 0, profile.currency)}</strong></div>
              </div>
            </div>}
            {existingReconciliation.adjustmentNote && <p className="reconciliation-note"><strong>Explanation:</strong> {existingReconciliation.adjustmentNote}</p>}
          </div> : reconciliationDateInvalid || !reconciliationPreview ? <div className="reconciliation-unavailable">
            <CalendarBlank size={22} />
            <div><strong>This period cannot be reconciled</strong><p>{selectedAccount && reconciliationCheckedOn < selectedAccount.balanceAsOf ? `The account balance is already checked through ${selectedAccount.balanceAsOf}. Choose that month or a later one.` : "Choose a valid account, month, and date that is not in the future."}</p></div>
          </div> : <form className="reconciliation-form" onSubmit={approveReconciliation} aria-busy={reconciling}>
            <div className="reconciliation-period-copy"><span>Balance for {selectedAccount ? paymentAccountLabel(selectedAccount) : "this account"} after {selectedAccount?.balanceAsOf} through {reconciliationCheckedOn}</span><small>{reconciliationMonthLabel(reconciliationMonth)} spending through {reconciliationCheckedOn} is {formatMoney(spendingGap?.monthExpenseMinor ?? 0, profile.currency)}. The expense line in this check is {formatMoney(reconciliationPreview.expenseMinor, profile.currency)}: activity on this account after its confirmed balance.</small></div>
            <TextInput label="Balance checked on" type="date" value={reconciliationCheckedOn} min={`${reconciliationMonth}-01`} max={maximumCheckedOn} onChange={(event) => { setReconciliationCheckedOn(event.currentTarget.value); setReconciliationError(null); }} required disabled={reconciling} />
            <div className="reconciliation-calculation">
              <div><span>Confirmed starting balance on {selectedAccount?.balanceAsOf}</span><strong>{formatMoney(selectedAccount?.balanceMinor ?? 0, profile.currency)}</strong></div>
              {spendingGap && activityHasMovement(spendingGap.beforeMonth) ? <>
                <div className="reconciliation-group">After {selectedAccount?.balanceAsOf}, before {reconciliationMonthLabel(reconciliationMonth)}</div>
                <MovementRows activity={spendingGap.beforeMonth} currency={profile.currency} />
                <div className="reconciliation-group">{reconciliationMonthLabel(reconciliationMonth)} through {reconciliationCheckedOn}</div>
                <MovementRows activity={spendingGap.duringMonth} currency={profile.currency} />
              </> : <>
                <div><span>Income added</span><strong className="positive">+{formatMoney(reconciliationPreview.incomeMinor, profile.currency)}</strong></div>
                <div><span>Expenses deducted</span><strong className="negative">−{formatMoney(reconciliationPreview.expenseMinor, profile.currency)}</strong></div>
                <div><span>Transfers in</span><strong>+{formatMoney(reconciliationPreview.transfersInMinor, profile.currency)}</strong></div>
                <div><span>Transfers out</span><strong>−{formatMoney(reconciliationPreview.transfersOutMinor, profile.currency)}</strong></div>
              </>}
              <div className="reconciliation-total"><span>Expected closing balance</span><strong>{formatMoney(reconciliationPreview.expectedBalanceMinor, profile.currency)}</strong></div>
            </div>
            {spendingGap && <ReconciliationGap gap={spendingGap} currency={profile.currency} transfersInMinor={reconciliationPreview.transfersInMinor} transfersOutMinor={reconciliationPreview.transfersOutMinor} balanceAsOf={selectedAccount?.balanceAsOf ?? ""} monthLabel={reconciliationMonthLabel(reconciliationMonth)} />}
            <NumberInput label={`Balance shown by bank or wallet (${profile.currency})`} description="Enter this manually from the provider's app or statement." value={reconciliationActual} onChange={(value) => { setReconciliationActual(String(value)); setReconciliationError(null); }} decimalScale={2} thousandSeparator="," required disabled={reconciling} />
            {adjustmentMinor !== null && <div className={`reconciliation-difference ${adjustmentMinor === 0 ? "matched" : "different"}`}>
              <span>{adjustmentMinor === 0 ? <CheckCircle size={20} weight="fill" /> : <Scales size={20} />}</span>
              <div><strong>{adjustmentMinor === 0 ? "Balances match exactly" : `${formatMoney(Math.abs(adjustmentMinor), profile.currency)} ${adjustmentMinor > 0 ? "more" : "less"} than expected`}</strong><small>{adjustmentMinor === 0 ? "No adjustment will be applied." : "Add missing entries first when possible. If the difference remains, explain it below."}</small></div>
            </div>}
            {adjustmentMinor !== null && adjustmentMinor !== 0 && <TextInput label="Difference explanation" description="Required for the permanent audit record." placeholder="Bank fee, interest, missing historical entry…" value={reconciliationNote} onChange={(event) => setReconciliationNote(event.currentTarget.value)} maxLength={300} required disabled={reconciling} />}
            <FormError message={reconciliationError} />
            <button className="primary-button reconciliation-approve" disabled={reconciling || actualMinor === null || adjustmentMinor === null || (adjustmentMinor !== 0 && !reconciliationNote.trim())}>{reconciling ? <><ButtonSpinner />Approving…</> : <><ShieldCheck size={18} />Approve and update account</>}</button>
          </form>}
        </article>

        <aside className="reconciliation-history">
          <div><span className="section-label">Audit history</span><h3>{selectedAccount ? paymentAccountLabel(selectedAccount) : "Selected account"}</h3></div>
          {selectedReconciliations.map((item) => <article key={item.id}>
            <span className="reconciliation-history-status"><CheckCircle size={16} weight="fill" />{new Date(`${item.monthKey}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
            <strong>{formatMoney(item.actualBalanceMinor, profile.currency)}</strong>
            <small>Expected {formatMoney(item.expectedBalanceMinor, profile.currency)} · adjustment {formatMoney(item.adjustmentMinor, profile.currency)}</small>
            <time dateTime={item.approvedAt}>Approved {new Date(item.approvedAt).toLocaleDateString()}</time>
          </article>)}
          {!selectedReconciliations.length && <div className="reconciliation-history-empty"><ShieldCheck size={24} /><p>No approved reconciliations yet. The first one will create this account’s permanent audit trail.</p></div>}
        </aside>
      </div> : <EmptyState title="Add an account before reconciling" message="Reconciliation compares one tracked bank or wallet at a time." />}
    </section>

  </>;
  const resetModal = <>
    <Modal opened={Boolean(resetAccount)} onClose={closeReset} centered closeOnClickOutside={!resetting} closeOnEscape={!resetting} withCloseButton={!resetting} overlayProps={{ backgroundOpacity: .55, blur: 5 }} title="Reset reconciliation history?">
      <p className="delete-account-warning">This removes every approved reconciliation for <strong>{resetAccount ? paymentAccountLabel(resetAccount) : "this account"}</strong> and restores its earliest opening balance snapshot. Transactions and transfers are preserved. This cannot be undone.</p>
      <form className="delete-account-form" onSubmit={resetAuditHistory} aria-busy={resetting}>
        <TextInput label="Type RESET to confirm" value={resetConfirmation} onChange={(event) => setResetConfirmation(event.currentTarget.value)} autoComplete="off" required disabled={resetting} />
        <FormError message={resetError} />
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={closeReset} disabled={resetting}>Cancel</button><button type="submit" className="delete-account-button" disabled={resetting || resetConfirmation !== "RESET"}>{resetting ? <><ButtonSpinner />Resetting…</> : <><ArrowCounterClockwise size={17} />Reset audit history</>}</button></div>
      </form>
    </Modal>
  </>;

  const balanceText = (account: PaymentAccount) => balancesShown ? formatMoney(account.currentBalanceMinor, profile.currency) : null;
  const checkedText = (account: PaymentAccount) => `${isCashAccount(account) ? "Counted" : "Checked"} ${formatLedgerDate(account.balanceAsOf, profile.calendarSystem)}`;
  const unlockButton = <button type="button" className="v2-link" onClick={() => workspace?.requestBalanceUnlock()}>Unlock to see</button>;
  const percentText = (current: number, previous: number) => previous > 0 ? `${current >= previous ? "▲" : "▼"} ${Math.round(Math.abs(current - previous) / previous * 100)}%` : current > 0 ? "New" : "—";
  const deltaClass = (current: number, previous: number) => current === previous ? "is-flat" : current > previous ? "is-up" : "is-down";

  if (detailAccount && detail) {
    const { tone } = accountLook(detailAccount);
    const { row, weeks, categories: spendByCategory, biggest, comparison: monthly } = detail;
    const weekPeak = Math.max(1, ...weeks.map((week) => Math.max(week.currentMinor, week.previousMinor)));
    const categoryTotal = spendByCategory.reduce((total, item) => total + item.currentMinor, 0) || 1;
    const hasAudit = reconciliations.some((item) => item.paymentAccountId === detailAccount.id);
    const own = detailAccount.userId === profile.id;
    const diff = row.currentMinor - row.previousMinor;
    return <div className="v2-page v2-account-detail">
      <Link href={appRoutes.accounts} className="v2-back"><CaretLeft size={16} weight="bold" />All accounts</Link>
      <header className="v2-page-head">
        <div className="v2-account-title"><AccountTile account={detailAccount} size={52} /><div><span className="v2-eyebrow">{providerText(detailAccount)}{detailAccount.accountTail ? ` · ends ${detailAccount.accountTail}` : ""}</span><h1>{detailAccount.label || paymentAccountLabel(detailAccount)}</h1></div></div>
        <div className="v2-head-actions">
          {own && ownAccounts.length > 1 && workspace && <button type="button" className="v2-button is-compact" onClick={() => workspace.openTransfer({ fromAccountId: detailAccount.id })} aria-label="Move money from this account"><ArrowsLeftRight size={18} /><span>Move money</span></button>}
          {own && !hasAudit && <button type="button" className="v2-button is-primary" onClick={() => { beginBalanceEdit(detailAccount); window.setTimeout(() => document.getElementById("v2-balance-card")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0); }}>{isCashAccount(detailAccount) ? "Count cash" : "Update balance"}</button>}
        </div>
      </header>

      <div className="v2-detail-grid">
        <div className="v2-detail-main">
          <section className="v2-hero" style={{ background: tone.ink }} aria-labelledby="v2-account-spent">
            <span id="v2-account-spent" className="v2-hero-label">Spent from {detailAccount.label || paymentAccountLabel(detailAccount)} · {monthName(period)} 1–{Math.max(monthly.elapsedDays, 1)}</span>
            <strong className="v2-hero-amount amount">{formatMoney(row.currentMinor, profile.currency)}</strong>
            <span className="v2-hero-pill">{diff === 0 ? `Same as ${monthName(addMonthsToKey(period, -1))}` : `${diff > 0 ? "▲" : "▼"} ${formatMoney(Math.abs(diff), profile.currency)} ${diff > 0 ? "more" : "less"} than ${monthName(addMonthsToKey(period, -1))} 1–${Math.max(monthly.elapsedDays, 1)}`}</span>
            <div className="v2-weeks" role="img" aria-label={`Spending by week: ${weeks.map((week) => `days ${week.firstDay}–${week.lastDay}, ${plainAmount(week.currentMinor)} this month against ${plainAmount(week.previousMinor)} last month`).join("; ")}`}>
              {weeks.map((week) => <div key={week.firstDay} className={week.started ? "v2-week" : "v2-week is-later"}>
                <div className="v2-week-bars">
                  <span className="is-previous" style={{ height: `${(week.previousMinor / weekPeak) * 100}%` }} />
                  {week.started && <span className="is-current" style={{ height: `${(week.currentMinor / weekPeak) * 100}%` }} />}
                </div>
                <span className="v2-week-label">{monthName(period).slice(0, 3)} {week.firstDay}–{week.lastDay}</span>
                <span className="v2-week-amount amount">{week.started ? plainAmount(week.currentMinor) : "Later"}</span>
              </div>)}
            </div>
            <div className="v2-chart-legend"><span className="v2-chart-keys"><span><i className="is-current" />{monthName(period)}</span><span><i className="is-previous-bar" />{monthName(addMonthsToKey(period, -1))}</span></span></div>
          </section>

          <section className="v2-card" aria-labelledby="v2-where">
            <header className="v2-card-head"><h2 id="v2-where">Where it went</h2></header>
            {spendByCategory.length === 0 ? <p className="v2-empty">Nothing spent from this account in {monthName(period)} yet.</p> : <ul className="v2-rows">
              {spendByCategory.map((item) => {
                const share = Math.round(item.currentMinor / categoryTotal * 100);
                const look = categoryTone(item.category, customCategories);
                return <li key={item.category} className="v2-row">
                  <CategoryTile category={item.category} custom={customCategories} />
                  <span className="v2-row-main"><strong>{getCategory(item.category, customCategories).label}</strong><span className="v2-progress"><span style={{ width: `${share}%`, background: look.ink }} /></span></span>
                  <span className="v2-row-end"><strong className="amount">{plainAmount(item.currentMinor)}</strong><small className="v2-muted">{share}%</small></span>
                </li>;
              })}
            </ul>}
            {biggest && <p className="v2-footnote">Biggest: {biggest.note || getCategory(biggest.category, customCategories).label}, {plainAmount(biggest.amountMinor)} on {formatLedgerDate(biggest.occurredOn, profile.calendarSystem)}</p>}
          </section>
        </div>

        <div className="v2-detail-side">
          <section className="v2-card v2-balance-card" id="v2-balance-card" aria-labelledby="v2-balance-title">
            <header className="v2-card-head"><h2 id="v2-balance-title">{isCashAccount(detailAccount) ? "Cash in hand" : "Balance"}</h2>{hasAudit && <span className="v2-badge"><ShieldCheck size={14} />Reconciled</span>}</header>
            <strong className="v2-balance amount">{balanceText(detailAccount) ?? <HiddenBalance />}</strong>
            <p className="v2-muted">{balancesShown ? `${checkedText(detailAccount)}, then kept up to date from your entries.` : unlockButton}</p>
            {editingBalanceId === detailAccount.id && !hasAudit && <form className="v2-inline-form" onSubmit={saveBalance}>
              <NumberInput label={isCashAccount(detailAccount) ? "Cash you have now" : "Balance shown by your bank or wallet"} value={editingBalance} onChange={(value) => setEditingBalance(String(value))} decimalScale={2} thousandSeparator="," required disabled={Boolean(accountAction)} />
              <TextInput label={isCashAccount(detailAccount) ? "Counted on" : "Balance as of"} type="date" value={editingBalanceAsOf} onChange={(event) => setEditingBalanceAsOf(event.currentTarget.value)} required disabled={Boolean(accountAction)} />
              <div className="v2-inline-actions"><button type="button" className="v2-button" onClick={() => setEditingBalanceId(null)} disabled={Boolean(accountAction)}>Cancel</button><button className="v2-button is-primary" disabled={Boolean(accountAction)}>{accountAction === detailAccount.id ? <><ButtonSpinner />Saving…</> : "Save"}</button></div>
            </form>}
            <FormError message={accountError} />
          </section>
        </div>
      </div>

      <section className="v2-tx-list" aria-label="Activity on this account">
        <header className="v2-section-head"><h2>Activity</h2><Link href={`${appRoutes.transactions}?account=${encodeURIComponent(detailAccount.id)}`}>Open in Transactions</Link></header>
        {detailDays.map((day) => <section key={day.dayKey} className="v2-card v2-tx-day" aria-label={formatLedgerDay(day.dayKey, profile.calendarSystem)}>
          <header className="v2-day-head"><span>{dayGroupLabel(day.dayKey, today)} · {formatLedgerDay(day.dayKey, profile.calendarSystem, "date")}</span></header>
          <ul className="v2-rows">{day.items.map((item) => <EntryRow key={activityKey(item)} item={item} accounts={paymentAccounts} customCategories={customCategories} selected={false} deletePending={item.type === "transfer" && transferAction === item.transfer.id} onOpen={(entry) => entry.type === "transfer" ? workspace?.openTransfer({ transferId: entry.transfer.id }) : (entry.transaction.userId === profile.id && onEdit(entry.transaction))} onEdit={onEdit} onDuplicate={(entry) => workspace?.openDuplicate(entry)} onDelete={onDelete} onDeleteTransfer={(transfer) => void removeTransfer(transfer.id)} />)}</ul>
        </section>)}
        {!accountEntries.length && <div className="v2-card v2-tx-empty"><EmptyState title="No activity yet" message={selectedIsCash ? "Cash entries and money moved into or out of your cash show here." : "Entries paid through this account, and transfers in or out of it, show here."} action={<button className="v2-button is-primary" onClick={onAdd}><Plus size={17} />Add entries</button>} /></div>}
        {detailDays.reduce((total, day) => total + day.items.length, 0) < accountEntries.length && <nav className="v2-load-more"><span>Showing {detailDays.reduce((total, day) => total + day.items.length, 0)} of {accountEntries.length}</span><button className="v2-button" onClick={() => setDetailCount((count) => count + 30)}>Load 30 more</button></nav>}
      </section>

      {!isCashAccount(detailAccount) && own && <details className="v2-card v2-collapse">
        <summary><Scales size={20} weight="duotone" /><span><strong>Check against your bank</strong><small>Optional: compare with the balance your bank or wallet shows, then lock the result.</small></span><CaretDown size={16} weight="bold" /></summary>
        <div className="v2-collapse-body">{reconciliationSection}</div>
      </details>}
      {resetModal}
    </div>;
  }

  const comparisonAll = overview;
  const totalSpent = comparisonAll.currentMinor;
  const shareRows = comparisonAll.accounts.filter((item) => item.currentMinor > 0);
  const allDiff = comparisonAll.currentMinor - comparisonAll.previousMinor;
  const looseBuckets = comparisonAll.accounts.filter((item) => !item.account && (item.currentMinor || item.previousMinor));
  const cardFor = (item: AccountSpend) => {
    const account = item.account;
    const { tone } = accountLook(account, item.key);
    const peak = Math.max(1, item.currentMinor, item.previousMinor);
    const top = biggestByBucket.get(item.key);
    const name = account ? (account.label || paymentAccountLabel(account)) : item.key === CASH_BUCKET ? "Cash" : "No account set";
    const body = <>
      <div className="v2-acct-top"><AccountTile account={account} bucket={item.key} size={44} /><span className="v2-acct-name"><strong>{name}</strong><small>{account ? providerText(account) : item.key === CASH_BUCKET ? "Cash entries · no Cash account yet" : "Entries without an account"}</small></span>{account?.shared && <span className="v2-ours">Shared</span>}</div>
      <div className="v2-acct-spend"><span><small>Spent</small><strong className="amount">{formatMoney(item.currentMinor, profile.currency)}</strong></span><span className={`v2-delta is-pill ${deltaClass(item.currentMinor, item.previousMinor)}`}>{percentText(item.currentMinor, item.previousMinor)}</span></div>
      <div className="v2-acct-bars"><span style={{ width: `${item.currentMinor / peak * 100}%`, background: tone.ink }} /><span style={{ width: `${item.previousMinor / peak * 100}%`, background: tone.pale }} /></div>
      <small className="v2-muted">Last month, same days: {formatMoney(item.previousMinor, profile.currency)}</small>
      {top && <p className="v2-acct-note">Biggest: {top.note || getCategory(top.category, customCategories).label}, {plainAmount(top.amountMinor)} on {formatLedgerDate(top.occurredOn, profile.calendarSystem)}</p>}
      {account && <div className="v2-acct-foot"><span>{isCashAccount(account) ? "In hand" : "Balance"}</span><strong className="amount">{balanceText(account) ?? <HiddenBalance />}</strong><small>{checkedText(account)}</small></div>}
    </>;
    return account
      ? <Link key={item.key} href={`${appRoutes.accounts}?account=${encodeURIComponent(account.id)}`} className="v2-card v2-acct-card" style={{ "--acct-ink": tone.ink } as CSSProperties}>{body}</Link>
      : <Link key={item.key} href={appRoutes.transactions} className="v2-card v2-acct-card is-loose" style={{ "--acct-ink": tone.ink } as CSSProperties}>{body}</Link>;
  };

  return <div className="v2-page v2-accounts">
    <header className="v2-page-head">
      <div><span className="v2-eyebrow">{formatLedgerMonth(period, profile.calendarSystem)}</span><h1>Accounts</h1></div>
      <div className="v2-head-actions">
        {ownAccounts.length > 1 && workspace && <button type="button" className="v2-button is-compact" onClick={() => workspace.openTransfer()} aria-label="Move money between accounts"><ArrowsLeftRight size={18} /><span>Move money</span></button>}
        <a className="v2-button is-primary is-compact" href="#add-account" aria-label="Add an account"><Plus size={18} weight="bold" /><span>Add account</span></a>
      </div>
    </header>

    <section className="v2-hero" aria-labelledby="v2-all-spent">
      <span id="v2-all-spent" className="v2-hero-label">Spent from all accounts · {monthName(period)} 1–{Math.max(comparisonAll.elapsedDays, 1)}</span>
      <strong className="v2-hero-amount amount">{formatMoney(totalSpent, profile.currency)}</strong>
      <span className="v2-hero-pill">{allDiff === 0 ? "Same as last month" : `${allDiff > 0 ? "▲" : "▼"} ${formatMoney(Math.abs(allDiff), profile.currency)}${comparisonAll.previousMinor ? ` · ${Math.round(Math.abs(allDiff) / comparisonAll.previousMinor * 100)}%` : ""} ${allDiff > 0 ? "more" : "less"} than ${monthName(addMonthsToKey(period, -1))} 1–${Math.max(comparisonAll.elapsedDays, 1)}`}</span>
      {shareRows.length > 0 && <>
        <div className="v2-share-bar" role="img" aria-label={`Share of spending: ${shareRows.map((item) => `${item.account ? (item.account.label || paymentAccountLabel(item.account)) : "Cash"} ${Math.round(item.currentMinor / totalSpent * 100)}%`).join(", ")}`}>
          {shareRows.map((item) => <span key={item.key} style={{ flexGrow: item.currentMinor, background: accountLook(item.account, item.key).tone.bg }} />)}
        </div>
        <ul className="v2-share-legend">{shareRows.map((item) => <li key={item.key}><i style={{ background: accountLook(item.account, item.key).tone.bg }} />{item.account ? (item.account.label || paymentAccountLabel(item.account)) : item.key === CASH_BUCKET ? "Cash" : "No account"} <strong>{Math.round(item.currentMinor / totalSpent * 100)}%</strong></li>)}</ul>
      </>}
    </section>

    {paymentAccounts.length > 0 && !balancesShown && <div className="v2-lock-note"><LockKey size={18} weight="duotone" /><span>Balances are hidden.</span>{unlockButton}</div>}

    <div className="v2-acct-grid">
      {comparisonAll.accounts.filter((item) => item.account).map(cardFor)}
      {looseBuckets.map(cardFor)}
      {!paymentAccounts.length && <div className="v2-card"><EmptyState title="No accounts yet" message="Add your bank, a wallet like eSewa or Khalti, and the cash in your pocket to see what each one spends." /></div>}
    </div>

    <section className="v2-card" aria-labelledby="v2-transfers">
      <header className="v2-card-head"><h2 id="v2-transfers">Money moved between accounts</h2>{ownAccounts.length > 1 && workspace && <button type="button" className="v2-link" onClick={() => workspace.openTransfer()}>Move money</button>}</header>
      {transfers.length === 0 ? <p className="v2-empty">No transfers yet. An ATM withdrawal is a transfer from your bank to Cash.</p> : <ul className="v2-rows">{transfers.slice(0, 6).map((transfer) => <EntryRow key={transfer.id} item={{ type: "transfer", transfer }} accounts={paymentAccounts} customCategories={customCategories} selected={false} deletePending={transferAction === transfer.id} onOpen={() => transfer.userId === profile.id && workspace?.openTransfer({ transferId: transfer.id })} onEdit={onEdit} onDuplicate={() => undefined} onDelete={onDelete} onDeleteTransfer={(item) => void removeTransfer(item.id)} />)}</ul>}
      <FormError message={transferError} />
    </section>

    <section className="v2-manage" aria-label="Manage accounts">
      <header className="v2-section-head"><h2>Manage accounts</h2></header>
      {manageSection}
    </section>
    {resetModal}
  </div>;
}

function reconciliationMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function MovementRows({ activity, currency }: { activity: AccountActivity; currency: CurrencyCode }) {
  return <>
    <div><span>Income added</span><strong className="positive">+{formatMoney(activity.incomeMinor, currency)}</strong></div>
    <div><span>Expenses deducted</span><strong className="negative">−{formatMoney(activity.expenseMinor, currency)}</strong></div>
    <div><span>Transfers in</span><strong>+{formatMoney(activity.transfersInMinor, currency)}</strong></div>
    <div><span>Transfers out</span><strong>−{formatMoney(activity.transfersOutMinor, currency)}</strong></div>
  </>;
}

function ReconciliationGap({ gap, currency, transfersInMinor, transfersOutMinor, balanceAsOf, monthLabel }: { gap: ReturnType<typeof reconciliationSpendingGap>; currency: CurrencyCode; transfersInMinor: number; transfersOutMinor: number; balanceAsOf: string; monthLabel: string }) {
  const items = [
    gap.otherAccountExpenseMinor > 0 ? `${formatMoney(gap.otherAccountExpenseMinor, currency)} of ${monthLabel} spending is cash, cheque, or another account.` : null,
    gap.alreadyInOpeningExpenseMinor > 0 ? `${formatMoney(gap.alreadyInOpeningExpenseMinor, currency)} of ${monthLabel} spending on this account is already inside the confirmed balance from ${balanceAsOf}.` : null,
    gap.beforeMonth.expenseMinor > 0 ? `${formatMoney(gap.beforeMonth.expenseMinor, currency)} was spent on this account after ${balanceAsOf} and before ${monthLabel}, so it is included in this check.` : null,
    transfersInMinor > 0 || transfersOutMinor > 0 ? `Transfers in ${formatMoney(transfersInMinor, currency)} and transfers out ${formatMoney(transfersOutMinor, currency)} change the expected balance on their own lines. A transfer moves money between your accounts.` : null,
  ].filter((item): item is string => Boolean(item));
  if (!items.length) return null;
  return <ul className="reconciliation-gap">{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}
