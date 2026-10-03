export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] ?? char);
}

export async function sendLedgerEmail(to: string, subject: string, html: string) {
  if (process.env.NODE_ENV === "development" && !process.env.RESEND_API_KEY) {
    console.info(`[SaveYoRupee] ${subject} → ${to}`);
    return "logged" as const;
  }
  if (!process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM) return "unconfigured" as const;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM, to, subject, html }),
  });
  if (!response.ok) throw new Error("Could not send email.");
  return "sent" as const;
}
