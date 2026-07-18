/* eslint-disable react-refresh/only-export-components */
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@fontsource-variable/manrope";
import { MantineProvider, createTheme } from "@mantine/core";
import type { Metadata } from "next";
import "../styles.css";

const theme = createTheme({
  primaryColor: "ledgerBlue",
  fontFamily: "Manrope Variable, sans-serif",
  headings: { fontFamily: "Manrope Variable, sans-serif", fontWeight: "750" },
  defaultRadius: "md",
  colors: {
    ledgerBlue: ["#edf4ff", "#dbe8ff", "#b3ceff", "#86b0ff", "#5b94fb", "#3678f2", "#135dea", "#0d4dcc", "#0b42aa", "#0b398b"],
  },
  components: {
    Input: { defaultProps: { size: "md", radius: "md" } },
    InputWrapper: { defaultProps: { size: "md" } },
    Select: { defaultProps: { size: "md", radius: "md", comboboxProps: { shadow: "md", withinPortal: true } } },
    NumberInput: { defaultProps: { size: "md", radius: "md", hideControls: true } },
    PasswordInput: { defaultProps: { size: "md", radius: "md" } },
  },
});

export const metadata: Metadata = {
  title: "Paper Ledger",
  description: "A calm, private personal expense and income tracker.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><MantineProvider theme={theme}>{children}</MantineProvider></body></html>;
}
