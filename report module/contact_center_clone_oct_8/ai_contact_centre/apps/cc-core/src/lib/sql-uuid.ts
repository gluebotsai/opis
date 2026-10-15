/**
 * PostgreSQL type helpers for raw SQL.
 *
 * Prisma `$queryRaw` tagged templates bind parameters as text — cast entity
 * ids with `$N::bigint` for ccass / accounts bigint columns.
 *
 * CDP profile keys (`cdp.customer_profile.cdp_id`, `cdp.identity_keys.cdp_id`)
 * and ccass conversation/task `contact_id` columns are stored as TEXT.
 */

export type SqlPrimitive = string | number | boolean | null;

/** Normalize ccass `contact_id` or CDP keys for TEXT `cdp_id` SQL comparisons. */
export function toCdpIdText(id: string | number | bigint | null | undefined): string | null {
  if (id == null) return null;
  return String(id);
}

/** Join ccass.conversations to cdp.customer_profile on contact id. */
export const SQL_CONVERSATION_TO_CDP_CONTACT = "cp.cdp_id = c.contact_id";

/** Join ccass.conversations (alias conv) to cdp.customer_profile. */
export const SQL_CONVERSATION_ALIAS_TO_CDP_CONTACT = "cp.cdp_id = conv.contact_id";

/** Join ccass.agent_tasks to cdp.customer_profile. */
export const SQL_TASK_TO_CDP_CONTACT = "cp.cdp_id = t.contact_id";

/** Match identity_keys row to an agent task contact. */
export const SQL_TASK_TO_IDENTITY_CDP = "cdp_id = t.contact_id";
