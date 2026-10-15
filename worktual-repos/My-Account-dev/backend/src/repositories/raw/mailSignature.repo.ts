import { query } from "../../db/pool.js";

const SIGNATURE_COLUMNS = `account_type, account_id, mailbox_profile, html_body, updated_at`;

export async function selectMailSignature(accountType: any, accountId: any, mailboxProfile: any) {
  const { rows } = await query(
    `SELECT ${SIGNATURE_COLUMNS}
     FROM mail_signatures
     WHERE account_type = $1 AND account_id = $2 AND mailbox_profile = $3`,
    [accountType || "internal", accountId, mailboxProfile],
  );
  return rows[0] || null;
}

export async function upsertMailSignature(accountType: any, accountId: any, mailboxProfile: any, htmlBody: any) {
  const { rows } = await query(
    `INSERT INTO mail_signatures (account_type, account_id, mailbox_profile, html_body, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (account_type, account_id, mailbox_profile)
     DO UPDATE SET html_body = EXCLUDED.html_body, updated_at = NOW()
     RETURNING ${SIGNATURE_COLUMNS}`,
    [accountType || "internal", accountId, mailboxProfile, htmlBody || ""],
  );
  return rows[0] || null;
}
