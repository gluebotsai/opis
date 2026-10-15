import { query } from "../../db/pool.js";

function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  return query;
}

function isMissingMustChangePasswordColumn(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "").toLowerCase();
  return (
    code === "42703" ||
    (message.includes("must_change_password") && message.includes("does not exist"))
  );
}

export async function selectAccessGrantsForCustomer(runner: any, customerUserId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT g.*, s.product_id, s.branch_id
     FROM product_access_grants g
     JOIN subscriptions s ON s.id = g.subscription_id
     WHERE g.customer_user_id = $1`,
    [customerUserId],
  );
  return rows;
}

export async function selectOrganizationLocationLabel(runner: any, branchId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT label FROM organization_locations WHERE id = $1 LIMIT 1`,
    [branchId],
  );
  return rows[0]?.label || null;
}

export async function selectOrganizationLocationById(runner: any, organizationId: any, branchId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM organization_locations
     WHERE organization_id = $1 AND id = $2
     LIMIT 1`,
    [organizationId, branchId],
  );
  return rows[0] || null;
}

export async function selectActiveSubscriptionsByOrganization(runner: any, organizationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, branch_id FROM subscriptions WHERE organization_id = $1 AND status = 'active'`,
    [organizationId],
  );
  return rows;
}

export async function insertProductAccessGrant(runner: any, customerUserId: any, subscriptionId: any) {
  await runnerQuery(runner).query(
    `INSERT INTO product_access_grants (customer_user_id, subscription_id, role)
     VALUES ($1, $2, 'user')
     ON CONFLICT (customer_user_id, subscription_id) DO NOTHING`,
    [customerUserId, subscriptionId],
  );
}

export async function deleteProductAccessGrantsOutsideLocation(
  runner: any,
  customerUserId: any,
  organizationId: any,
  branchId: any,
) {
  await runnerQuery(runner).query(
    `DELETE FROM product_access_grants
     WHERE customer_user_id = $1
       AND subscription_id IN (
         SELECT id FROM subscriptions
         WHERE organization_id = $2 AND branch_id <> $3
       )`,
    [customerUserId, organizationId, branchId],
  );
}

export async function selectActiveCustomerUsersByOrganization(runner: any, organizationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM customer_users WHERE organization_id = $1 AND is_active = TRUE`,
    [organizationId],
  );
  return rows;
}

export async function selectCustomerUserByOrganizationEmail(runner: any, organizationId: any, email: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM customer_users WHERE organization_id = $1 AND email = $2 LIMIT 1`,
    [organizationId, email],
  );
  return rows[0] || null;
}

export async function updateCustomerUserOrgAdmin(runner: any, userId: any, role: any, displayName: any) {
  // Legacy helper: never clear branch_id — portal users stay branch-scoped.
  await runnerQuery(runner).query(
    `UPDATE customer_users
     SET role = 'branch_user',
         branch_id = COALESCE(NULLIF(TRIM(branch_id), ''), 'hq'),
         display_name = COALESCE(NULLIF(display_name, ''), $2),
         updated_at = NOW()
     WHERE id = $1`,
    [userId, displayName],
  );
}

export async function updateCustomerUserBranch(runner: any, userId: any, role: any, branchId: any, displayName: any) {
  await runnerQuery(runner).query(
    `UPDATE customer_users
     SET role = $2, branch_id = $3, display_name = COALESCE(NULLIF($4, ''), display_name), updated_at = NOW()
     WHERE id = $1`,
    [userId, role, branchId, displayName],
  );
}

export async function selectCustomerUserById(runner: any, customerUserId: any) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM customer_users WHERE id = $1`, [
    customerUserId,
  ]);
  return rows[0] || null;
}

export async function insertCustomerUser(runner: any, values: any) {
  try {
    const { rows } = await runnerQuery(runner).query(
      `INSERT INTO customer_users (
        organization_id, email, password_hash, display_name, role, branch_id, is_active, must_change_password
      ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, TRUE)
      RETURNING *`,
      values,
    );
    return rows[0] || null;
  } catch (error) {
    // Pre-migrate DBs: still create the portal user so welcome email can proceed.
    if (!isMissingMustChangePasswordColumn(error)) {
      throw error;
    }
    const { rows } = await runnerQuery(runner).query(
      `INSERT INTO customer_users (
        organization_id, email, password_hash, display_name, role, branch_id, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      RETURNING *`,
      values,
    );
    return rows[0] ? { ...rows[0], must_change_password: true } : null;
  }
}

export async function updateCustomerUserPasswordHash(
  runner: any,
  passwordHash: any,
  customerUserId: any,
  { mustChangePassword = true }: { mustChangePassword?: boolean } = {},
) {
  try {
    await runnerQuery(runner).query(
      `UPDATE customer_users
       SET password_hash = $1,
           must_change_password = $3,
           updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, customerUserId, Boolean(mustChangePassword)],
    );
  } catch (error) {
    if (!isMissingMustChangePasswordColumn(error)) {
      throw error;
    }
    await runnerQuery(runner).query(
      `UPDATE customer_users
       SET password_hash = $1, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, customerUserId],
    );
  }
}

export async function selectCustomerUsersByOrganization(runner: any, organizationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM customer_users WHERE organization_id = $1 ORDER BY role, email`,
    [organizationId],
  );
  return rows;
}

