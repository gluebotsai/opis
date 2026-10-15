/**
 * Shared ticket_number allocation (unique per organization).
 * Each org's first ticket is #1 (or `{ticket_prefix}1`).
 */
import { pool } from "./db";

/** Namespace for pg_advisory_xact_lock(key1, key2) — key2 is hashtext(orgId). */
const TICKET_NUMBER_LOCK_NS = 87201442;

export async function nextTicketNumber(orgId: string): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT pg_advisory_xact_lock($1, hashtext($2::text))`,
      [TICKET_NUMBER_LOCK_NS, String(orgId)]
    );
    const pref = await client.query(
      `SELECT ticket_prefix FROM ticketing.org_settings WHERE organization_id = $1::bigint`,
      [orgId]
    );
    const rawPrefix = String(pref.rows[0]?.ticket_prefix ?? "#").trim() || "#";
    const prefix = rawPrefix.slice(0, 8);
    const { rows } = await client.query<{ max: string | null }>(
      `SELECT MAX(NULLIF(regexp_replace(ticket_number, '\\D', '', 'g'), '')::bigint)::text AS max
       FROM tickets
       WHERE organization_id = $1::bigint`,
      [orgId]
    );
    const last = rows[0]?.max ? Number(rows[0].max) : 0;
    let n = last + 1;
    let ticketNumber = `${prefix}${n}`;
    for (let i = 0; i < 20; i++) {
      const clash = await client.query(
        `SELECT 1 FROM tickets
         WHERE organization_id = $1::bigint AND ticket_number = $2
         LIMIT 1`,
        [orgId, ticketNumber]
      );
      if (!clash.rows[0]) break;
      n += 1;
      ticketNumber = `${prefix}${n}`;
    }
    await client.query("COMMIT");
    return ticketNumber;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}
