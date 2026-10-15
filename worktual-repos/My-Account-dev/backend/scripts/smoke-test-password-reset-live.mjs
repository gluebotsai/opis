/**
 * Live smoke: send a real password-reset OTP for a temporary sales user.
 *
 * Requires:
 *   LIVE_OTP_SMOKE=1
 *   MAIL_DRY_RUN=false (or unset)
 *   Working Graph admin mail (app-only or delegated)
 *
 * Usage:
 *   LIVE_OTP_SMOKE=1 node scripts/smoke-test-password-reset-live.mjs
 *
 * After PASS, check admin Sent Items for subject: "Your Worktual password reset code"
 * Then restart the mail API before testing Forgot password in the UI with a non-admin email.
 */
import "../src/config/load-env.js";

if (process.env.LIVE_OTP_SMOKE !== "1") {
  console.error(
    "[smoke-test-password-reset-live] Refusing to run. Set LIVE_OTP_SMOKE=1 to send a real OTP email.",
  );
  process.exit(1);
}

if (process.env.MAIL_DRY_RUN === "true") {
  console.error(
    "[smoke-test-password-reset-live] MAIL_DRY_RUN=true. Set MAIL_DRY_RUN=false for a live send.",
  );
  process.exit(1);
}

import { migrateDatabase } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { hashPassword } from "../src/modules/users/user-store.js";
import {
  requestPasswordResetOtp,
  resolvePasswordResetAccount,
} from "../src/modules/auth/password-reset.js";
import { isMailDryRun } from "../src/modules/mail/config.js";

const marker = `pwd-reset-live-${Date.now()}`;
const salesEmail = `sales-${marker}@example.com`;
const password = "LiveSmokePass1!";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureSalesUser(email) {
  const hashed = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO users (email, password, role, display_name, department, is_active, created_by, updated_by)
     VALUES ($1, $2, 'sales', $3, 'Sales', TRUE, 'smoke-test', 'smoke-test')
     ON CONFLICT (email) DO UPDATE SET
       password = EXCLUDED.password,
       role = 'sales',
       is_active = TRUE,
       updated_at = NOW()
     RETURNING id, email, role`,
    [email.toLowerCase(), hashed, "Live OTP Smoke Sales"],
  );
  return rows[0];
}

async function cleanup(userId, email) {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM password_reset_otps WHERE lower(email) = lower($1)`, [email]);
    if (userId) {
      await client.query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-password-reset-live] DATABASE_URL is not set");
    process.exit(1);
  }

  assert(isMailDryRun() === false, "Expected MAIL_DRY_RUN=false for live OTP smoke");

  console.log("[smoke-test-password-reset-live] LIVE mode — will send real Graph mail");
  console.log(`[smoke-test-password-reset-live] sales recipient: ${salesEmail}`);
  console.log(
    "[smoke-test-password-reset-live] Look in ADMIN_EMAIL Sent Items for: Your Worktual password reset code",
  );

  await migrateDatabase();

  let userId = null;
  try {
    const sales = await ensureSalesUser(salesEmail);
    userId = sales.id;

    const account = await resolvePasswordResetAccount(salesEmail);
    assert(account?.accountType === "internal", "Sales account should resolve");
    assert(!account.blocked, "Sales must not be blocked");

    const result = await requestPasswordResetOtp(salesEmail);
    assert(result.ok === true, "OTP request should return ok");
    assert(!result.dryRunOtp, "Live send must not return dryRunOtp");

    const { rows: otps } = await query(
      `SELECT id, account_type FROM password_reset_otps
       WHERE lower(email) = lower($1) AND consumed_at IS NULL`,
      [salesEmail],
    );
    assert(otps.length === 1, "Expected one open OTP row after successful live send");

    console.log("[smoke-test-password-reset-live] PASS — Graph OTP send succeeded");
    console.log(
      "[smoke-test-password-reset-live] Next: restart mail API, then Forgot password with a non-admin email only (not ADMIN_EMAIL).",
    );
  } finally {
    await cleanup(userId, salesEmail);
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error(
    "[smoke-test-password-reset-live] FAIL:",
    error instanceof Error ? error.message : error,
  );
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
