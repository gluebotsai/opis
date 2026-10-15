import { accountQuery } from "../plugins/account-pool.js";
import type { DailyReportRecipient } from "../services/daily-report/types.js";

type UserRow = {
  id: string;
  work_email: string;
  first_name: string | null;
  last_name: string | null;
  organization_id: string;
};

/** Login users with Campaign product access — new rows appear automatically on next tick. */
const CAMPAIGN_PRODUCT_RECIPIENT_SQL = `
  SELECT DISTINCT ON (u.id)
         u.id::text AS id,
         u.work_email,
         u.first_name,
         u.last_name,
         u.organization_id::text AS organization_id
  FROM accounts.setup_users u
  INNER JOIN accounts.setup_user_product_access a
    ON a.user_id = u.id
   AND a.organization_id = u.organization_id
  WHERE lower(coalesce(u.status, '')) = 'active'
    AND coalesce(trim(u.work_email), '') <> ''
    AND lower(a.product_id) = 'campaign'
`;

function toDailyReportRecipient(row: UserRow): DailyReportRecipient {
  const first = String(row.first_name || "").trim();
  const last = String(row.last_name || "").trim();
  const displayName =
    [first, last].filter(Boolean).join(" ").trim() ||
    row.work_email.split("@")[0];
  return {
    userId: String(row.id),
    organizationId: String(row.organization_id),
    email: String(row.work_email).trim(),
    firstName: first,
    lastName: last,
    displayName,
  };
}

export async function listDailyReportRecipients(): Promise<DailyReportRecipient[]> {
  const { rows } = await accountQuery<UserRow>(
    `${CAMPAIGN_PRODUCT_RECIPIENT_SQL}
     ORDER BY u.id, u.organization_id`,
  );
  return rows.map(toDailyReportRecipient);
}

export async function getDailyReportRecipient(
  userId: string,
): Promise<DailyReportRecipient | null> {
  const { rows } = await accountQuery<UserRow>(
    `${CAMPAIGN_PRODUCT_RECIPIENT_SQL}
       AND u.id::text = $1
     ORDER BY u.id, u.organization_id
     LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  return row ? toDailyReportRecipient(row) : null;
}

export async function loadOrganizationName(
  organizationId: string,
): Promise<string | null> {
  const { rows } = await accountQuery<{ company_name: string | null }>(
    `SELECT company_name
     FROM accounts.organizations
     WHERE id::text = $1
     LIMIT 1`,
    [organizationId],
  );
  return rows[0]?.company_name?.trim() || null;
}
