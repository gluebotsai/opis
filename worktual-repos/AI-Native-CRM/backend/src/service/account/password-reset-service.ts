import crypto from "crypto";
import bcrypt from "bcryptjs";
import { accountQuery } from "@/dao/db/account-pool";
import {
  getSetupUserByEmail,
  updateSetupUserPasswordHash,
} from "@/service/account/setup-users";

const TOKEN_TTL_MS = 60 * 60 * 1000;

type ResetTokenRow = {
  id: string;
  user_id: string;
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

/** Token store lives in crm schema (accounts is DDL-locked). */
async function ensureResetTokenTable(): Promise<void> {
  await accountQuery(`
    CREATE TABLE IF NOT EXISTS crm.password_reset_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      email varchar(255) NOT NULL,
      token_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await accountQuery(`
    CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx
      ON crm.password_reset_tokens (user_id)
  `);
}

async function sendPasswordResetEmail(args: {
  to: string;
  resetUrl: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from =
    process.env.PASSWORD_RESET_FROM_EMAIL?.trim() ||
    "Worktual <onboarding@resend.dev>";

  if (apiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [args.to],
          subject: "Reset your Worktual CRM password",
          html: `
            <p>You requested a password reset for Worktual CRM.</p>
            <p><a href="${args.resetUrl}">Reset your password</a></p>
            <p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>
          `,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  if (process.env.NODE_ENV === "development") {
    console.info(`[password-reset] Reset link for ${args.to}: ${args.resetUrl}`);
    return true;
  }

  console.warn(
    `[password-reset] No RESEND_API_KEY — could not email ${args.to}. Set RESEND_API_KEY or use dev mode.`,
  );
  return false;
}

export async function requestPasswordReset(email: string): Promise<
  | { ok: true; devResetUrl?: string }
  | { ok: false; error: string }
> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const user = await getSetupUserByEmail(normalized);
  if (!user || user.status !== "active") {
    return { ok: true };
  }

  await ensureResetTokenTable();

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await accountQuery(
    `DELETE FROM crm.password_reset_tokens
     WHERE user_id = $1::bigint AND used_at IS NULL`,
    [user.id],
  );

  await accountQuery(
    `INSERT INTO crm.password_reset_tokens (user_id, email, token_hash, expires_at)
     VALUES ($1::bigint, $2, $3, $4)`,
    [user.id, user.email, tokenHash, expiresAt.toISOString()],
  );

  const resetUrl = `${appBaseUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`;
  await sendPasswordResetEmail({ to: user.email, resetUrl });

  if (process.env.NODE_ENV === "development") {
    return { ok: true, devResetUrl: resetUrl };
  }

  return { ok: true };
}

export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = token.trim();
  if (!trimmed) {
    return { ok: false, error: "Reset link is invalid or expired." };
  }
  if (newPassword.trim().length < 4) {
    return { ok: false, error: "Password must be at least 4 characters." };
  }

  await ensureResetTokenTable();

  const tokenHash = hashToken(trimmed);
  const { rows } = await accountQuery<ResetTokenRow>(
    `SELECT id::text AS id, user_id::text AS user_id
     FROM crm.password_reset_tokens
     WHERE token_hash = $1
       AND used_at IS NULL
       AND expires_at > now()
     LIMIT 1`,
    [tokenHash],
  );

  const row = rows[0];
  if (!row) {
    return { ok: false, error: "Reset link is invalid or expired." };
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  try {
    await updateSetupUserPasswordHash(row.user_id, passwordHash);
  } catch {
    return { ok: false, error: "Account not found or inactive." };
  }

  await accountQuery(
    `UPDATE crm.password_reset_tokens SET used_at = now() WHERE id = $1`,
    [row.id],
  );

  await accountQuery(
    `DELETE FROM crm.password_reset_tokens
     WHERE user_id = $1::bigint AND used_at IS NULL`,
    [row.user_id],
  );

  return { ok: true };
}
