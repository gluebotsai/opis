import { accountQuery } from "../plugins/account-pool.js";
import { userUuidToAccountId } from "../helpers/account-ids.js";
import { AppError } from "../helpers/response-builders.js";

/** accounts.setup_users — read only (CRM connect validation). */
export type SetupUserRow = {
  id: string;
  work_email: string;
  password_hash: string | null;
  first_name: string;
  last_name: string;
  status: string;
  organization_id: string;
};

async function loadSetupUserById(userId: string): Promise<SetupUserRow | null> {
  const accountId = userUuidToAccountId(userId);
  const { rows } = await accountQuery<SetupUserRow>(
    `SELECT id, work_email, password_hash, first_name, last_name, status, organization_id
     FROM accounts.setup_users
     WHERE id::text = $1::text
     LIMIT 1`,
    [accountId],
  );
  return rows[0] ?? null;
}

/** Step 4 — any CRM role; product_id is a string key on setup_user_product_access. */
export async function hasCrmProductAccess(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const { rows } = await accountQuery<{ ok: number }>(
    `SELECT 1 AS ok
     FROM accounts.setup_user_product_access
     WHERE user_id::text = $1::text
       AND organization_id::text = $2::text
       AND lower(product_id) = 'crm'
     LIMIT 1`,
    [userId, organizationId],
  );
  return rows.length > 0;
}

/**
 * CRM embed / API connect — steps 2–4.
 * Step 1 (JWT verify) is handled by verifyCrmAccessToken in the middleware.
 */
export async function assertCrmConnectUser(userId: string): Promise<SetupUserRow> {
  const user = await loadSetupUserById(userId);
  if (!user) {
    throw new AppError(
      "User not found in Accounts. Ensure setup_users.id matches JWT sub.",
      403,
    );
  }

  if (String(user.status).toLowerCase() !== "active") {
    throw new AppError("User account is not active.", 403);
  }

  if (!user.organization_id?.trim()) {
    throw new AppError(
      "Your account has no organization. Contact an admin to complete setup.",
      403,
    );
  }

  const crmAccess = await hasCrmProductAccess(
    String(user.id),
    String(user.organization_id),
  );
  if (!crmAccess) {
    throw new AppError(
      "CRM product access is required. User must have setup_user_product_access with product_id crm.",
      403,
    );
  }

  return user;
}

/**
 * CRM monitor/agent — acting_user_id must be an active setup_users row in the
 * requested organization. Integration key is the auth; CRM product row is not required.
 */
export async function assertCrmAutomationActor(
  userId: string,
  organizationId: string,
): Promise<SetupUserRow> {
  const user = await loadSetupUserById(userId);
  if (!user) {
    throw new AppError(
      "acting_user_id was not found in Accounts setup_users.",
      400,
    );
  }

  if (String(user.status).toLowerCase() !== "active") {
    throw new AppError("acting_user_id is not an active user.", 403);
  }

  if (String(user.organization_id).trim() !== String(organizationId).trim()) {
    throw new AppError(
      "acting_user_id does not belong to organization_id.",
      400,
    );
  }

  return user;
}

/** First active Accounts user in the org — used when CRM omits acting_user_id. */
export async function pickDefaultAutomationActor(
  organizationId: string,
): Promise<SetupUserRow> {
  const { rows } = await accountQuery<SetupUserRow>(
    `SELECT id, work_email, password_hash, first_name, last_name, status, organization_id
     FROM accounts.setup_users
     WHERE organization_id::text = $1::text
       AND lower(status) = 'active'
     ORDER BY id
     LIMIT 1`,
    [organizationId],
  );
  if (!rows[0]) {
    throw new AppError(
      "No active user in this organization. Pass acting_user_id or add an active setup_users row.",
      400,
    );
  }
  return rows[0];
}

/** Role from CRM product row — do not reject marketing vs admin. */
export async function resolveCrmRoleName(
  userId: string,
  organizationId: string,
): Promise<string> {
  const { rows } = await accountQuery<{ name: string }>(
    `SELECT r.name
     FROM accounts.setup_user_product_access a
     JOIN accounts.setup_roles r ON r.id = a.role_id
     WHERE a.user_id::text = $1::text
       AND a.organization_id::text = $2::text
       AND lower(a.product_id) = 'crm'
     ORDER BY r.name
     LIMIT 1`,
    [userId, organizationId],
  );
  return rows[0]?.name?.trim() || "user";
}
