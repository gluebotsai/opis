import crypto from "node:crypto";

import bcrypt from "bcrypt";

import { pool } from "./db/pool.js";
import { validatePasswordPolicy } from "./passwordPolicy.js";
import { rowToCamel, toIso } from "./db/util.js";
import { getOrganizationById } from "./organizations.js";
import { listSubscriptionsByOrganization } from "./subscriptions.js";
import * as customerAuthRepo from "./repositories/raw/customerAuth.repo.js";

export const CUSTOMER_ROLES = {
  ORG_ADMIN: "org_admin",
  BRANCH_USER: "branch_user",
};

const CUSTOMER_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

function isCustomerPasswordHashed(password) {
  return String(password || "").startsWith("$2");
}

function hashPasswordLegacy(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

async function hashCustomerPassword(password) {
  return bcrypt.hash(String(password), BCRYPT_ROUNDS);
}

async function verifyCustomerPassword(storedHash, password) {
  if (!storedHash) {
    return false;
  }

  if (isCustomerPasswordHashed(storedHash)) {
    return bcrypt.compare(String(password), storedHash);
  }

  return storedHash === hashPasswordLegacy(password);
}

function generateTemporaryPassword() {
  const suffix = crypto.randomBytes(6).toString("base64url");
  return `Aa1!${suffix}`;
}

export function normalizeCustomerRole(role, locationId = null) {
  const value = String(role || "").trim();
  if (value === CUSTOMER_ROLES.ORG_ADMIN || value === CUSTOMER_ROLES.BRANCH_USER) {
    return value;
  }

  if (value === "admin") {
    return CUSTOMER_ROLES.ORG_ADMIN;
  }

  if (locationId) {
    return CUSTOMER_ROLES.BRANCH_USER;
  }

  return CUSTOMER_ROLES.ORG_ADMIN;
}

export function isOrgAdminCustomer(user) {
  const role = normalizeCustomerRole(user?.role, user?.locationId);
  return role === CUSTOMER_ROLES.ORG_ADMIN;
}

function mapCustomerUser(row, grants = []) {
  const user = rowToCamel(row);
  const locationId = user.locationId || null;
  const role = normalizeCustomerRole(user.role, locationId);

  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    displayName: user.displayName || "",
    role,
    locationId,
    isActive: user.isActive !== false,
    grants,
    createdAt: toIso(user.createdAt),
  };
}

async function loadAccessGrants(client, customerUserId) {
  const rows = await customerAuthRepo.selectAccessGrantsForCustomer(client, customerUserId);

  return rows.map((row) => {
    const entry = rowToCamel(row);
    return {
      id: entry.id,
      subscriptionId: entry.subscriptionId,
      productId: entry.productId,
      locationId: entry.locationId,
      role: entry.role || "user",
    };
  });
}

async function resolveCustomerLocationLabel(client, locationId) {
  if (!locationId) {
    return "";
  }

  const label = await customerAuthRepo.selectOrganizationLocationLabel(client, locationId);
  return label || "Branch";
}

async function syncSubscriptionGrants(client, customerUserRow, organizationId) {
  const user = mapCustomerUser(customerUserRow);
  const rows = await customerAuthRepo.selectActiveSubscriptionsByOrganization(
    client,
    organizationId,
  );

  const entitledSubs = isOrgAdminCustomer(user)
    ? rows
    : rows.filter((sub) => sub.location_id === user.locationId);

  for (const sub of entitledSubs) {
    await customerAuthRepo.insertProductAccessGrant(client, customerUserRow.id, sub.id);
  }

  if (!isOrgAdminCustomer(user) && user.locationId) {
    await customerAuthRepo.deleteProductAccessGrantsOutsideLocation(
      client,
      customerUserRow.id,
      organizationId,
      user.locationId,
    );
  }
}

export async function resyncOrganizationCustomerGrants(client, organizationId) {
  const rows = await customerAuthRepo.selectActiveCustomerUsersByOrganization(
    client,
    organizationId,
  );

  for (const row of rows) {
    await syncSubscriptionGrants(client, row, organizationId);
  }
}

function filterOrganizationForCustomer(organization, user) {
  if (!organization || isOrgAdminCustomer(user)) {
    return organization;
  }

  const locations = (organization.locations || []).filter((entry) => entry.id === user.locationId);
  return {
    ...organization,
    locations,
  };
}

