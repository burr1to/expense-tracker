import type { AppView } from "../types";

export const appRoutes: Record<AppView, string> = {
  home: "/",
  plan: "/plans",
  dues: "/dues",
  reports: "/reports",
  transactions: "/transactions",
  settings: "/profile",
};

export function viewFromPathname(pathname: string): AppView {
  if (pathname.startsWith("/plans")) return "plan";
  if (pathname.startsWith("/dues")) return "dues";
  if (pathname.startsWith("/reports")) return "reports";
  if (pathname.startsWith("/transactions")) return "transactions";
  if (pathname.startsWith("/profile")) return "settings";
  return "home";
}
