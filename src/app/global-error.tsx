"use client";

import { useEffect, type CSSProperties } from "react";
import { BRAND_MARK_PATH } from "../lib/brand-mark";

// The root layout (and its stylesheet) is gone when this renders, so it carries its own styles.
const palette = { paper: "#f2efe2", paperStrong: "#faf8ee", ink: "#24332b", muted: "#5c6e63", line: "#cbd3c9", blue: "#557f69" };
const styles: Record<string, CSSProperties> = {
  body: { margin: 0, minHeight: "100svh", display: "grid", placeItems: "center", padding: "max(24px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom))", boxSizing: "border-box", background: palette.paper, color: palette.ink, fontFamily: "\"IBM Plex Sans Variable\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif" },
  card: { width: "min(100%, 360px)", boxSizing: "border-box", padding: 24, border: `1px solid ${palette.line}`, borderRadius: 18, background: palette.paperStrong, boxShadow: "0 18px 48px rgba(36,51,43,.1)" },
  brand: { display: "flex", alignItems: "center", gap: 11, marginBottom: 20, fontWeight: 700 },
  title: { margin: "0 0 8px", fontSize: 22, fontWeight: 650 },
  text: { margin: "0 0 20px", color: palette.muted, fontSize: 14, lineHeight: 1.55 },
  code: { display: "block", margin: "-10px 0 18px", color: palette.muted, fontSize: 12 },
  actions: { display: "flex", gap: 10, flexWrap: "wrap" },
  primary: { flex: "1 1 140px", minHeight: 44, padding: "0 18px", border: 0, borderRadius: 10, background: palette.blue, color: "#fff", font: "inherit", fontWeight: 750, cursor: "pointer" },
  secondary: { flex: "1 1 140px", minHeight: 44, padding: "0 18px", border: `1px solid ${palette.line}`, borderRadius: 10, background: palette.paperStrong, color: palette.ink, font: "inherit", fontWeight: 750, cursor: "pointer" },
};

/** Last line of defence: an error in the root layout itself. It must render its own <html> and <body>. */
export default function GlobalError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <html lang="en">
    <body style={styles.body}>
      <title>Something went wrong · SaveYoRupee</title>
      <main style={styles.card} role="alert">
        <div style={styles.brand}>
          <svg viewBox="0 0 256 256" width="38" height="38" aria-hidden="true"><defs><linearGradient id="syr-error-bg" x1="32" y1="24" x2="224" y2="240" gradientUnits="userSpaceOnUse"><stop stopColor="#32A66A" /><stop offset="1" stopColor="#0B5D38" /></linearGradient></defs><rect width="256" height="256" rx="68" fill="#10231B" /><rect x="12" y="12" width="232" height="232" rx="56" fill="url(#syr-error-bg)" /><path d={BRAND_MARK_PATH} fill="#F7FFF9" /></svg>
          <span>SaveYoRupee</span>
        </div>
        <h1 style={styles.title}>Something went wrong</h1>
        <p style={styles.text}>The app ran into a problem it didn’t expect. Everything you saved is safe. Try again, or reload the app.</p>
        {error.digest && <small style={styles.code}>Reference {error.digest}</small>}
        <div style={styles.actions}>
          <button type="button" style={styles.primary} onClick={() => unstable_retry()}>Try again</button>
          <button type="button" style={styles.secondary} onClick={() => window.location.reload()}>Reload</button>
        </div>
      </main>
    </body>
  </html>;
}