export async function ensureOrgAdminCustomerUser(client, organizationId, leadProfile) {
  const email = String(leadProfile.adminEmail || leadProfile.workEmail || "")
    .trim()
    .toLowerCase();
  if (!email) {
    return null;
  }

  const existing = await customerAuthRepo.selectCustomerUserByOrganizationEmail(
    client,
    organizationId,
    email,
  );

  if (existing) {
    await customerAuthRepo.updateCustomerUserOrgAdmin(
      client,
      existing.id,
      CUSTOMER_ROLES.ORG_ADMIN,
      leadProfile.contactName || "",
    );
    const refreshed = await customerAuthRepo.selectCustomerUserById(client, existing.id);
    await syncSubscriptionGrants(client, refreshed, organizationId);
    return {
      user: mapCustomerUser(refreshed, await loadAccessGrants(client, refreshed.id)),
      temporaryPassword: null,
      created: false,
    };
  }

  const tempPassword = generateTemporaryPassword();
  const user = await customerAuthRepo.insertCustomerUser(client, [
    organizationId,
    email,
    await hashCustomerPassword(tempPassword),
    leadProfile.contactName || "",
    CUSTOMER_ROLES.ORG_ADMIN,
    null,
  ]);

  await syncSubscriptionGrants(client, user, organizationId);

  return {
    user: mapCustomerUser(user, await loadAccessGrants(client, user.id)),
    temporaryPassword: tempPassword,
    created: true,
  };
}

/** @deprecated use ensureOrgAdminCustomerUser */
export async function ensureDefaultCustomerUser(client, organizationId, leadProfile) {
  return ensureOrgAdminCustomerUser(client, organizationId, leadProfile);
}

export async function ensureBranchCustomerUser(
  client,
  organizationId,
  { locationId, email, displayName = "" },
) {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  const branchId = String(locationId || "").trim();

  if (!normalizedEmail || !branchId) {
    throw new Error("Branch location and work email are required.");
  }

  const existing = await customerAuthRepo.selectCustomerUserByOrganizationEmail(
    client,
    organizationId,
    normalizedEmail,
  );

  if (existing) {
    const existingUser = mapCustomerUser(existing);
    if (
      isOrgAdminCustomer(existingUser) ||
      (existingUser.locationId && existingUser.locationId !== branchId)
    ) {
      throw new Error("This email is already used for another portal role or branch.");
    }

    await customerAuthRepo.updateCustomerUserBranch(
      client,
      existing.id,
      CUSTOMER_ROLES.BRANCH_USER,
      branchId,
      displayName,
    );
    const refreshed = await customerAuthRepo.selectCustomerUserById(client, existing.id);
    await syncSubscriptionGrants(client, refreshed, organizationId);

    return {
      user: mapCustomerUser(refreshed, await loadAccessGrants(client, refreshed.id)),
      temporaryPassword: null,
      created: false,
    };
  }

  const tempPassword = generateTemporaryPassword();
  const user = await customerAuthRepo.insertCustomerUser(client, [
    organizationId,
    normalizedEmail,
    await hashCustomerPassword(tempPassword),
    displayName,
    CUSTOMER_ROLES.BRANCH_USER,
    branchId,
  ]);

  await syncSubscriptionGrants(client, user, organizationId);

  return {
    user: mapCustomerUser(user, await loadAccessGrants(client, user.id)),
    temporaryPassword: tempPassword,
    created: true,
  };
}

export async function regenerateBranchPortalPassword(client, organizationId, branchAccess) {
  const ensured = await ensureBranchCustomerUser(client, organizationId, branchAccess);
  if (!ensured?.user) {
    return null;
  }

  const tempPassword = generateTemporaryPassword();
  await customerAuthRepo.updateCustomerUserPasswordHash(
    client,
    await hashCustomerPassword(tempPassword),
    ensured.user.id,
  );

  return {
    user: ensured.user,
    email: ensured.user.email,
    locationId: ensured.user.locationId,
    temporaryPassword: tempPassword,
    created: ensured.created,
  };
}

export async function regenerateCustomerPortalPassword(client, organizationId, leadProfile) {
  const email = String(leadProfile.adminEmail || leadProfile.workEmail || "")
    .trim()
    .toLowerCase();
  if (!email) {
    return null;
  }

  const ensured = await ensureOrgAdminCustomerUser(client, organizationId, leadProfile);
  if (!ensured?.user) {
    return null;
  }

  const tempPassword = generateTemporaryPassword();
  await customerAuthRepo.updateCustomerUserPasswordHash(
    client,
    await hashCustomerPassword(tempPassword),
    ensured.user.id,
  );

  return {
    user: ensured.user,
    email,
    role: CUSTOMER_ROLES.ORG_ADMIN,
    temporaryPassword: tempPassword,
    created: ensured.created,
  };
}

export async function listOrganizationCustomerUsers(organizationId, client = null) {
  const ownedClient = client ? null : await pool.connect();
  const runner = client || ownedClient;

  try {
    const rows = await customerAuthRepo.selectCustomerUsersByOrganization(runner, organizationId);

    const users = [];
    for (const row of rows) {
      users.push(mapCustomerUser(row, await loadAccessGrants(runner, row.id)));
    }

    return users;
  } finally {
    if (ownedClient) {
      ownedClient.release();
    }
  }
}

export async function setCustomerPortalPassword(client, customerUserId, password) {
  await customerAuthRepo.updateCustomerUserPasswordHash(
    client,
    await hashCustomerPassword(password),
    customerUserId,
  );
}

