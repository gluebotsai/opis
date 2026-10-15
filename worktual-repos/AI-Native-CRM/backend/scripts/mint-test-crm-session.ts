/**
 * Mint a CRM session cookie token for browser tests (does not print email).
 * run: cd backend && npx tsx --env-file=../.env scripts/mint-test-crm-session.ts
 * stdout: token=<hex>
 */
import { accountQuery } from "@/dao/db/account-pool";
import {
  deleteCrmSessionsForEmail,
  establishCrmLoginSession,
  sessionExpiresAt,
} from "@/service/account/auth-sessions";

const mode = process.argv[2] || "mint";

async function subject() {
  const { rows } = await accountQuery<{ email: string; user_id: string }>(
    `SELECT lower(u.work_email) AS email, u.id::text AS user_id
     FROM accounts.setup_users u
     INNER JOIN accounts.users usr ON usr.id = u.id
     INNER JOIN accounts.setup_user_product_access a
       ON a.user_id = u.id AND a.product_id = 'crm'
     WHERE u.status = 'active'
     ORDER BY u.id ASC
     LIMIT 1`,
  );
  const row = rows[0];
  if (!row) throw new Error("no test user");
  return row;
}

async function main() {
  const { email, user_id: userId } = await subject();
  if (mode === "force") {
    const forced = await establishCrmLoginSession({
      email,
      role: "admin",
      displayName: "Browser B",
      userId,
      expiresAt: sessionExpiresAt(false),
      force: true,
    });
    console.log(`token=${forced.token}`);
    console.log(`replaced=${forced.replaced}`);
    return;
  }
  await deleteCrmSessionsForEmail(email);
  const minted = await establishCrmLoginSession({
    email,
    role: "admin",
    displayName: "Browser A",
    userId,
    expiresAt: sessionExpiresAt(false),
    force: false,
  });
  console.log(`token=${minted.token}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
