import "dotenv/config";
import { accountQuery } from "../src/plugins/account-pool.js";

async function main() {
  const { rows } = await accountQuery(
    `SELECT id::text, work_email, status FROM accounts.setup_users
     WHERE lower(work_email) LIKE '%aravindh%' OR id::text IN ('1027')
     ORDER BY id`,
  );
  console.log(JSON.stringify(rows, null, 2));
}

main().catch(console.error);
