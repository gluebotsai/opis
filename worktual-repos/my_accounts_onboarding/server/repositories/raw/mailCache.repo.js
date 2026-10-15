import { query } from "../../db/pool.js";

export async function selectFolderCache(profile, folder) {
  const { rows } = await query(
    `SELECT messages, synced_at
     FROM mail_folder_cache
     WHERE profile = $1 AND folder = $2`,
    [profile, folder],
  );
  return rows[0] || null;
}

export async function upsertFolderCache(profile, folder, messagesJson) {
  await query(
    `INSERT INTO mail_folder_cache (profile, folder, messages, synced_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (profile, folder)
     DO UPDATE SET messages = EXCLUDED.messages, synced_at = NOW()`,
    [profile, folder, messagesJson],
  );
}
