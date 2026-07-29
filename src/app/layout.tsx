/* eslint-disable react-refresh/only-export-components */
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "@fontsource-variable/ibm-plex-sans";
import { MantineProvider, createTheme } from "@mantine/core";
import type { Metadata } from "next";
import { AppProviders } from "../components/AppProviders";
import "../styles.css";

const theme = createTheme({
  primaryColor: "ledgerGreen",
  fontFamily: "IBM Plex Sans Variable, ui-sans-serif, system-ui, sans-serif",
  headings: { fontFamily: "IBM Plex Sans Variable, ui-sans-serif, system-ui, sans-serif", fontWeight: "650" },
  defaultRadius: "xs",
  colors: {
    ledgerGreen: ["#f3f6f3", "#e5ece6", "#cddbcf", "#aec4b3", "#8eac98", "#718f7b", "#557f69", "#486e5a", "#3f5f4f", "#344e42"],
  },
  components: {
    Input: { defaultProps: { size: "xs", radius: "xs" } },
    InputWrapper: { defaultProps: { size: "xs" } },
    Select: {
      defaultProps: {
        size: "xs",
        radius: "xs",
        inputMode: "none",
        comboboxProps: { shadow: "md", withinPortal: true, floatingStrategy: "fixed" },
      },
    },
    NumberInput: { defaultProps: { size: "xs", radius: "xs", hideControls: true } },
    PasswordInput: { defaultProps: { size: "xs", radius: "xs" } },
    Modal: { defaultProps: { transitionProps: { transition: "pop", duration: 240, timingFunction: "cubic-bezier(.16,1,.3,1)" } } },
    Drawer: { defaultProps: { transitionProps: { transition: "slide-up", duration: 280, timingFunction: "cubic-bezier(.16,1,.3,1)" } } },
    Popover: { defaultProps: { floatingStrategy: "fixed", transitionProps: { transition: "fade-down", duration: 160, timingFunction: "cubic-bezier(.2,.7,.2,1)" } } },
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
