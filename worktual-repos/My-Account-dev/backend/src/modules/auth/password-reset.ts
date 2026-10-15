import crypto from "node:crypto";

import { sendEmail } from "../mail/mail-runtime.js";
import { isMailDryRun } from "../mail/config.js";
import { resolveAdminMailContext } from "../notifications/service.js";
import { validatePasswordPolicy } from "./password-policy.js";
import { invalidateUserSessions } from "./sessions.js";
import { hashPassword, USER_ROLES } from "../users/user-store.js";
import { selectActiveUserByEmail, updateUserPassword } from "../../repositories/raw/users.repo.js";
import * as customerAuthRepo from "../../repositories/raw/customerAuth.repo.js";
import * as partnerAuthRepo from "../../repositories/raw/partnerAuth.repo.js";
import * as resellerAuthRepo from "../../repositories/raw/resellerAuth.repo.js";
import * as passwordResetRepo from "../../repositories/raw/passwordReset.repo.js";

const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const GENERIC_REQUEST_MESSAGE =
  "If an account exists for that email, a 6-digit code was sent from the admin mailbox.";

function normalizeEmail(email: any) {
  return String(email || "").trim().toLowerCase();
}

function hashSecret(value: any) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Resolve resettable account in the same priority as unified sign-in.
 * Platform admin accounts are never eligible.
 */
export async function resolvePasswordResetAccount(email: any) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return null;
  }

  const internal = await selectActiveUserByEmail(normalizedEmail);
  if (internal) {
    if (internal.role === USER_ROLES.ADMIN) {
      return { blocked: true, reason: "admin" };
    }
    return {
      accountType: "internal",
      accountId: String(internal.id),
      email: normalizedEmail,
      displayName: internal.display_name || "",
    };
  }

  const reseller = await resellerAuthRepo.selectActiveResellerUserByEmail(normalizedEmail);
  if (reseller) {
    return {
      accountType: "reseller",
      accountId: String(reseller.id),
      email: normalizedEmail,
      displayName: reseller.display_name || "",
    };
  }

  const partner = await partnerAuthRepo.selectActivePartnerUserByEmail(normalizedEmail);
  if (partner) {
    return {
      accountType: "partner",
      accountId: String(partner.id),
      email: normalizedEmail,
      displayName: partner.display_name || "",
    };
  }

  const customers = await customerAuthRepo.selectActiveCustomerUsersByEmail(normalizedEmail);
  if (customers?.[0]) {
    return {
      accountType: "customer",
      accountId: String(customers[0].id),
      email: normalizedEmail,
      displayName: customers[0].display_name || "",
    };
  }

  return null;
}

async function sendOtpFromAdminMailbox(toEmail: any, otpCode: any, displayName: any) {
  let mailContext;
  try {
    mailContext = await resolveAdminMailContext();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Admin mailbox is not available for password reset.";
    const wrapped = new Error(
      message.includes("ADMIN_EMAIL")
        ? "Password reset is unavailable: ADMIN_EMAIL is not configured."
        : "Password reset is unavailable: connect the admin Outlook mailbox, then try again.",
    );
    (wrapped as any).code =
      (error as any)?.code === "admin_email_missing" ? "admin_email_missing" : "admin_mailbox_unavailable";
    throw wrapped;
  }

  const greetingName = displayName || "there";
  const sendMode = mailContext.sendMode || (mailContext.accountId ? "delegated" : "unknown");

  console.info(
    `[password-reset] using sendMode=${sendMode} from=${mailContext.accountEmail || "unknown"} to=${toEmail}`,
  );

  try {
    await sendEmail(
      {
        to: [toEmail],
        subject: "Your Worktual password reset code",
        body: [
          `Dear ${greetingName},`,
          "",
          "Use this 6-digit code to reset your Worktual portal password:",
          "",
          otpCode,
          "",
          "This code expires in 10 minutes. If you did not request a reset, you can ignore this email.",
          "",
          "Best regards,",
          "Worktual Admin",
        ].join("\n"),
        mailbox: mailContext.mailboxProfile,
      },
      mailContext.mailboxProfile,
      (mailContext as any),
    );
  } catch (error) {
    console.error(
      `[password-reset] mail_failed to=${toEmail}:`,
      error instanceof Error ? error.message : error,
    );
    const wrapped = new Error(
      "Could not send the reset code from the admin mailbox. Try again later or contact support.",
    );
    (wrapped as any).code = "admin_mailbox_unavailable";
    throw wrapped;
  }
}

