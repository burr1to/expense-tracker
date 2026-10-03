import { prismaAdapter } from "better-auth/adapters/prisma";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { describeDevice, meaningfulIp } from "./activity-log";
import { recordActivitySafely } from "./activity-recorder";
import { getPrisma } from "./prisma";
import { removeStoredReceipts } from "./receipt-storage";

async function sendResetEmail(email: string, url: string) {
  if (process.env.NODE_ENV === "development" && !process.env.RESEND_API_KEY) {
    console.info(`[SaveYoRupee] Password reset for ${email}: ${url}`);
    return;
  }
  if (!process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM) {
    throw new Error("Password reset email is not configured.");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM, to: email, subject: "Reset your SaveYoRupee password", html: `<p>Use this secure link to reset your password:</p><p><a href="${url}">Reset password</a></p>` }),
  });
  if (!response.ok) throw new Error("Could not send password reset email.");
}

export const auth = betterAuth({
  database: prismaAdapter(getPrisma(), { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => sendResetEmail(user.email, url),
  },
  user: {
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        const db = getPrisma();
        const [attachments, scans] = await Promise.all([
          db.receiptAttachment.findMany({ where: { userId: user.id }, select: { storagePath: true } }),
          db.receiptScan.findMany({ where: { userId: user.id }, select: { storagePath: true } }),
        ]);
        await removeStoredReceipts([...attachments.map((receipt) => receipt.storagePath), ...scans.map((receipt) => receipt.storagePath)]);
      },
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  // Security events for Logs. Paths tell a deliberate sign-in or sign-out apart from session
  // housekeeping (refreshes, revocations after a password change) that the user did not do directly.
  databaseHooks: {
    user: {
      create: { after: async (user) => recordActivitySafely(user.id, { action: "account.signed_up", area: "security", title: "Created your account" }) },
    },
    session: {
      create: {
        after: async (session, context) => {
          if (context?.path !== "/sign-in/email") return;
          await recordActivitySafely(session.userId, { action: "session.signed_in", area: "security", title: "Signed in", subject: describeDevice(session.userAgent), meta: { ip: meaningfulIp(session.ipAddress) } });
        },
      },
      delete: {
        after: async (session, context) => {
          if (context?.path !== "/sign-out") return;
          await recordActivitySafely(session.userId, { action: "session.signed_out", area: "security", title: "Signed out", subject: describeDevice(session.userAgent) });
        },
      },
    },
    account: {
      update: {
        after: async (account, context) => {
          if (context?.path === "/change-password") await recordActivitySafely(account.userId, { action: "password.changed", area: "security", title: "Changed your password", subject: "Other devices were signed out" });
          else if (context?.path === "/reset-password") await recordActivitySafely(account.userId, { action: "password.reset", area: "security", title: "Reset your password", subject: "All devices were signed out" });
        },
      },
    },
  },
  plugins: [nextCookies()],
});

export async function getAuthenticatedSession(requestHeaders: Headers) {
  return auth.api.getSession({ headers: requestHeaders });
}
