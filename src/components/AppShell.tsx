import { Drawer } from "@mantine/core";
import {
  Calculator,
  ChartPieSlice,
  ClockCounterClockwise,
  Flag,
  Folders,
  HandCoins,
  House,
  ListBullets,
  MapTrifold,
  Plus,
  SignOut,
  SquaresFour,
  UserCircle,
  Wallet,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { appRoutes } from "../lib/routes";
import { GROUPS_HREF } from "../lib/transaction-groups";
import { navigateFromOverlay, useBackToClose } from "../lib/use-back-to-close";
import type { AppView } from "../types";
import { BrandIcon } from "./BrandIcon";
import { ButtonSpinner } from "./ButtonSpinner";

type NavIcon = typeof House;

/** The three pages people open most; everything else lives under More. */
const primary: { id: AppView; label: string; icon: NavIcon }[] = [
  { id: "home", label: "Home", icon: House },
  { id: "transactions", label: "Transactions", icon: ListBullets },
  { id: "accounts", label: "Accounts", icon: Wallet },
];

const more: { id: AppView | "groups"; label: string; hint: string; icon: NavIcon; href: string }[] = [
  { id: "plan", label: "Plan", hint: "Budgets, goals and safe to spend", icon: Flag, href: appRoutes.plan },
  { id: "reports", label: "Reports", hint: "Spending patterns and monthly comparisons", icon: ChartPieSlice, href: appRoutes.reports },
  { id: "dues", label: "Dues", hint: "Payments, reminders, and money between people", icon: HandCoins, href: appRoutes.dues },
  { id: "groups", label: "Groups", hint: "Trips and events, with what each one cost", icon: Folders, href: GROUPS_HREF },
  { id: "maps", label: "Map", hint: "Where you spent and earned", icon: MapTrifold, href: appRoutes.maps },
  { id: "calculator", label: "Calculator", hint: "Split an amount into percentages and goals", icon: Calculator, href: appRoutes.calculator },
  { id: "logs", label: "Logs", hint: "Everything you changed, kept for 90 days", icon: ClockCounterClockwise, href: appRoutes.logs },
  { id: "settings", label: "Settings", hint: "Preferences, categories, and security", icon: UserCircle, href: appRoutes.settings },
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
  const router = useRouter();
  const { user } = useAuth();
  const onGroups = usePathname()?.startsWith(GROUPS_HREF) ?? false;
  useBackToClose(moreOpen, () => setMoreOpen(false));
  // A destination replaces the drawer's back-gesture entry, so Back from it returns to this page.
  const openFromMore = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setMoreOpen(false);
    navigateFromOverlay(() => router.push(href));
  };
  const activeId = onGroups ? "groups" : view;
  const isActive = (id: string) => (id === "transactions" ? view === "transactions" && !onGroups : activeId === id);
  const moreActive = more.some((item) => isActive(item.id));
  const signOutLabel = signingOut ? "Signing out…" : "Sign out";

  return (
    <div className="app-frame v2-frame">
      <aside className="v2-sidebar" aria-label="Primary navigation">
        <div className="v2-brand"><BrandIcon size={34} /><span>SaveYoRupee</span></div>
        <button type="button" className="v2-sidebar-add" onClick={onAdd}><Plus size={19} weight="bold" />Add entries</button>
        <nav className="v2-sidebar-nav" aria-label="Main">
          {primary.map(({ id, label, icon: Icon }) => (
            <Link key={id} href={appRoutes[id]} className={isActive(id) ? "v2-side-link active" : "v2-side-link"} aria-current={isActive(id) ? "page" : undefined}>
              <Icon size={22} weight={isActive(id) ? "fill" : "regular"} />{label}
            </Link>
          ))}
        </nav>
        <nav className="v2-sidebar-more" aria-label="More">
          <span className="v2-side-heading">More</span>
          {more.map(({ id, label, icon: Icon, href }) => (
            <Link key={id} href={href} className={isActive(id) ? "v2-side-sublink active" : "v2-side-sublink"} aria-current={isActive(id) ? "page" : undefined}>
              <Icon size={19} weight={isActive(id) ? "fill" : "regular"} />{label}
            </Link>
          ))}
        </nav>
        <div className="v2-side-user">
          <span className="v2-avatar" aria-hidden="true">{(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}</span>
          <span className="v2-side-user-copy" title={user?.email || undefined}><strong>{user?.name || "Your ledger"}</strong>{user?.email && <small>{user.email}</small>}</span>
          <button type="button" className="v2-icon-btn is-quiet" onClick={onSignOut} disabled={signingOut} aria-label={signOutLabel} title={signOutLabel}>
            {signingOut ? <ButtonSpinner /> : <SignOut size={19} />}
          </button>
        </div>
      </aside>

      <aside className="v2-rail" aria-label="Primary navigation">
        <BrandIcon size={34} />
        <button type="button" className="v2-rail-add" onClick={onAdd} aria-label="Add entries"><Plus size={26} weight="bold" /></button>
        <nav aria-label="Main">
          {primary.map(({ id, label, icon: Icon }) => (
            <Link key={id} href={appRoutes[id]} className={isActive(id) ? "v2-rail-link active" : "v2-rail-link"} aria-current={isActive(id) ? "page" : undefined}>
              <span><Icon size={23} weight={isActive(id) ? "fill" : "regular"} /></span>{label}
            </Link>
          ))}
          <button type="button" className={moreActive || moreOpen ? "v2-rail-link active" : "v2-rail-link"} onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}>
            <span><SquaresFour size={23} weight={moreActive || moreOpen ? "fill" : "regular"} /></span>More
          </button>
        </nav>
      </aside>

      <main className="app-main v2-main">{children}</main>

      <nav className="v2-tabbar" aria-label="Primary navigation">
        {primary.slice(0, 2).map(({ id, label, icon: Icon }) => (
          <Link key={id} href={appRoutes[id]} className={isActive(id) ? "v2-tab active" : "v2-tab"} aria-current={isActive(id) ? "page" : undefined}>
            <span><Icon size={23} weight={isActive(id) ? "fill" : "regular"} /></span>{label}
          </Link>
        ))}
        <button type="button" className="v2-tab-add" onClick={onAdd} aria-label="Add entries"><Plus size={28} weight="bold" /></button>
        {primary.slice(2).map(({ id, label, icon: Icon }) => (
          <Link key={id} href={appRoutes[id]} className={isActive(id) ? "v2-tab active" : "v2-tab"} aria-current={isActive(id) ? "page" : undefined}>
            <span><Icon size={23} weight={isActive(id) ? "fill" : "regular"} /></span>{label}
          </Link>
        ))}
        <button type="button" className={moreActive || moreOpen ? "v2-tab active" : "v2-tab"} onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}>
          <span><SquaresFour size={23} weight={moreActive || moreOpen ? "fill" : "regular"} /></span>More
        </button>
      </nav>

      <Drawer opened={moreOpen} onClose={() => setMoreOpen(false)} position="bottom" size="auto" title="More" overlayProps={{ backgroundOpacity: .48, blur: 4 }} classNames={{ content: "mobile-more-content v2-more-content", header: "mobile-more-header", body: "mobile-more-body", title: "mobile-more-title" }}>
        <nav className="mobile-more-links v2-more-links" aria-label="More destinations">
          {more.map(({ id, label, hint, icon: Icon, href }) => (
            <Link key={id} href={href} className={isActive(id) ? "mobile-more-link active" : "mobile-more-link"} onClick={(event) => openFromMore(event, href)} aria-current={isActive(id) ? "page" : undefined}>
              <span><Icon size={22} weight={isActive(id) ? "fill" : "duotone"} /></span>
              <span><strong>{label}</strong><small>{hint}</small></span>
            </Link>
          ))}
        </nav>
        <button className="mobile-more-signout" disabled={signingOut} onClick={onSignOut}>
          {signingOut ? <ButtonSpinner /> : <SignOut size={19} />}
          {signOutLabel}
        </button>
      </Drawer>
    </div>
  );
}
