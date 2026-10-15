import { query } from "../../db/pool.js";

function runnerQuery(runner) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  return query;
}

export async function selectAccessGrantsForCustomer(runner, customerUserId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT g.*, s.product_id, s.location_id
     FROM product_access_grants g
     JOIN subscriptions s ON s.id = g.subscription_id
     WHERE g.customer_user_id = $1`,
    [customerUserId],
  );
  return rows;
}

export async function selectOrganizationLocationLabel(runner, locationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT label FROM organization_locations WHERE id = $1 LIMIT 1`,
    [locationId],
  );
  return rows[0]?.label || null;
}

export async function selectOrganizationLocationById(runner, organizationId, locationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM organization_locations
     WHERE organization_id = $1 AND id = $2
     LIMIT 1`,
    [organizationId, locationId],
  );
  return rows[0] || null;
}

export async function selectActiveSubscriptionsByOrganization(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id, location_id FROM subscriptions WHERE organization_id = $1 AND status = 'active'`,
    [organizationId],
  );
  return rows;
}

export async function insertProductAccessGrant(runner, customerUserId, subscriptionId) {
  await runnerQuery(runner).query(
    `INSERT INTO product_access_grants (customer_user_id, subscription_id, role)
     VALUES ($1, $2, 'user')
     ON CONFLICT (customer_user_id, subscription_id) DO NOTHING`,
    [customerUserId, subscriptionId],
  );
}

export async function deleteProductAccessGrantsOutsideLocation(
  runner,
  customerUserId,
  organizationId,
  locationId,
) {
  await runnerQuery(runner).query(
    `DELETE FROM product_access_grants
     WHERE customer_user_id = $1
       AND subscription_id IN (
         SELECT id FROM subscriptions
         WHERE organization_id = $2 AND location_id <> $3
       )`,
    [customerUserId, organizationId, locationId],
  );
}

export async function selectActiveCustomerUsersByOrganization(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM customer_users WHERE organization_id = $1 AND is_active = TRUE`,
    [organizationId],
  );
  return rows;
}

export async function selectCustomerUserByOrganizationEmail(runner, organizationId, email) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM customer_users WHERE organization_id = $1 AND email = $2 LIMIT 1`,
    [organizationId, email],
  );
  return rows[0] || null;
}

export async function updateCustomerUserOrgAdmin(runner, userId, role, displayName) {
  await runnerQuery(runner).query(
    `UPDATE customer_users
     SET role = $2, location_id = NULL, display_name = COALESCE(NULLIF(display_name, ''), $3), updated_at = NOW()
     WHERE id = $1`,
    [userId, role, displayName],
  );
}

export async function updateCustomerUserBranch(runner, userId, role, locationId, displayName) {
  await runnerQuery(runner).query(
    `UPDATE customer_users
     SET role = $2, location_id = $3, display_name = COALESCE(NULLIF($4, ''), display_name), updated_at = NOW()
     WHERE id = $1`,
    [userId, role, locationId, displayName],
  );
}

export async function selectCustomerUserById(runner, customerUserId) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM customer_users WHERE id = $1`, [
    customerUserId,
  ]);
  return rows[0] || null;
}

export async function insertCustomerUser(runner, values) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO customer_users (
      organization_id, email, password_hash, display_name, role, location_id, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, TRUE)
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function updateCustomerUserPasswordHash(runner, passwordHash, customerUserId) {
  await runnerQuery(runner).query(
    `UPDATE customer_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
    [passwordHash, customerUserId],
  );
}

export async function selectCustomerUsersByOrganization(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM customer_users WHERE organization_id = $1 ORDER BY role, email`,
    [organizationId],
  );
  return rows;
}

export async function selectCustomerPasswordHash(customerUserId) {
  const { rows } = await query(`SELECT password_hash FROM customer_users WHERE id = $1`, [
    customerUserId,
  ]);
  return rows[0]?.password_hash || null;
}

export async function updateCustomerPassword(customerUserId, passwordHash) {
  await query(`UPDATE customer_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [
    passwordHash,
    customerUserId,
  ]);
}

export async function selectActiveCustomerUsersByEmail(email) {
  const { rows } = await query(
    `SELECT * FROM customer_users
     WHERE email = $1 AND is_active = TRUE
     ORDER BY updated_at DESC`,
    [email],
  );
  return rows;
}

export async function insertCustomerAuthSession(token, customerUserId, organizationId, email, expiresAt) {
  await query(
    `INSERT INTO customer_auth_sessions (token, customer_user_id, organization_id, email, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [token, customerUserId, organizationId, email, expiresAt],
  );
}

export async function selectCustomerSession(token) {
  const { rows } = await query(
    `SELECT s.*, u.display_name, u.role AS user_role, u.location_id AS user_location_id
     FROM customer_auth_sessions s
     JOIN customer_users u ON u.id = s.customer_user_id
     WHERE s.token = $1 AND s.expires_at > NOW() AND u.is_active = TRUE`,
    [token],
  );
  return rows[0] || null;
}

export async function selectCustomerSubscriptionAccess(runner, customerUserId, subscriptionId) {
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

export async function upsertProductAccessGrant(runner, customerUserId, subscriptionId, role) {
  await runnerQuery(runner).query(
    `INSERT INTO product_access_grants (customer_user_id, subscription_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (customer_user_id, subscription_id) DO UPDATE SET role = EXCLUDED.role`,
    [customerUserId, subscriptionId, role],
  );
}