export async function selectCustomerPasswordHash(customerUserId: any) {
  const { rows } = await query(`SELECT password_hash FROM customer_users WHERE id = $1`, [
    customerUserId,
  ]);
  return rows[0]?.password_hash || null;
}

export async function updateCustomerPassword(
  customerUserId: any,
  passwordHash: any,
  { clearMustChangePassword = false }: { clearMustChangePassword?: boolean } = {},
) {
  if (clearMustChangePassword) {
    try {
      await query(
        `UPDATE customer_users
         SET password_hash = $1, must_change_password = FALSE, updated_at = NOW()
         WHERE id = $2`,
        [passwordHash, customerUserId],
      );
      return;
    } catch (error) {
      if (!isMissingMustChangePasswordColumn(error)) {
        throw error;
      }
    }
  }
  await query(`UPDATE customer_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [
    passwordHash,
    customerUserId,
  ]);
}

export async function updateCustomerPasswordByEmail(
  email: any,
  passwordHash: any,
  { clearMustChangePassword = false }: { clearMustChangePassword?: boolean } = {},
) {
  if (clearMustChangePassword) {
    try {
      await query(
        `UPDATE customer_users
         SET password_hash = $1, must_change_password = FALSE, updated_at = NOW()
         WHERE lower(email) = lower($2) AND is_active = TRUE`,
        [passwordHash, email],
      );
      return;
    } catch (error) {
      if (!isMissingMustChangePasswordColumn(error)) {
        throw error;
      }
    }
  }
  await query(
    `UPDATE customer_users
     SET password_hash = $1, updated_at = NOW()
     WHERE lower(email) = lower($2) AND is_active = TRUE`,
    [passwordHash, email],
  );
}

export async function deleteCustomerAuthSessionsForUser(customerUserId: any) {
  await query(`DELETE FROM customer_auth_sessions WHERE customer_user_id = $1`, [customerUserId]);
}

export async function updateCustomerUserIsActive(customerUserId: any, isActive: boolean) {
  const { rows } = await query(
    `UPDATE customer_users
     SET is_active = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [customerUserId, Boolean(isActive)],
  );
  return rows[0] || null;
}

export async function deleteCustomerUserById(customerUserId: any) {
  await query(`DELETE FROM customer_auth_sessions WHERE customer_user_id = $1`, [customerUserId]);
  const { rows } = await query(`DELETE FROM customer_users WHERE id = $1 RETURNING id`, [
    customerUserId,
  ]);
  return rows[0] || null;
}

export async function deleteCustomerAuthSessionsByEmail(email: any) {
  await query(
    `DELETE FROM customer_auth_sessions
     WHERE customer_user_id IN (
       SELECT id FROM customer_users WHERE lower(email) = lower($1)
     )`,
    [email],
  );
}

export async function hasActiveCustomerSessionByEmail(email: any) {
  if (!email) {
    return false;
  }
  const { rows } = await query(
    `SELECT 1 AS ok
     FROM customer_auth_sessions s
     WHERE s.expires_at > NOW()
       AND s.customer_user_id IN (
         SELECT id FROM customer_users WHERE lower(email) = lower($1)
       )
     LIMIT 1`,
    [email],
  );
  return Boolean(rows[0]);
}

export async function hasActiveCustomerSessionForUser(customerUserId: any) {
  if (!customerUserId) {
    return false;
  }
  await query(`DELETE FROM customer_auth_sessions WHERE expires_at <= NOW()`);
  const { rows } = await query(
    `SELECT 1 AS ok
     FROM customer_auth_sessions
     WHERE customer_user_id = $1 AND expires_at > NOW()
     LIMIT 1`,
    [customerUserId],
  );
  return Boolean(rows[0]);
}

export async function selectActiveCustomerUsersByEmail(email: any) {
  const { rows } = await query(
    `SELECT * FROM customer_users
     WHERE lower(email) = lower($1) AND is_active = TRUE
     ORDER BY updated_at DESC`,
    [email],
  );
  return rows;
}