export async function changeCustomerPassword(customerUserId, currentPassword, newPassword) {
  const storedHash = await customerAuthRepo.selectCustomerPasswordHash(customerUserId);

  if (!storedHash) {
    throw new Error("Customer account not found.");
  }

  if (!(await verifyCustomerPassword(storedHash, currentPassword))) {
    throw new Error("Current password is incorrect.");
  }

  validatePasswordPolicy(newPassword);

  await customerAuthRepo.updateCustomerPassword(
    customerUserId,
    await hashCustomerPassword(newPassword),
  );
}

export async function loginCustomerUser(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  const rows = await customerAuthRepo.selectActiveCustomerUsersByEmail(normalizedEmail);

  let matchedUser = null;
  for (const row of rows) {
    if (await verifyCustomerPassword(row.password_hash, password)) {
      matchedUser = row;
      break;
    }
  }

  if (!matchedUser) {
    throw new Error("Invalid email or password.");
  }

  if (matchedUser.location_id) {
    const locationRow = await customerAuthRepo.selectOrganizationLocationById(
      pool,
      matchedUser.organization_id,
      matchedUser.location_id,
    );
    if (locationRow && (locationRow.status || "active") === "inactive") {
      throw new Error("This branch portal is inactive. Contact your company admin or Worktual support.");
    }
  }

  if (!isCustomerPasswordHashed(matchedUser.password_hash)) {
    await customerAuthRepo.updateCustomerPassword(
      matchedUser.id,
      await hashCustomerPassword(password),
    );
  }

  const user = matchedUser;

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_TTL_MS);

  await customerAuthRepo.insertCustomerAuthSession(
    token,
    user.id,
    user.organization_id,
    normalizedEmail,
    expiresAt.toISOString(),
  );

  const client = await pool.connect();
  try {
    const grants = await loadAccessGrants(client, user.id);
    const mappedUser = mapCustomerUser(user, grants);
    const locationLabel = await resolveCustomerLocationLabel(client, mappedUser.locationId);

    if (isOrgAdminCustomer(mappedUser)) {
      const { ensureProductDefaultRoles } = await import("./ensureProductDefaultRoles.js");
      await ensureProductDefaultRoles(user.organization_id);
    }

    return {
      token,
      email: normalizedEmail,
      organizationId: user.organization_id,
      user: {
        ...mappedUser,
        locationLabel,
      },
    };
  } finally {
    client.release();
  }
}

export async function getCustomerSession(token) {
  if (!token) {
    return null;
  }

  const row = await customerAuthRepo.selectCustomerSession(token);

  if (!row) {
    return null;
  }

  const session = rowToCamel(row);
  const role = normalizeCustomerRole(session.userRole, session.userLocationId);

  return {
    token: session.token,
    customerUserId: session.customerUserId,
    organizationId: session.organizationId,
    email: session.email,
    displayName: session.displayName || "",
    role,
    locationId: session.userLocationId || null,
    expiresAt: new Date(session.expiresAt).getTime(),
  };
}

export async function requireCustomerAuth(request, response, next) {
  try {
    const header = request.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const session = await getCustomerSession(token);

    if (!session) {
      response.status(401).json({ error: "Customer authentication required." });
      return;
    }

    request.customerUser = session;
    next();
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function getCustomerEntitlements(customerUserId) {
  const client = await pool.connect();
  try {
    const row = await customerAuthRepo.selectCustomerUserById(client, customerUserId);
    if (!row) {
      return null;
    }

    const user = mapCustomerUser(row, await loadAccessGrants(client, customerUserId));
    const organization = filterOrganizationForCustomer(
      await getOrganizationById(user.organizationId, client),
      user,
    );
    const subscriptions = await listSubscriptionsByOrganization(user.organizationId, client);

    const entitledSubscriptions = subscriptions.filter((sub) =>
      user.grants.some((grant) => grant.subscriptionId === sub.id),
    );

    return {
      organization,
      user,
      subscriptions: entitledSubscriptions,
    };
  } finally {
    client.release();
  }
}

export async function assertCustomerSubscriptionAccess(customerUserId, subscriptionId) {
  const client = await pool.connect();
  try {
    const row = await customerAuthRepo.selectCustomerSubscriptionAccess(
      client,
      customerUserId,
      subscriptionId,
    );

    return Boolean(row);
  } finally {
    client.release();
  }
}

export async function grantCustomerAccess(client, customerUserId, subscriptionId, role = "user") {
  await customerAuthRepo.upsertProductAccessGrant(client, customerUserId, subscriptionId, role);
}

export async function getCustomerSubscriptionScope(customerUser) {
  if (isOrgAdminCustomer(customerUser)) {
    return null;
  }

  const entitlements = await getCustomerEntitlements(customerUser.customerUserId);
  return (entitlements?.subscriptions || []).map((entry) => entry.id);
}
