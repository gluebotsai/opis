import { accountQuery } from "@/dao/db/account-pool";

async function main() {
  const cols = await accountQuery(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'accounts' AND table_name = 'auth_sessions'
     ORDER BY ordinal_position`,
  );
  console.log("auth_sessions", cols.rows);

  const fk = await accountQuery(
    `SELECT pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'accounts' AND t.relname = 'auth_sessions' AND c.contype = 'f'`,
  );
  console.log("fks", fk.rows);

  const setupCols = await accountQuery(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'accounts' AND table_name = 'setup_users'
     ORDER BY ordinal_position`,
  );
  console.log("setup_users columns", setupCols.rows.map((r) => r.column_name));

  const sample = await accountQuery(
    `SELECT s.token, s.user_id::text, s.email, s.product_id, u.id::text AS setup_id
     FROM accounts.auth_sessions s
     LEFT JOIN accounts.setup_users u ON lower(u.work_email) = lower(s.email)
     WHERE s.product_id = 'crm'
     ORDER BY s.expires_at DESC
     LIMIT 3`,
  );
  console.log("sample crm sessions", sample.rows);
}

main().catch(console.error);