export async function requestPasswordResetOtp(email: any) {
  const normalizedEmail = normalizeEmail(email);
  const account = await resolvePasswordResetAccount(normalizedEmail);

  if (!account) {
    console.info(`[password-reset] skipped reason=not_found email=${normalizedEmail || "(empty)"}`);
    throw new Error("No account found for this email. Check the address or contact your admin.");
  }

  if (account.blocked) {
    console.info(
      `[password-reset] skipped reason=${account.reason || "blocked"} email=${normalizedEmail}`,
    );
    return { ok: true, message: GENERIC_REQUEST_MESSAGE };
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  await passwordResetRepo.invalidateOpenPasswordResets(account.email);
  await passwordResetRepo.insertPasswordResetOtp([
    account.email,
    account.accountType,
    account.accountId,
    hashSecret(otp),
    expiresAt,
  ]);

  try {
    await sendOtpFromAdminMailbox(account.email, otp, account.displayName);
  } catch (error) {
    await passwordResetRepo.invalidateOpenPasswordResets(account.email);
    throw error;
  }

  console.info(
    `[password-reset] otp sent accountType=${account.accountType} email=${account.email}`,
  );

  return {
    ok: true,
    message: "A 6-digit code was sent to your email.",
    // Only exposed when MAIL_DRY_RUN=true so smoke tests can complete the flow.
    ...(isMailDryRun() ? { dryRunOtp: otp } : {}),
  };
}

export async function verifyPasswordResetOtp(email: any, otp: any) {
  const normalizedEmail = normalizeEmail(email);
  const otpCode = String(otp || "").trim();

  if (!/^\d{6}$/.test(otpCode)) {
    throw new Error("Enter the 6-digit code from your email.");
  }

  const row = await passwordResetRepo.selectLatestOpenPasswordReset(normalizedEmail);
  if (!row) {
    throw new Error("Invalid or expired code. Request a new one.");
  }

  if (Number(row.attempts) >= MAX_OTP_ATTEMPTS) {
    await passwordResetRepo.consumePasswordReset(row.id);
    throw new Error("Too many invalid attempts. Request a new code.");
  }

  if (row.otp_hash !== hashSecret(otpCode)) {
    await passwordResetRepo.incrementPasswordResetAttempts(row.id);
    throw new Error("Invalid or expired code. Try again.");
  }

  const resetToken = generateResetToken();
  const resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  await passwordResetRepo.attachPasswordResetToken(
    row.id,
    hashSecret(resetToken),
    resetTokenExpiresAt,
  );

  return {
    ok: true,
    resetToken,
    expiresAt: resetTokenExpiresAt,
  };
}

async function applyPasswordReset(accountType: any, accountId: any, email: any, newPassword: any) {
  validatePasswordPolicy(newPassword);
  const hashed = await hashPassword(newPassword);

  if (accountType === "internal") {
    await updateUserPassword(accountId, hashed);
    await invalidateUserSessions(accountId);
    return;
  }

  if (accountType === "reseller") {
    await resellerAuthRepo.updateResellerPassword(accountId, hashed);
    await resellerAuthRepo.deleteResellerSessionsForUser(accountId);
    return;
  }

  if (accountType === "partner") {
    await partnerAuthRepo.updatePartnerPassword(accountId, hashed);
    await partnerAuthRepo.deletePartnerSessionsForUser(accountId);
    return;
  }

  if (accountType === "customer") {
    await customerAuthRepo.updateCustomerPasswordByEmail(email, hashed);
    await customerAuthRepo.deleteCustomerAuthSessionsByEmail(email);
    return;
  }

  throw new Error("Unsupported account type for password reset.");
}

export async function confirmPasswordReset({ email, resetToken, password }: any) {
  const normalizedEmail = normalizeEmail(email);
  const token = String(resetToken || "").trim();
  const newPassword = String(password || "");

  if (!token) {
    throw new Error("Reset session expired. Verify your code again.");
  }

  validatePasswordPolicy(newPassword);

  const row = await passwordResetRepo.selectOpenPasswordResetByToken(
    normalizedEmail,
    hashSecret(token),
  );
  if (!row) {
    throw new Error("Reset session expired. Request a new code.");
  }

  // Re-check admin is still ineligible.
  if (row.account_type === "internal") {
    const user = await selectActiveUserByEmail(normalizedEmail);
    if (!user || user.role === USER_ROLES.ADMIN) {
      await passwordResetRepo.consumePasswordReset(row.id);
      throw new Error("This account cannot use password reset.");
    }
  }

  await applyPasswordReset(row.account_type, row.account_id, normalizedEmail, newPassword);
  await passwordResetRepo.consumePasswordReset(row.id);

  return { ok: true, message: "Password updated. Sign in with your new password." };
}
