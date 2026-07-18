import { prismaAdapter } from "better-auth/adapters/prisma";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getPrisma } from "./prisma";
import { removeStoredReceipts } from "./receipt-storage";

async function sendResetEmail(email: string, url: string) {
  if (process.env.NODE_ENV === "development" && !process.env.RESEND_API_KEY) {
    console.info(`[Paper Ledger] Password reset for ${email}: ${url}`);
    return;
  }
  if (!process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM) {
    throw new Error("Password reset email is not configured.");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM, to: email, subject: "Reset your Paper Ledger password", html: `<p>Use this secure link to reset your password:</p><p><a href="${url}">Reset password</a></p>` }),
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
        const receipts = await getPrisma().receiptAttachment.findMany({ where: { userId: user.id }, select: { storagePath: true } });
        await removeStoredReceipts(receipts.map((receipt) => receipt.storagePath));
      },
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  plugins: [nextCookies()],
});
