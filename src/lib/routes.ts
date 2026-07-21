import type { AppView } from "../types";

export const appRoutes: Record<AppView, string> = {
  home: "/",
  plan: "/plans",
  dues: "/dues",
  reports: "/reports",
  transactions: "/transactions",
  maps: "/maps",
  settings: "/profile",
};

export function viewFromPathname(pathname: string): AppView {
  if (pathname.startsWith("/plans")) return "plan";
  if (pathname.startsWith("/dues")) return "dues";
  if (pathname.startsWith("/reports")) return "reports";
  if (pathname.startsWith("/transactions")) return "transactions";
  if (pathname.startsWith("/maps")) return "maps";
  if (pathname.startsWith("/profile")) return "settings";
  return "home";
}
