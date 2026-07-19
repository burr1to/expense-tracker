import {
  ChartPieSlice,
  Flag,
  HandCoins,
  House,
  ListBullets,
  Plus,
  SignOut,
  UserCircle,
  Wallet,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { AppView } from "../types";
import { ButtonSpinner } from "./ButtonSpinner";

const navItems: { id: AppView; label: string; icon: typeof House }[] = [
  { id: "home", label: "Home", icon: House },
  { id: "plan", label: "Plan", icon: Flag },
  { id: "dues", label: "Dues", icon: HandCoins },
  { id: "reports", label: "Reports", icon: ChartPieSlice },
  { id: "transactions", label: "Transactions", icon: ListBullets },
  { id: "settings", label: "Profile", icon: UserCircle },
];

interface AppShellProps {
  view: AppView;
  onNavigate: (view: AppView) => void;
  onAdd: () => void;
  onSignOut: () => void;
  signingOut: boolean;
  children: ReactNode;
}

export function AppShell({ view, onNavigate, onAdd, onSignOut, signingOut, children }: AppShellProps) {
  const mobileItems = navItems.filter((item) => item.id !== "reports" && item.id !== "dues");
  return (
    <div className="app-frame">
      <aside className="desktop-sidebar" aria-label="Primary navigation">
        <div className="brand-mark"><Wallet size={27} weight="duotone" /><span>Paper Ledger</span></div>
        <nav>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? "nav-item active" : "nav-item"} onClick={() => onNavigate(id)}>
              <Icon size={22} weight={view === id ? "fill" : "regular"} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-actions">
          <button className="sidebar-add" onClick={onAdd}><Plus size={20} weight="bold" />Add transaction</button>
          <button className="sidebar-signout" disabled={signingOut} onClick={onSignOut}>
            {signingOut ? <ButtonSpinner /> : <SignOut size={20} />}
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      <main className="app-main">{children}</main>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {mobileItems.slice(0, 2).map(({ id, label, icon: Icon }) => (
          <button key={id} className={view === id ? "bottom-nav-item active" : "bottom-nav-item"} onClick={() => onNavigate(id)}>
            <Icon size={25} weight={view === id ? "fill" : "regular"} /><span>{label}</span>
          </button>
        ))}
        <button className="mobile-add" onClick={onAdd} aria-label="Add transaction"><Plus size={31} weight="regular" /></button>
        {mobileItems.slice(2).map(({ id, label, icon: Icon }) => (
          <button key={id} className={view === id ? "bottom-nav-item active" : "bottom-nav-item"} onClick={() => onNavigate(id)}>
            <Icon size={25} weight={view === id ? "fill" : "regular"} /><span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