export async function selectAdminCustomerUsers(runner: any = null, { q = "" }: any = {}) {
  const params: any[] = [];
  // Paid customers only: org must have a source lead with at least one Paid quotation.
  let where = `WHERE EXISTS (
      SELECT 1
      FROM quotations q
      WHERE q.lead_id = l.id
        AND q.status = 'Paid'
    )`;
  const queryText = String(q || "").trim();
  if (queryText) {
    params.push(`%${queryText.toLowerCase()}%`);
    where += ` AND (
      lower(cu.email) LIKE $${params.length}
      OR lower(coalesce(o.company_name, '')) LIKE $${params.length}
      OR lower(coalesce(cu.display_name, '')) LIKE $${params.length}
      OR lower(coalesce(au.display_name, au.email, '')) LIKE $${params.length}
      OR lower(
        CASE
          WHEN l.partner_id IS NOT NULL THEN 'partner'
          WHEN l.reseller_id IS NOT NULL THEN 'reseller'
          ELSE 'internal'
        END
      ) LIKE $${params.length}
    )`;
  }

  const { rows } = await runnerQuery(runner).query(
    `SELECT
       cu.id,
       cu.email,
       cu.display_name,
       cu.role,
       cu.branch_id,
       cu.organization_id,
       cu.is_active,
       cu.updated_at,
       o.company_name,
       ol.label AS branch_label,
       CASE
         WHEN l.partner_id IS NOT NULL THEN 'Partner'
         WHEN l.reseller_id IS NOT NULL THEN 'Reseller'
         ELSE 'Internal'
       END AS resource,
       COALESCE(NULLIF(TRIM(au.display_name), ''), NULLIF(TRIM(au.email), '')) AS incharge_name
     FROM customer_users cu
     INNER JOIN organizations o ON o.id = cu.organization_id
     INNER JOIN leads l ON l.id = o.source_lead_id
     LEFT JOIN users au ON au.id = l.assigned_user_id
     LEFT JOIN organization_locations ol
       ON ol.organization_id = cu.organization_id
      AND ol.id = cu.branch_id
     ${where}
     ORDER BY o.company_name NULLS LAST, cu.role, cu.email
     LIMIT 500`,
    params,
  );
  return rows;
}

export async function insertCustomerAuthSession(token: any, customerUserId: any, organizationId: any, email: any, expiresAt: any) {
  await query(
    `INSERT INTO customer_auth_sessions (token, customer_user_id, organization_id, email, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [token, customerUserId, organizationId, email, expiresAt],
  );
}

export async function deleteCustomerAuthSession(token: any) {
  if (!token) {
    return;
  }
  await query(`DELETE FROM customer_auth_sessions WHERE token = $1`, [token]);
}

export async function selectCustomerSession(token: any) {
  try {
    const { rows } = await query(
      `SELECT s.*,
              u.display_name,
              u.role AS user_role,
              u.branch_id AS user_branch_id,
              u.must_change_password AS must_change_password
       FROM customer_auth_sessions s
       JOIN customer_users u ON u.id = s.customer_user_id
       WHERE s.token = $1 AND s.expires_at > NOW() AND u.is_active = TRUE`,
      [token],
    );
    return rows[0] || null;
  } catch (error) {
    if (!isMissingMustChangePasswordColumn(error)) {
      throw error;
    }
    const { rows } = await query(
      `SELECT s.*,
              u.display_name,
              u.role AS user_role,
              u.branch_id AS user_branch_id,
              FALSE AS must_change_password
       FROM customer_auth_sessions s
       JOIN customer_users u ON u.id = s.customer_user_id
       WHERE s.token = $1 AND s.expires_at > NOW() AND u.is_active = TRUE`,
      [token],
    );
    return rows[0] || null;
  }
}

export async function selectCustomerSubscriptionAccess(runner: any, customerUserId: any, subscriptionId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT g.subscription_id
     FROM product_access_grants g
     JOIN subscriptions s ON s.id = g.subscription_id
     WHERE g.customer_user_id = $1 AND g.subscription_id = $2
     LIMIT 1`,
    [customerUserId, subscriptionId],
  );
  return rows[0] || null;
}

export async function upsertProductAccessGrant(runner: any, customerUserId: any, subscriptionId: any, role: any) {
  await runnerQuery(runner).query(
    `INSERT INTO product_access_grants (customer_user_id, subscription_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (customer_user_id, subscription_id) DO UPDATE SET role = EXCLUDED.role`,
    [customerUserId, subscriptionId, role],
  );
}
