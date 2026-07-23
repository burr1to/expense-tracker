import { ArrowsLeftRight, Bank, CalendarBlank, LockKey, Plus, Receipt, Trash, TrendDown, TrendUp } from "@phosphor-icons/react";
import { NumberInput, Select, TextInput } from "@mantine/core";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ButtonSpinner } from "../components/ButtonSpinner";
import { EmptyState } from "../components/EmptyState";
import { TransactionRow } from "../components/TransactionRow";
import { useLedger } from "../context/LedgerContext";
import { formatMoney } from "../lib/currency";
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
    transfers,
    savePaymentAccount,
    updatePaymentAccountBalance,
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

  useEffect(() => {
    if (!paymentAccounts.some((account) => account.id === selectedAccountId)) {
      setSelectedAccountId(paymentAccounts[0]?.id ?? "");
    }
  }, [paymentAccounts, selectedAccountId]);

  const selectedAccount = paymentAccounts.find((account) => account.id === selectedAccountId) ?? null;
  const accountTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.paymentAccountId === selectedAccountId),
    [selectedAccountId, transactions],
  );
  const accountIncome = accountTransactions.reduce((sum, transaction) => sum + (transaction.kind === "income" ? transaction.amountMinor : 0), 0);
  const accountExpenses = accountTransactions.reduce((sum, transaction) => sum + (transaction.kind === "expense" ? transaction.amountMinor : 0), 0);

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
      <section className="settings-panel"><div className="settings-title"><span className="settings-icon"><Bank size={23} /></span><div><h2>Add and manage accounts</h2><p>Enter the real balance currently shown by your bank or wallet.</p></div></div>
        {profile.hasPin ? <form className="settings-form" onSubmit={addPaymentAccount} aria-busy={accountAction === "add"}>
          <Select label="Account type" value={accountType} onChange={(value) => { if (!value) return; setAccountType(value as PaymentAccountType); setAccountProvider(""); }} data={[...PAYMENT_ACCOUNT_TYPES]} allowDeselect={false} disabled={Boolean(accountAction)} />
          {accountType === "mobile_banking" && <Select label="Bank" placeholder="Search Nepal banks" value={accountProvider || null} onChange={(value) => setAccountProvider(value ?? "")} data={NEPAL_MOBILE_BANKS.map((bank) => ({ value: bank, label: bank }))} searchable required disabled={Boolean(accountAction)} />}
          <TextInput label="Nickname" description="Optional — useful if you have more than one account." placeholder={accountType === "mobile_banking" ? "e.g. Salary account" : "e.g. Personal wallet"} value={accountLabel} onChange={(event) => setAccountLabel(event.target.value)} maxLength={60} disabled={Boolean(accountAction)} />
          <NumberInput label="Balance today" description="Use the balance currently shown by your bank or wallet." value={accountBalance} onChange={(value) => setAccountBalance(String(value))} decimalScale={2} thousandSeparator="," disabled={Boolean(accountAction)} />
          <TextInput label="Balance as of" type="date" leftSection={<CalendarBlank size={16} aria-hidden />} value={accountBalanceAsOf} onChange={(event) => setAccountBalanceAsOf(event.currentTarget.value)} required disabled={Boolean(accountAction)} />
          {accountError && <div className="form-error" role="alert">{accountError}</div>}
          <button className="primary-button" disabled={Boolean(accountAction) || (accountType === "mobile_banking" && !accountProvider)}>{accountAction === "add" ? <><ButtonSpinner />Adding…</> : <><Plus size={17} />Add account</>}</button>
        </form> : <div className="account-pin-required"><span><LockKey size={21} weight="duotone" /></span><div><strong>PIN required to add an account</strong><p>Set up a 4–6 digit ledger PIN in Profile first. It protects the balances shown on your dashboard.</p></div><Link className="primary-button" href="/profile#security-heading">Go to PIN setup</Link></div>}
        <div className="payment-account-list">{paymentAccounts.map((account) => <div key={account.id} className="payment-account-item" aria-busy={accountAction === account.id}><div className="payment-account-summary"><span><strong>{paymentAccountLabel(account)}</strong><small>{formatMoney(account.currentBalanceMinor, profile.currency)} · checked {account.balanceAsOf}</small></span><div className="payment-account-actions"><button type="button" className="text-button" disabled={Boolean(accountAction)} onClick={() => beginBalanceEdit(account)}>Update balance</button><button type="button" className="icon-button danger" disabled={Boolean(accountAction)} onClick={() => void removePaymentAccount(account.id)} aria-label={`Remove ${paymentAccountLabel(account)}`}>{accountAction === account.id ? <ButtonSpinner /> : <Trash size={16} />}</button></div></div>{editingBalanceId === account.id && <form className="account-balance-form" onSubmit={saveBalance}><NumberInput label="Real balance" value={editingBalance} onChange={(value) => setEditingBalance(String(value))} decimalScale={2} thousandSeparator="," required disabled={Boolean(accountAction)} /><TextInput label="Checked on" type="date" leftSection={<CalendarBlank size={16} aria-hidden />} value={editingBalanceAsOf} onChange={(event) => setEditingBalanceAsOf(event.currentTarget.value)} required disabled={Boolean(accountAction)} /><div className="inline-actions"><button type="button" className="secondary-button" onClick={() => setEditingBalanceId(null)} disabled={Boolean(accountAction)}>Cancel</button><button className="primary-button" disabled={Boolean(accountAction)}>{accountAction === account.id ? <><ButtonSpinner />Saving…</> : "Save balance"}</button></div></form>}</div>)}{!paymentAccounts.length && <p>No tracked accounts yet.</p>}</div>
      </section>

      <section className="settings-panel"><div className="settings-title"><span className="settings-icon"><ArrowsLeftRight size={23} /></span><div><h2>Account movement</h2><p>Transfer money without counting it as income or spending.</p></div></div>
        {paymentAccounts.length < 2 ? <p className="plan-empty-copy">Add at least two tracked accounts to record a transfer.</p> : <form className="transfer-form" onSubmit={addTransfer} aria-busy={transferAction === "add"}><Select label="From" placeholder="Choose source account" value={transferFrom || null} onChange={(value) => setTransferFrom(value ?? "")} data={paymentAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} required disabled={Boolean(transferAction)} /><Select label="To" placeholder="Choose destination account" value={transferTo || null} onChange={(value) => setTransferTo(value ?? "")} data={paymentAccounts.filter((account) => account.id !== transferFrom).map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} required disabled={Boolean(transferAction)} /><NumberInput label="Amount" value={transferAmount} onChange={(value) => setTransferAmount(String(value))} decimalScale={2} thousandSeparator="," required disabled={Boolean(transferAction)} /><TextInput label="Date" type="date" leftSection={<CalendarBlank size={16} aria-hidden />} value={transferDate} onChange={(event) => setTransferDate(event.currentTarget.value)} required disabled={Boolean(transferAction)} /><TextInput label="Note" value={transferNote} onChange={(event) => setTransferNote(event.currentTarget.value)} placeholder="Optional" maxLength={240} disabled={Boolean(transferAction)} />{transferError && <div className="form-error" role="alert">{transferError}</div>}<button className="primary-button" disabled={Boolean(transferAction)}>{transferAction === "add" ? <><ButtonSpinner />Recording…</> : <><ArrowsLeftRight size={17} />Record transfer</>}</button></form>}
        <div className="transfer-list">{transfers.slice(0, 8).map((transfer) => { const from = paymentAccounts.find((account) => account.id === transfer.fromAccountId); const to = paymentAccounts.find((account) => account.id === transfer.toAccountId); return <div key={transfer.id} className="transfer-row"><span><strong>{from ? paymentAccountLabel(from) : "Removed account"} → {to ? paymentAccountLabel(to) : "Removed account"}</strong><small>{transfer.occurredOn}{transfer.note ? ` · ${transfer.note}` : ""}</small></span><div><strong>{formatMoney(transfer.amountMinor, profile.currency)}</strong><button type="button" className="icon-button danger" disabled={Boolean(transferAction)} onClick={() => void removeTransfer(transfer.id)} aria-label="Delete transfer">{transferAction === transfer.id ? <ButtonSpinner /> : <Trash size={16} />}</button></div></div>; })}{!transfers.length && <p>No transfers recorded yet.</p>}</div>
      </section>
    </div>

    <section className="account-transactions-panel">
      <div className="account-transactions-heading"><div><span className="section-label">Account-wise transactions</span><h2>{selectedAccount ? paymentAccountLabel(selectedAccount) : "Choose an account"}</h2><p>Only transactions paid through the selected account appear here.</p></div>{paymentAccounts.length > 0 && <Select aria-label="Choose account" value={selectedAccountId} onChange={(value) => setSelectedAccountId(value ?? "")} data={paymentAccounts.map((account) => ({ value: account.id, label: paymentAccountLabel(account) }))} allowDeselect={false} />}</div>
      {selectedAccount && <div className="account-transaction-kpis"><div><TrendUp size={18} /><span>Income<strong>{formatMoney(accountIncome, profile.currency)}</strong></span></div><div><TrendDown size={18} /><span>Expenses<strong>{formatMoney(accountExpenses, profile.currency)}</strong></span></div><div><Receipt size={18} /><span>Transactions<strong>{accountTransactions.length}</strong></span></div></div>}
      <div className="account-transaction-list">{accountTransactions.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} currency={profile.currency} customCategories={customCategories} onEdit={onEdit} onDelete={onDelete} />)}{selectedAccount && !accountTransactions.length && <EmptyState title="No transactions for this account" message="Online transactions assigned to this account will appear here." action={<button className="primary-button" onClick={onAdd}>Add transaction</button>} />}{!selectedAccount && <EmptyState title="Choose an account first" message="Add a tracked account to see its transactions here." />}</div>
    </section>
  </div>;
}
