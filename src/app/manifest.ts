import type { MetadataRoute } from "next";
import { APP_BACKGROUND_COLOR, APP_THEME_COLOR } from "./icons/brand-art";

const shortcutIcon = [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }];

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "SaveYoRupee",
    short_name: "SaveYoRupee",
    description: "A calm, private personal expense and income tracker.",
    lang: "en",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: APP_BACKGROUND_COLOR,
    theme_color: APP_THEME_COLOR,
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Add expense", short_name: "Expense", url: "/?add=expense", icons: shortcutIcon },
      { name: "Add income", short_name: "Income", url: "/?add=income", icons: shortcutIcon },
      { name: "Paste bank SMS", short_name: "Bank SMS", url: "/?add=sms", icons: shortcutIcon },
    ],
    // Sharing a bank SMS into the app opens the SMS sheet with the text filled in.
    share_target: { action: "/", method: "GET", params: { text: "sms", title: "title" } },
  };
}
