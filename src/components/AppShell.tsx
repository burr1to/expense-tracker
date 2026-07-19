import { Drawer } from "@mantine/core";
import {
  ChartPieSlice,
  DotsThreeCircle,
  Flag,
  HandCoins,
  House,
  ListBullets,
  Plus,
  SignOut,
  UserCircle,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import { appRoutes } from "../lib/routes";
import type { AppView } from "../types";
import { BrandIcon } from "./BrandIcon";
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
  onAdd: () => void;
  onSignOut: () => void;
  signingOut: boolean;
  children: ReactNode;
}

export function AppShell({ view, onAdd, onSignOut, signingOut, children }: AppShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreItems = navItems.filter((item) => item.id === "dues" || item.id === "reports" || item.id === "settings");
  const moreActive = moreItems.some((item) => item.id === view);
  return (
    <div className="app-frame">
      <aside className="desktop-sidebar" aria-label="Primary navigation">
        <div className="brand-mark"><BrandIcon /><span>SaveYoRupee</span></div>
        <nav>
          {navItems.map(({ id, label, icon: Icon }) => (
            <Link key={id} href={appRoutes[id]} className={view === id ? "nav-item active" : "nav-item"} aria-current={view === id ? "page" : undefined}>
              <Icon size={22} weight={view === id ? "fill" : "regular"} />
              <span>{label}</span>
            </Link>
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
        {navItems.filter((item) => item.id === "home" || item.id === "plan").map(({ id, label, icon: Icon }) => (
          <Link key={id} href={appRoutes[id]} className={view === id ? "bottom-nav-item active" : "bottom-nav-item"} aria-current={view === id ? "page" : undefined}>
            <Icon size={25} weight={view === id ? "fill" : "regular"} /><span>{label}</span>
          </Link>
        ))}
        <button className="mobile-add" onClick={onAdd} aria-label="Add transaction"><Plus size={28} weight="bold" /></button>
        <Link href={appRoutes.transactions} className={view === "transactions" ? "bottom-nav-item active" : "bottom-nav-item"} aria-current={view === "transactions" ? "page" : undefined}>
          <ListBullets size={25} weight={view === "transactions" ? "fill" : "regular"} /><span>Transactions</span>
        </Link>
        <button className={moreActive || moreOpen ? "bottom-nav-item active" : "bottom-nav-item"} onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}>
          <DotsThreeCircle size={25} weight={moreActive || moreOpen ? "fill" : "regular"} /><span>More</span>
        </button>
      </nav>

      <Drawer opened={moreOpen} onClose={() => setMoreOpen(false)} position="bottom" size="auto" title="More" overlayProps={{ backgroundOpacity: .48, blur: 4 }} classNames={{ content: "mobile-more-content", header: "mobile-more-header", body: "mobile-more-body", title: "mobile-more-title" }}>
        <nav className="mobile-more-links" aria-label="More destinations">
          {moreItems.map(({ id, label, icon: Icon }) => (
            <Link key={id} href={appRoutes[id]} className={view === id ? "mobile-more-link active" : "mobile-more-link"} onClick={() => setMoreOpen(false)} aria-current={view === id ? "page" : undefined}>
              <span><Icon size={22} weight={view === id ? "fill" : "duotone"} /></span>
              <span><strong>{label}</strong><small>{id === "dues" ? "Payments, reminders, and money between people" : id === "reports" ? "Spending patterns and monthly comparisons" : "Preferences, categories, accounts, and security"}</small></span>
            </Link>
          ))}
        </nav>
        <button className="mobile-more-signout" disabled={signingOut} onClick={onSignOut}>
          {signingOut ? <ButtonSpinner /> : <SignOut size={19} />}
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </Drawer>
    </div>
  );
}
