import { ArrowCounterClockwise, ArrowsLeftRight, Bank, CalendarBlank, Check, CheckCircle, Copy, LockKey, PencilSimple, Plus, Receipt, Scales, ShieldCheck, Trash, TrendDown, TrendUp, UploadSimple } from "@phosphor-icons/react";
import { Modal, NumberInput, Select, Switch, TextInput } from "@mantine/core";
import Link from "next/link";
import { useContext, useEffect, useMemo, useState } from "react";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { EmptyState } from "../components/EmptyState";
import { TransactionRow } from "../components/TransactionRow";
import { TransferRow } from "../components/TransferRow";
import { useLedger } from "../context/LedgerContext";
import { LedgerWorkspaceContext } from "../context/LedgerWorkspaceContext";
import { accountActivityThrough, activityHasMovement, expectedAccountBalanceThrough, reconciliationSpendingGap, transactionPostsTo, transferRemovalEffects, type AccountActivity } from "../lib/account-balances";
import { formatMoney, majorToMinor } from "../lib/currency";
import { formatLedgerDate, todayInput } from "../lib/dates";
import { listLedgerActivity, transferAccountLabel } from "../lib/transaction-history";
import { isCashAccount, NEPAL_MOBILE_BANKS, normalizeAccountTail, PAYMENT_ACCOUNT_TYPES, paymentAccountLabel, paymentAccountProviderError, providerForAccountType } from "../lib/payment-accounts";
import type { CurrencyCode, LedgerTransaction, PaymentAccount, PaymentAccountType } from "../types";
import { FormError } from "../components/FormError";
import { BalanceLocked, BalancePinHint, HiddenBalance } from "../components/BalancePrivacy";

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
  const [selectedAccountId, setSelectedAccountId] = useState(paymentAccounts[0]?.id ?? "");
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
  const accountIncome = accountTransactions.reduce((sum, transaction) => sum + (transaction.kind === "income" ? transaction.amountMinor : 0), 0);
  const accountExpenses = accountTransactions.reduce((sum, transaction) => sum + (transaction.kind === "expense" ? transaction.amountMinor : 0), 0);
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

  return <div className="page accounts-page">
    <header className="page-header"><div><span className="eyebrow">Your money sources</span><h1>Accounts</h1><p>Manage tracked balances, move money between accounts, and review each account’s transactions.</p></div></header>

    <section className="import-reconcile-note" aria-label="Import and reconciliation guidance">
      <div><strong>Import history first, reconcile later</strong><p>CSV import adds past transactions. Reconciliation is a separate, optional check against the balance currently shown by your bank or wallet. You do not need to do both during setup.</p></div>
      <Link className="secondary-button small" href="/transactions#import-csv"><UploadSimple size={16} />Import past history</Link>
    </section>

    <section className="accounts-overview" aria-label="Tracked accounts">
      <div className="section-heading"><div><span className="section-label">Balances</span><h2>Tracked accounts</h2></div><Bank size={23} weight="duotone" /></div>
      {paymentAccounts.length > 0 && (balancesShown ? !profile.hasPin && <BalancePinHint /> : <BalanceLocked title="Account balances are hidden" />)}
      <div className="account-summary-grid">
        {paymentAccounts.map((account) => <div key={account.id} className={selectedAccountId === account.id ? "account-summary-card active" : "account-summary-card"}>
          <button type="button" className="account-summary-select" onClick={() => setSelectedAccountId(account.id)} aria-pressed={selectedAccountId === account.id}>
            <span>{paymentAccountLabel(account)}</span><strong>{balancesShown ? formatMoney(account.currentBalanceMinor, profile.currency) : <HiddenBalance />}</strong><small>{isCashAccount(account) ? "Counted" : "Checked"} {formatLedgerDate(account.balanceAsOf, profile.calendarSystem)}{account.accountTail ? ` · ends ${account.accountTail}` : ""}</small>
          </button>
          {account.userId === profile.id && ownAccounts.length > 1 && workspace && <button type="button" className="text-button account-move-money" onClick={() => workspace.openTransfer({ fromAccountId: account.id })}><ArrowsLeftRight size={14} />Move money</button>}
        </div>)}
        {!paymentAccounts.length && <EmptyState title="No tracked accounts yet" message="Add a bank, a digital wallet or the cash in your wallet to start tracking balances and account activity." />}
      </div>
    </section>

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

      <section className="settings-panel"><div className="settings-title"><span className="settings-icon"><ArrowsLeftRight size={23} /></span><div><h2>Account movement</h2><p>Transfer money without counting it as income or spending.</p></div></div>
        {ownAccounts.length < 2 ? <p className="plan-empty-copy">Add at least two of your own tracked accounts to record a transfer. Cash in hand counts as one, so an ATM withdrawal can move money from your bank into it.</p> : workspace && <button type="button" className="primary-button account-move-money-main" onClick={() => workspace.openTransfer()}><ArrowsLeftRight size={17} />Move money</button>}
        <FormError message={transferError} />
        <div className="transfer-list">{transfers.slice(0, 8).map((transfer) => { const from = paymentAccounts.find((account) => account.id === transfer.fromAccountId); const to = paymentAccounts.find((account) => account.id === transfer.toAccountId); const mine = transfer.userId === profile.id; return <div key={transfer.id} className="transfer-row"><span><strong>{from ? paymentAccountLabel(from) : "Removed account"} → {to ? paymentAccountLabel(to) : "Removed account"}</strong><small>{formatLedgerDate(transfer.occurredOn, profile.calendarSystem)}{transfer.note ? ` · ${transfer.note}` : ""}</small></span><div><strong>{formatMoney(transfer.amountMinor, profile.currency)}</strong>{mine && workspace && <button type="button" className="icon-button" disabled={Boolean(transferAction)} onClick={() => workspace.openTransfer({ transferId: transfer.id })} aria-label="Edit transfer"><PencilSimple size={16} /></button>}<button type="button" className="icon-button danger" disabled={Boolean(transferAction)} hidden={!mine} onClick={() => void removeTransfer(transfer.id)} aria-label="Delete transfer">{transferAction === transfer.id ? <ButtonSpinner /> : <Trash size={16} />}</button></div></div>; })}{!transfers.length && <p>No transfers recorded yet.</p>}</div>
      </section>
    </div>

    <section className="account-reconciliation-section" aria-labelledby="account-reconciliation-title">
      <div className="section-heading reconciliation-heading">
        <div><span className="section-label">Optional account check</span><h2 id="account-reconciliation-title">Reconcile an account</h2><p>This compares one account with the balance shown by your bank or wallet, then locks the result. The month names the check. The figures run from the last confirmed balance through the date you check.</p></div>
        <Scales size={25} weight="duotone" />
      </div>

      {paymentAccounts.length > 0 && !balancesShown ? <BalanceLocked title="Reconciliation is hidden" detail="A reconciliation shows each account's expected and actual balance. Unlock balances with your ledger PIN to check one." /> : paymentAccounts.length > 0 ? <div className="reconciliation-layout">
        <article className="reconciliation-workspace">
          <div className="reconciliation-controls">
            <Select label="Account" value={selectedAccountId} onChange={(value) => { setSelectedAccountId(value ?? ""); setReconciliationActual(""); setReconciliationNote(""); setReconciliationError(null); }} data={paymentAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} allowDeselect={false} />
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

    <section className="account-transactions-panel">
      <div className="account-transactions-heading"><div><span className="section-label">Account-wise transactions</span><h2>{selectedAccount ? paymentAccountLabel(selectedAccount) : "Choose an account"}</h2><p>{selectedIsCash ? "Your cash entries, plus money moved into or out of your cash. Income and expense totals stay all-time totals." : "Transactions paid through the selected account, plus transfers into or out of it. Income and expense totals stay all-time transaction totals."}</p></div>{paymentAccounts.length > 0 && <Select aria-label="Choose account" value={selectedAccountId} onChange={(value) => setSelectedAccountId(value ?? "")} data={paymentAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} allowDeselect={false} />}</div>
      {selectedAccount && <div className="account-transaction-kpis"><div><TrendUp size={18} /><span>All-time income<strong>{formatMoney(accountIncome, profile.currency)}</strong></span></div><div><TrendDown size={18} /><span>All-time expenses<strong>{formatMoney(accountExpenses, profile.currency)}</strong></span></div><div><Receipt size={18} /><span>Transactions<strong>{accountTransactions.length}</strong></span></div></div>}
      <div className="account-transaction-list">{accountEntries.map((entry) => entry.type === "transaction" ? <TransactionRow key={`transaction-${entry.transaction.id}`} transaction={entry.transaction} currency={profile.currency} customCategories={customCategories} onEdit={onEdit} onDelete={onDelete} /> : <TransferRow key={`transfer-${entry.transfer.id}`} transfer={entry.transfer} fromLabel={transferAccountLabel(paymentAccounts, entry.transfer.fromAccountId)} toLabel={transferAccountLabel(paymentAccounts, entry.transfer.toAccountId)} currency={profile.currency} direction={entry.transfer.toAccountId === selectedAccountId ? "in" : "out"} onDelete={() => void removeTransfer(entry.transfer.id)} deletePending={transferAction === entry.transfer.id} />)}{selectedAccount && !accountEntries.length && <EmptyState title="No activity for this account" message={selectedIsCash ? "Cash entries and money moved into or out of your cash will appear here." : "Online transactions and transfers for this account will appear here."} action={<button className="primary-button" onClick={onAdd}>Add transaction</button>} />}{!selectedAccount && <EmptyState title="Choose an account first" message="Add a tracked account to see its transactions here." />}</div>
    </section>
    <Modal opened={Boolean(resetAccount)} onClose={closeReset} centered closeOnClickOutside={!resetting} closeOnEscape={!resetting} withCloseButton={!resetting} overlayProps={{ backgroundOpacity: .55, blur: 5 }} title="Reset reconciliation history?">
      <p className="delete-account-warning">This removes every approved reconciliation for <strong>{resetAccount ? paymentAccountLabel(resetAccount) : "this account"}</strong> and restores its earliest opening balance snapshot. Transactions and transfers are preserved. This cannot be undone.</p>
      <form className="delete-account-form" onSubmit={resetAuditHistory} aria-busy={resetting}>
        <TextInput label="Type RESET to confirm" value={resetConfirmation} onChange={(event) => setResetConfirmation(event.currentTarget.value)} autoComplete="off" required disabled={resetting} />
        <FormError message={resetError} />
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={closeReset} disabled={resetting}>Cancel</button><button type="submit" className="delete-account-button" disabled={resetting || resetConfirmation !== "RESET"}>{resetting ? <><ButtonSpinner />Resetting…</> : <><ArrowCounterClockwise size={17} />Reset audit history</>}</button></div>
      </form>
    </Modal>
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
