/* eslint-disable react-refresh/only-export-components */
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "@fontsource-variable/manrope";
import { MantineProvider, createTheme } from "@mantine/core";
import type { Metadata } from "next";
import { AppProviders } from "../components/AppProviders";
import "../styles.css";

const theme = createTheme({
  primaryColor: "ledgerGreen",
  fontFamily: "Manrope Variable, sans-serif",
  headings: { fontFamily: "Manrope Variable, sans-serif", fontWeight: "750" },
  defaultRadius: "md",
  colors: {
    ledgerGreen: ["#edf8f1", "#d9f0e2", "#b8dfc7", "#8dccaa", "#5eb887", "#35a268", "#147a4b", "#106a41", "#0b5836", "#07472b"],
  },
  components: {
    Input: { defaultProps: { size: "md", radius: "md" } },
    InputWrapper: { defaultProps: { size: "md" } },
    Select: {
      defaultProps: {
        size: "md",
        radius: "md",
        inputMode: "none",
        comboboxProps: { shadow: "md", withinPortal: true, floatingStrategy: "fixed" },
      },
    },
    Popover: { defaultProps: { floatingStrategy: "fixed" } },
    NumberInput: { defaultProps: { size: "md", radius: "md", hideControls: true } },
    PasswordInput: { defaultProps: { size: "md", radius: "md" } },
  },
});

export const metadata: Metadata = {
  title: "SaveYoRupee",
  description: "A calm, private personal expense and income tracker.",
  applicationName: "SaveYoRupee",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><MantineProvider theme={theme}><AppProviders>{children}</AppProviders></MantineProvider></body></html>;
}
