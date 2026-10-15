/**
 * Smoke: concurrent login blocked; public force takeover disabled; admin force-logout unlocks.
 */
import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { loginUser, logoutUser, signInAccount } from "../src/modules/auth/session-auth.js";
import { getSession, SESSION_TTL_MS } from "../src/modules/auth/sessions.js";
import { AUTH_SESSION_TTL_MS } from "../src/modules/auth/session-ttl.js";
import { forceLogoutUserByAdmin, hashPassword } from "../src/modules/users/user-store.js";
import {
  SESSION_ALREADY_ACTIVE_CODE,
  isSessionAlreadyActiveError,
} from "../src/modules/auth/session-concurrency.js";

const marker = `single-session-${Date.now()}`;
const salesEmail = `sales-${marker}@example.com`;
const password = "SingleSessionPass1!";

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
     RETURNING id, email`,
    [email.toLowerCase(), hashed, "Single Session Smoke"],
  );
  return rows[0];
}

async function cleanup(userId, email) {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM auth_sessions WHERE lower(email) = lower($1)`, [email]);
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
    console.error("[smoke-test-single-session] DATABASE_URL is not set");
    process.exit(1);
  }

  assert(SESSION_TTL_MS === AUTH_SESSION_TTL_MS, "SESSION_TTL_MS should match AUTH_SESSION_TTL_MS");
  assert(AUTH_SESSION_TTL_MS === 24 * 60 * 60 * 1000, "Expected 24-hour AUTH_SESSION_TTL_MS");

  await migrateDatabase();
  let userId = null;

  try {
    const user = await ensureSalesUser(salesEmail);
    userId = user.id;
    await query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);

    const first = await loginUser(salesEmail, password);
    assert(first?.token, "First login should return a token");
    assert(await getSession(first.token), "First session should be readable");

    let blocked = false;
    try {
      await loginUser(salesEmail, password);
    } catch (error) {
      blocked = isSessionAlreadyActiveError(error);
      assert(error.code === SESSION_ALREADY_ACTIVE_CODE, "Expected session_already_active code");
    }
    assert(blocked, "Second login should be blocked");
    assert(await getSession(first.token), "First session must remain active after blocked login");

    let publicForceBlocked = false;
    try {
      await loginUser(salesEmail, password, { forceLogoutOtherSession: true });
    } catch (error) {
      // options ignored; still blocked
      publicForceBlocked = isSessionAlreadyActiveError(error);
    }
    assert(publicForceBlocked, "Public forceLogoutOtherSession must not unlock the session");
    assert(await getSession(first.token), "First session must survive ignored public force flag");

    let signInBlocked = false;
    try {
      await signInAccount(salesEmail, password);
    } catch (error) {
      signInBlocked = isSessionAlreadyActiveError(error);
    }
    assert(signInBlocked, "sign-in must also block concurrent session");

    const adminResult = await forceLogoutUserByAdmin(userId);
    assert(adminResult?.ok === true, "Admin force logout should return ok");
    assert(!(await getSession(first.token)), "Admin force logout must revoke prior session");

    const afterAdmin = await loginUser(salesEmail, password);
    assert(afterAdmin?.token, "Login after admin force logout should succeed");
    assert(afterAdmin.token !== first.token, "New login should mint a different token");

    await logoutUser(afterAdmin.token);
    console.log("[smoke-test-single-session] PASS");
  } finally {
    await cleanup(userId, salesEmail);
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error(
    "[smoke-test-single-session] FAIL:",
    error instanceof Error ? error.message : error,
  );
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
