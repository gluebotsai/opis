/**
 * Drop campaign engagement columns from shared my_account_qa.contacts.
 * Those fields live in campaign_db.campaign_contact_engagement instead.
 * Run: npx tsx scripts/drop-account-contact-engagement.ts
 */
import "dotenv/config";
import { accountPool } from "../src/plugins/account-pool.js";

async function main() {
  await accountPool.query(`
    ALTER TABLE public.contacts
      DROP COLUMN IF EXISTS email_unsubscribed,
      DROP COLUMN IF EXISTS email_unsubscribed_at,
      DROP COLUMN IF EXISTS email_unsubscribe_reason,
      DROP COLUMN IF EXISTS last_email_opened_at,
      DROP COLUMN IF EXISTS last_email_clicked_at,
      DROP COLUMN IF EXISTS email_open_count,
      DROP COLUMN IF EXISTS email_click_count;
  `);
  console.log("Dropped campaign engagement columns from public.contacts");
  await accountPool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await accountPool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
