/* eslint-disable react-refresh/only-export-components */
import "@fontsource-variable/manrope";
import type { Metadata } from "next";
import "../styles.css";

export const metadata: Metadata = {
  title: "Paper Ledger",
  description: "A calm, private personal expense and income tracker.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
