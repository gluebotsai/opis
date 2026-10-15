/**
 * Shared SQL against accounts.setup_users (+ CRM product access / org).
 * No DDL — read/update existing accounts tables only.
 */

import { accountQuery } from "@/dao/db/account-pool";
import { normalizeRole, type AppRole } from "@/service/auth/rbac";

export type SetupUserRow = {
  id: string;
  email: string;
  password_hash: string | null;
  first_name: string;
  last_name: string;
  status: string;
  organization_id: string;
  business_type: string | null;
  org_name: string | null;
  crm_role_name: string | null;
};

const SETUP_USER_SELECT = `
  u.id::text AS id,
  lower(u.work_email) AS email,
  u.password_hash,
  u.first_name,
  u.last_name,
  u.status,
  u.organization_id::text AS organization_id,
  o.business_type,
  o.company_name AS org_name,
  r.name AS crm_role_name
`;

const SETUP_USER_FROM = `
  FROM accounts.setup_users u
  LEFT JOIN accounts.organizations o ON o.id = u.organization_id
  LEFT JOIN accounts.setup_user_product_access a
    ON a.user_id = u.id AND a.product_id = 'crm'
  LEFT JOIN accounts.setup_roles r ON r.id = a.role_id
`;

export function displayNameFromSetupUser(row: {
  first_name?: string | null;
  last_name?: string | null;
  email: string;
}): string {
  const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  return name || row.email.split("@")[0] || row.email;
}

export function roleFromSetupUser(crmRoleName: string | null | undefined): AppRole {
  return normalizeRole(crmRoleName);
}

export async function getSetupUserByEmail(
  email: string,
): Promise<SetupUserRow | null> {
  const { rows } = await accountQuery<SetupUserRow>(
    `SELECT ${SETUP_USER_SELECT}
     ${SETUP_USER_FROM}
     WHERE lower(u.work_email) = lower($1)
     LIMIT 1`,
    [email.trim()],
  );
  return rows[0] ?? null;
}

export async function getSetupUserById(
  id: string,
): Promise<SetupUserRow | null> {
  const { rows } = await accountQuery<SetupUserRow>(
    `SELECT ${SETUP_USER_SELECT}
     ${SETUP_USER_FROM}
     WHERE u.id = $1::bigint
     LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listSetupUsersForOrg(
  organizationId: string,
  limit = 200,
): Promise<SetupUserRow[]> {
  const { rows } = await accountQuery<SetupUserRow>(
    `SELECT ${SETUP_USER_SELECT}
     ${SETUP_USER_FROM}
     WHERE u.status = 'active'
       AND u.organization_id = $1::bigint
     ORDER BY u.first_name, u.last_name, u.work_email
     LIMIT $2`,
    [organizationId, limit],
  );
  return rows;
}

export async function updateSetupUserPasswordHash(
  userId: string,
  passwordHash: string,
): Promise<void> {
  await accountQuery(
    `UPDATE accounts.setup_users
     SET password_hash = $2,
         password_set_at = now(),
         updated_at = now()
     WHERE id = $1::bigint`,
    [userId, passwordHash],
  );
}

export type SetupUserDelivery = {
  userId: string;
  email: string;
  displayName: string;
};

/**
 * Resolve where to deliver mail/notifications for a CRM user.
 * Prefer a connected send mailbox when work_email is missing or matches a
 * CRM contact address (common in dev when login email ≠ connected Gmail).
 */
export async function resolveSetupUserDeliveryEmail(
  userId: string,
  organizationId?: string | null,
): Promise<SetupUserDelivery | null> {
  const id = userId?.trim();
  if (!id) return null;

  const orgId = organizationId?.trim() || null;
  const { rows } = await accountQuery<{
    id: string;
    email: string | null;
    display_name: string | null;
  }>(
    `SELECT u.id::text AS id,
            lower(u.work_email) AS email,
            trim(both FROM coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS display_name
     FROM accounts.setup_users u
     WHERE u.id = $1::bigint
       AND u.status = 'active'
       AND ($2::bigint IS NULL OR u.organization_id = $2::bigint)
     LIMIT 1`,
    [id, orgId],
  );
  const row = rows[0];
  if (!row) return null;

  const displayName =
    row.display_name?.trim() ||
    row.email?.split("@")[0] ||
    "there";

  const { getCalendarConnection } = await import(
    "@/dao/calendar/token-repository"
  );
  let connectedMailbox: string | null = null;
  for (const provider of ["google", "microsoft"] as const) {
    const conn = await getCalendarConnection(id, provider);
    const mailbox = conn?.accountEmail?.trim().toLowerCase();
    if (mailbox?.includes("@")) {
      connectedMailbox = mailbox;
      break;
    }
  }

  const workEmail = row.email?.includes("@") ? row.email : null;
  const workEmailIsContact =
    workEmail != null &&
    orgId != null &&
    (await isKnownContactEmailInOrg(workEmail, orgId));

  if (connectedMailbox) {
    if (!workEmail || workEmailIsContact || workEmail !== connectedMailbox) {
      return { userId: row.id, email: connectedMailbox, displayName };
    }
  }

  if (workEmail && !workEmailIsContact) {
    return { userId: row.id, email: workEmail, displayName };
  }

  if (connectedMailbox) {
    return { userId: row.id, email: connectedMailbox, displayName };
  }

  return null;
}

/** Batch resolve configured/connected delivery emails (never login-only when OAuth exists). */
export async function resolveSetupUserDeliveryEmails(
  userIds: Array<string | null | undefined>,
  organizationId?: string | null,
): Promise<string[]> {
  const ids = [
    ...new Set(
      userIds
        .map((id) => (id == null ? "" : String(id).trim()))
        .filter(Boolean),
    ),
  ];
  const emails: string[] = [];
  for (const userId of ids) {
    const delivery = await resolveSetupUserDeliveryEmail(userId, organizationId);
    const email = delivery?.email?.trim().toLowerCase();
    if (email?.includes("@")) emails.push(email);
  }
  return [...new Set(emails)];
}

/** True when an address belongs to a CDP person in this org (customer/lead). */
export async function isKnownContactEmailInOrg(
  email: string,
  organizationId: string,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return false;
  try {
    const { rows } = await accountQuery<{ hit: number }>(
      `SELECT 1 AS hit
       FROM cdp.identity_keys k
       JOIN cdp.customer_profile p ON p.cdp_id = k.cdp_id
       JOIN crm.contact_profiles cp ON cp.account_contact_id = p.cdp_id::text
       WHERE k.key_type IN ('email', 'email_secondary')
         AND lower(k.key_value) = $1
         AND cp.organization_id = $2::bigint
       LIMIT 1`,
      [normalized, organizationId],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}
