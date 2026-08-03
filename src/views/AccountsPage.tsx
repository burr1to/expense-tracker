import { ArrowCounterClockwise, ArrowsLeftRight, Bank, CalendarBlank, Check, CheckCircle, Copy, LockKey, Plus, Receipt, Scales, ShieldCheck, Trash, TrendDown, TrendUp } from "@phosphor-icons/react";
import { Modal, NumberInput, Select, TextInput } from "@mantine/core";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { EmptyState } from "../components/EmptyState";
import { TransactionRow } from "../components/TransactionRow";
import { useLedger } from "../context/LedgerContext";
import { expectedAccountBalanceThrough } from "../lib/account-balances";
import { formatMoney, majorToMinor } from "../lib/currency";
import { toDateInput } from "../lib/dates";
import { NEPAL_MOBILE_BANKS, PAYMENT_ACCOUNT_TYPES, paymentAccountLabel } from "../lib/payment-accounts";
import type { LedgerTransaction, PaymentAccountType } from "../types";

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
    approveAccountReconciliation,
    resetAccountReconciliation,
    deletePaymentAccount,
    saveTransfer,
    deleteTransfer,
  } = useLedger();
  const [selectedAccountId, setSelectedAccountId] = useState(paymentAccounts[0]?.id ?? "");
  const [accountType, setAccountType] = useState<PaymentAccountType>("mobile_banking");
  const [accountProvider, setAccountProvider] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [accountBalance, setAccountBalance] = useState("");
  const [accountBalanceAsOf, setAccountBalanceAsOf] = useState(toDateInput());
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountAction, setAccountAction] = useState<string | null>(null);
  const [copiedImportId, setCopiedImportId] = useState<string | null>(null);
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  const [editingBalance, setEditingBalance] = useState("");
  const [editingBalanceAsOf, setEditingBalanceAsOf] = useState(toDateInput());
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferDate, setTransferDate] = useState(toDateInput());
  const [transferNote, setTransferNote] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferAction, setTransferAction] = useState<string | null>(null);
  const today = toDateInput();
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
  const accountTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.paymentAccountId === selectedAccountId),
    [selectedAccountId, transactions],
  );
  const accountIncome = accountTransactions.reduce((sum, transaction) => sum + (transaction.kind === "income" ? transaction.amountMinor : 0), 0);
  const accountExpenses = accountTransactions.reduce((sum, transaction) => sum + (transaction.kind === "expense" ? transaction.amountMinor : 0), 0);
  const selectedReconciliations = reconciliations.filter((item) => item.paymentAccountId === selectedAccountId);
  const existingReconciliation = selectedReconciliations.find((item) => item.monthKey === reconciliationMonth) ?? null;
  const reconciliationPreview = selectedAccount && reconciliationCheckedOn >= selectedAccount.balanceAsOf
    ? expectedAccountBalanceThrough(selectedAccount, transactions, transfers, reconciliationCheckedOn)
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
    const provider = accountType === "mobile_banking" ? accountProvider : accountType;
    if (!provider) { setAccountError("Choose a bank."); return; }
    setAccountAction("add");
    try {
      setAccountError(null);
      await savePaymentAccount({ type: accountType, provider, label: accountLabel, balance: accountBalance || "0", balanceAsOf: accountBalanceAsOf });
      setAccountProvider("");
      setAccountLabel("");
      setAccountBalance("");
      setAccountBalanceAsOf(toDateInput());
    } catch (caught) {
      setAccountError(caught instanceof Error ? caught.message : "Could not add the account.");
    } finally {
      setAccountAction(null);
    }
  };
  const beginBalanceEdit = (account: typeof paymentAccounts[number]) => {
    setEditingBalanceId(account.id);
    setEditingBalance(String(account.currentBalanceMinor / 100));
    setEditingBalanceAsOf(account.balanceAsOf);
    setAccountError(null);
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
  const removePaymentAccount = async (id: string) => {
    if (accountAction || !window.confirm("Remove this tracked account? Existing transactions will keep their payment mode.")) return;
    setAccountAction(id);
    try {
      setAccountError(null);
      await deletePaymentAccount(id);
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
  const addTransfer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (transferAction) return;
    if (!transferFrom || !transferTo) { setTransferError("Choose the accounts involved."); return; }
    setTransferAction("add");
    try {
      setTransferError(null);
      await saveTransfer({ fromAccountId: transferFrom, toAccountId: transferTo, amount: transferAmount, occurredOn: transferDate, note: transferNote });
      setTransferAmount("");
      setTransferNote("");
    } catch (caught) {
      setTransferError(caught instanceof Error ? caught.message : "Could not record the transfer.");
    } finally {
      setTransferAction(null);
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

    <section className="accounts-overview" aria-label="Tracked accounts">
      <div className="section-heading"><div><span className="section-label">Balances</span><h2>Tracked accounts</h2></div><Bank size={23} weight="duotone" /></div>
      <div className="account-summary-grid">
        {paymentAccounts.map((account) => <button key={account.id} type="button" className={selectedAccountId === account.id ? "account-summary-card active" : "account-summary-card"} onClick={() => setSelectedAccountId(account.id)} aria-pressed={selectedAccountId === account.id}>
          <span>{paymentAccountLabel(account)}</span><strong>{formatMoney(account.currentBalanceMinor, profile.currency)}</strong><small>Checked {account.balanceAsOf}</small>
        </button>)}
        {!paymentAccounts.length && <EmptyState title="No tracked accounts yet" message="Add a bank or digital wallet to start tracking balances and account activity." />}
      </div>
    </section>

    <div className="accounts-management-grid">
      <section className="settings-panel" id="add-account"><div className="settings-title"><span className="settings-icon"><Bank size={23} /></span><div><h2>Add and manage accounts</h2><p>Enter the real balance currently shown by your bank or wallet.</p></div></div>
        {profile.hasPin ? <form className="settings-form" onSubmit={addPaymentAccount} aria-busy={accountAction === "add"}>
          <Select label="Account type" value={accountType} onChange={(value) => { if (!value) return; setAccountType(value as PaymentAccountType); setAccountProvider(""); }} data={[...PAYMENT_ACCOUNT_TYPES]} allowDeselect={false} disabled={Boolean(accountAction)} />
          {accountType === "mobile_banking" && <Select label="Bank" placeholder="Search Nepal banks" value={accountProvider || null} onChange={(value) => setAccountProvider(value ?? "")} data={NEPAL_MOBILE_BANKS.map((bank) => ({ value: bank, label: bank }))} searchable required disabled={Boolean(accountAction)} />}
          <TextInput label="Nickname" description="Optional — useful if you have more than one account." placeholder={accountType === "mobile_banking" ? "e.g. Salary account" : "e.g. Personal wallet"} value={accountLabel} onChange={(event) => setAccountLabel(event.target.value)} maxLength={60} disabled={Boolean(accountAction)} />
          <NumberInput label="Balance today" description="Use the balance currently shown by your bank or wallet." value={accountBalance} onChange={(value) => setAccountBalance(String(value))} decimalScale={2} thousandSeparator="," disabled={Boolean(accountAction)} />
          <TextInput label="Balance as of" type="date" leftSection={<CalendarBlank size={16} aria-hidden />} value={accountBalanceAsOf} onChange={(event) => setAccountBalanceAsOf(event.currentTarget.value)} required disabled={Boolean(accountAction)} />
          {accountError && <div className="form-error" role="alert">{accountError}</div>}
          <button className="primary-button" disabled={Boolean(accountAction) || (accountType === "mobile_banking" && !accountProvider)}>{accountAction === "add" ? <><ButtonSpinner />Adding…</> : <><Plus size={17} />Add account</>}</button>
        </form> : <div className="account-pin-required"><span><LockKey size={21} weight="duotone" /></span><div><strong>PIN required to add an account</strong><p>Set up a 4–6 digit ledger PIN in Profile first. It protects the balances shown on your dashboard.</p></div><Link className="primary-button" href="/profile#security-heading">Go to PIN setup</Link></div>}
        <div className="payment-account-list">{paymentAccounts.map((account) => {
          const hasAuditHistory = reconciliations.some((item) => item.paymentAccountId === account.id);
          return <div key={account.id} className="payment-account-item" aria-busy={accountAction === account.id}><div className="payment-account-summary"><span><strong>{paymentAccountLabel(account)}</strong><small>{formatMoney(account.currentBalanceMinor, profile.currency)} · checked {account.balanceAsOf}</small><span className="account-import-id"><span>CSV import ID</span><code>{account.importId}</code><button type="button" onClick={() => void copyImportId(account.importId)} aria-label={`Copy CSV import ID for ${paymentAccountLabel(account)}`}>{copiedImportId === account.importId ? <Check size={13} /> : <Copy size={13} />}{copiedImportId === account.importId ? "Copied" : "Copy"}</button></span></span><div className="payment-account-actions">{hasAuditHistory ? <><small className="account-audit-managed"><ShieldCheck size={14} />Reconciled</small><button type="button" className="text-button danger-text" disabled={Boolean(accountAction)} onClick={() => { setResetAccount(account); setResetError(null); }}><ArrowCounterClockwise size={15} />Reset audit history</button></> : <button type="button" className="text-button" disabled={Boolean(accountAction)} onClick={() => beginBalanceEdit(account)}>Correct opening balance</button>}<button type="button" className="icon-button danger" disabled={Boolean(accountAction) || hasAuditHistory} title={hasAuditHistory ? "Reset this account's audit history before removing it." : undefined} onClick={() => void removePaymentAccount(account.id)} aria-label={`Remove ${paymentAccountLabel(account)}`}>{accountAction === account.id ? <ButtonSpinner /> : <Trash size={16} />}</button></div></div>{editingBalanceId === account.id && !hasAuditHistory && <form className="account-balance-form" onSubmit={saveBalance}><NumberInput label="Opening balance" value={editingBalance} onChange={(value) => setEditingBalance(String(value))} decimalScale={2} thousandSeparator="," required disabled={Boolean(accountAction)} /><TextInput label="Balance as of" type="date" leftSection={<CalendarBlank size={16} aria-hidden />} value={editingBalanceAsOf} onChange={(event) => setEditingBalanceAsOf(event.currentTarget.value)} required disabled={Boolean(accountAction)} /><div className="inline-actions"><button type="button" className="secondary-button" onClick={() => setEditingBalanceId(null)} disabled={Boolean(accountAction)}>Cancel</button><button className="primary-button" disabled={Boolean(accountAction)}>{accountAction === account.id ? <><ButtonSpinner />Saving…</> : "Save opening balance"}</button></div></form>}</div>;
        })}{!paymentAccounts.length && <p>No tracked accounts yet.</p>}</div>
      </section>

      <section className="settings-panel"><div className="settings-title"><span className="settings-icon"><ArrowsLeftRight size={23} /></span><div><h2>Account movement</h2><p>Transfer money without counting it as income or spending.</p></div></div>
        {paymentAccounts.length < 2 ? <p className="plan-empty-copy">Add at least two tracked accounts to record a transfer.</p> : <form className="transfer-form" onSubmit={addTransfer} aria-busy={transferAction === "add"}><Select label="From" placeholder="Choose source account" value={transferFrom || null} onChange={(value) => setTransferFrom(value ?? "")} data={paymentAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} required disabled={Boolean(transferAction)} /><Select label="To" placeholder="Choose destination account" value={transferTo || null} onChange={(value) => setTransferTo(value ?? "")} data={paymentAccounts.filter((account) => account.id !== transferFrom).map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} required disabled={Boolean(transferAction)} /><NumberInput label="Amount" value={transferAmount} onChange={(value) => setTransferAmount(String(value))} decimalScale={2} thousandSeparator="," required disabled={Boolean(transferAction)} /><TextInput label="Date" type="date" leftSection={<CalendarBlank size={16} aria-hidden />} value={transferDate} onChange={(event) => setTransferDate(event.currentTarget.value)} required disabled={Boolean(transferAction)} /><TextInput label="Note" value={transferNote} onChange={(event) => setTransferNote(event.currentTarget.value)} placeholder="Optional" maxLength={240} disabled={Boolean(transferAction)} />{transferError && <div className="form-error" role="alert">{transferError}</div>}<button className="primary-button" disabled={Boolean(transferAction)}>{transferAction === "add" ? <><ButtonSpinner />Recording…</> : <><ArrowsLeftRight size={17} />Record transfer</>}</button></form>}
        <div className="transfer-list">{transfers.slice(0, 8).map((transfer) => { const from = paymentAccounts.find((account) => account.id === transfer.fromAccountId); const to = paymentAccounts.find((account) => account.id === transfer.toAccountId); return <div key={transfer.id} className="transfer-row"><span><strong>{from ? paymentAccountLabel(from) : "Removed account"} → {to ? paymentAccountLabel(to) : "Removed account"}</strong><small>{transfer.occurredOn}{transfer.note ? ` · ${transfer.note}` : ""}</small></span><div><strong>{formatMoney(transfer.amountMinor, profile.currency)}</strong><button type="button" className="icon-button danger" disabled={Boolean(transferAction)} onClick={() => void removeTransfer(transfer.id)} aria-label="Delete transfer">{transferAction === transfer.id ? <ButtonSpinner /> : <Trash size={16} />}</button></div></div>; })}{!transfers.length && <p>No transfers recorded yet.</p>}</div>
      </section>
    </div>

    <section className="account-reconciliation-section" aria-labelledby="account-reconciliation-title">
      <div className="section-heading reconciliation-heading">
        <div><span className="section-label">Monthly audit</span><h2 id="account-reconciliation-title">Account reconciliation</h2><p>Compare the ledger with the balance shown by your bank or wallet, then lock the result.</p></div>
        <Scales size={25} weight="duotone" />
      </div>

      {paymentAccounts.length > 0 ? <div className="reconciliation-layout">
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

          {existingReconciliation ? <div className="reconciliation-approved">
            <div className="reconciliation-approved-title"><span><CheckCircle size={22} weight="fill" /></span><div><strong>Approved and locked</strong><small>Checked {existingReconciliation.checkedOn} · approved {new Date(existingReconciliation.approvedAt).toLocaleString()}</small></div></div>
            <div className="reconciliation-calculation">
              <div><span>Starting balance</span><strong>{formatMoney(existingReconciliation.startingBalanceMinor, profile.currency)}</strong></div>
              <div><span>Income</span><strong className="positive">+{formatMoney(existingReconciliation.incomeMinor, profile.currency)}</strong></div>
              <div><span>Expenses</span><strong className="negative">−{formatMoney(existingReconciliation.expenseMinor, profile.currency)}</strong></div>
              <div><span>Transfers in</span><strong>+{formatMoney(existingReconciliation.transfersInMinor, profile.currency)}</strong></div>
              <div><span>Transfers out</span><strong>−{formatMoney(existingReconciliation.transfersOutMinor, profile.currency)}</strong></div>
              <div className="reconciliation-total"><span>Expected balance</span><strong>{formatMoney(existingReconciliation.expectedBalanceMinor, profile.currency)}</strong></div>
              <div><span>Actual balance</span><strong>{formatMoney(existingReconciliation.actualBalanceMinor, profile.currency)}</strong></div>
              <div className="reconciliation-total"><span>Adjustment</span><strong>{formatMoney(existingReconciliation.adjustmentMinor, profile.currency)}</strong></div>
            </div>
            {existingReconciliation.adjustmentNote && <p className="reconciliation-note"><strong>Explanation:</strong> {existingReconciliation.adjustmentNote}</p>}
          </div> : reconciliationDateInvalid || !reconciliationPreview ? <div className="reconciliation-unavailable">
            <CalendarBlank size={22} />
            <div><strong>This period cannot be reconciled</strong><p>{selectedAccount && reconciliationCheckedOn < selectedAccount.balanceAsOf ? `The account balance is already checked through ${selectedAccount.balanceAsOf}. Choose that month or a later one.` : "Choose a valid account, month, and date that is not in the future."}</p></div>
          </div> : <form className="reconciliation-form" onSubmit={approveReconciliation} aria-busy={reconciling}>
            <div className="reconciliation-period-copy"><span>Starting from the confirmed balance on <strong>{selectedAccount?.balanceAsOf}</strong></span><small>Only account activity after that snapshot and through the checked date is included, so nothing is counted twice.</small></div>
            <TextInput label="Balance checked on" type="date" value={reconciliationCheckedOn} min={`${reconciliationMonth}-01`} max={maximumCheckedOn} onChange={(event) => { setReconciliationCheckedOn(event.currentTarget.value); setReconciliationError(null); }} required disabled={reconciling} />
            <div className="reconciliation-calculation">
              <div><span>Confirmed starting balance</span><strong>{formatMoney(selectedAccount?.balanceMinor ?? 0, profile.currency)}</strong></div>
              <div><span>Income added</span><strong className="positive">+{formatMoney(reconciliationPreview.incomeMinor, profile.currency)}</strong></div>
              <div><span>Expenses deducted</span><strong className="negative">−{formatMoney(reconciliationPreview.expenseMinor, profile.currency)}</strong></div>
              <div><span>Transfers in</span><strong>+{formatMoney(reconciliationPreview.transfersInMinor, profile.currency)}</strong></div>
              <div><span>Transfers out</span><strong>−{formatMoney(reconciliationPreview.transfersOutMinor, profile.currency)}</strong></div>
              <div className="reconciliation-total"><span>Expected closing balance</span><strong>{formatMoney(reconciliationPreview.expectedBalanceMinor, profile.currency)}</strong></div>
            </div>
            <NumberInput label={`Balance shown by bank or wallet (${profile.currency})`} description="Enter this manually from the provider's app or statement." value={reconciliationActual} onChange={(value) => { setReconciliationActual(String(value)); setReconciliationError(null); }} decimalScale={2} thousandSeparator="," required disabled={reconciling} />
            {adjustmentMinor !== null && <div className={`reconciliation-difference ${adjustmentMinor === 0 ? "matched" : "different"}`}>
              <span>{adjustmentMinor === 0 ? <CheckCircle size={20} weight="fill" /> : <Scales size={20} />}</span>
              <div><strong>{adjustmentMinor === 0 ? "Balances match exactly" : `${formatMoney(Math.abs(adjustmentMinor), profile.currency)} ${adjustmentMinor > 0 ? "more" : "less"} than expected`}</strong><small>{adjustmentMinor === 0 ? "No adjustment will be applied." : "Add missing entries first when possible. If the difference remains, explain it below."}</small></div>
            </div>}
            {adjustmentMinor !== null && adjustmentMinor !== 0 && <TextInput label="Difference explanation" description="Required for the permanent audit record." placeholder="Bank fee, interest, missing historical entry…" value={reconciliationNote} onChange={(event) => setReconciliationNote(event.currentTarget.value)} maxLength={300} required disabled={reconciling} />}
            {reconciliationError && <div className="form-error" role="alert">{reconciliationError}</div>}
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
      <div className="account-transactions-heading"><div><span className="section-label">Account-wise transactions</span><h2>{selectedAccount ? paymentAccountLabel(selectedAccount) : "Choose an account"}</h2><p>Only transactions paid through the selected account appear here.</p></div>{paymentAccounts.length > 0 && <Select aria-label="Choose account" value={selectedAccountId} onChange={(value) => setSelectedAccountId(value ?? "")} data={paymentAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} allowDeselect={false} />}</div>
      {selectedAccount && <div className="account-transaction-kpis"><div><TrendUp size={18} /><span>Income<strong>{formatMoney(accountIncome, profile.currency)}</strong></span></div><div><TrendDown size={18} /><span>Expenses<strong>{formatMoney(accountExpenses, profile.currency)}</strong></span></div><div><Receipt size={18} /><span>Transactions<strong>{accountTransactions.length}</strong></span></div></div>}
      <div className="account-transaction-list">{accountTransactions.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} currency={profile.currency} customCategories={customCategories} onEdit={onEdit} onDelete={onDelete} />)}{selectedAccount && !accountTransactions.length && <EmptyState title="No transactions for this account" message="Online transactions assigned to this account will appear here." action={<button className="primary-button" onClick={onAdd}>Add transaction</button>} />}{!selectedAccount && <EmptyState title="Choose an account first" message="Add a tracked account to see its transactions here." />}</div>
    </section>
    <Modal opened={Boolean(resetAccount)} onClose={closeReset} centered closeOnClickOutside={!resetting} closeOnEscape={!resetting} withCloseButton={!resetting} overlayProps={{ backgroundOpacity: .55, blur: 5 }} title="Reset reconciliation history?">
      <p className="delete-account-warning">This removes every approved reconciliation for <strong>{resetAccount ? paymentAccountLabel(resetAccount) : "this account"}</strong> and restores its earliest opening balance snapshot. Transactions and transfers are preserved. This cannot be undone.</p>
      <form className="delete-account-form" onSubmit={resetAuditHistory} aria-busy={resetting}>
        <TextInput label="Type RESET to confirm" value={resetConfirmation} onChange={(event) => setResetConfirmation(event.currentTarget.value)} autoComplete="off" required disabled={resetting} />
        {resetError && <div className="form-error" role="alert">{resetError}</div>}
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={closeReset} disabled={resetting}>Cancel</button><button type="submit" className="delete-account-button" disabled={resetting || resetConfirmation !== "RESET"}>{resetting ? <><ButtonSpinner />Resetting…</> : <><ArrowCounterClockwise size={17} />Reset audit history</>}</button></div>
      </form>
    </Modal>
  </div>;
}
