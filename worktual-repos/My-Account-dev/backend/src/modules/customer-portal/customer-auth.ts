import crypto from "node:crypto";

import bcrypt from "bcrypt";

import { pool } from "../../db/pool.js";
import { validatePasswordPolicy } from "../auth/password-policy.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { getOrganizationById, syncOrganizationProfileFromLead } from "../organizations/organization-store.js";
import { selectLeadById } from "../../repositories/raw/leads.repo.js";
import { listSubscriptionsByOrganization } from "../subscriptions/subscription-store.js";
import * as customerAuthRepo from "../../repositories/raw/customerAuth.repo.js";
import { resolvePortalLoginEmail } from "../../lib/customer-contact.js";
import { AUTH_SESSION_TTL_MS } from "../auth/session-ttl.js";
import { createSessionAlreadyActiveError } from "../auth/session-concurrency.js";

/** Portal logins are branch-scoped only. ORG_ADMIN is retained for legacy reads/migration. */
export const CUSTOMER_ROLES = {
  ORG_ADMIN: "org_admin",
  BRANCH_USER: "branch_user",
};

const CUSTOMER_SESSION_TTL_MS = AUTH_SESSION_TTL_MS;
const BCRYPT_ROUNDS = 12;

async function resolveHqBranchId(client: any, organizationId: any) {
  const { rows } = await client.query(
    `SELECT id FROM organization_locations
     WHERE organization_id = $1 AND is_primary = true
     ORDER BY id ASC
     LIMIT 1`,
    [organizationId],
  );
  return String(rows[0]?.id || "hq");
}

function isCustomerPasswordHashed(password: any) {
  return String(password || "").startsWith("$2");
}

function hashPasswordLegacy(password: any) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

async function hashCustomerPassword(password: any) {
  return bcrypt.hash(String(password), BCRYPT_ROUNDS);
}

async function verifyCustomerPassword(storedHash: any, password: any) {
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

export function normalizeCustomerRole(_role: any, _branchId: any = null) {
  return CUSTOMER_ROLES.BRANCH_USER;
}

/** @deprecated Company-wide portal admin is removed; always false. */
export function isOrgAdminCustomer(_user: any) {
  return false;
}

function mapCustomerUser(row: any, grants: any[] = []) {
  const user = rowToCamel(row);
  const branchId = user!.branchId != null && user!.branchId !== "" ? String(user!.branchId) : null;
  const role = normalizeCustomerRole(user!.role, branchId);

  return {
    id: user!.id,
    organizationId: user!.organizationId,
    email: user!.email,
    displayName: String(user!.displayName || ""),
    role,
    branchId,
    isActive: user!.isActive !== false,
    mustChangePassword: Boolean(user!.mustChangePassword),
    grants,
    createdAt: toIso(user!.createdAt),
  };
}

async function loadAccessGrants(client: any, customerUserId: any) {
  const rows = await customerAuthRepo.selectAccessGrantsForCustomer(client, customerUserId);

  return rows.map((row: any) => {
    const entry = rowToCamel(row);
    return {
      id: entry!.id,
      subscriptionId: entry!.subscriptionId,
      productId: entry!.productId,
      branchId: entry!.branchId,
      role: entry!.role || "user",
    };
  });
}

async function resolveCustomerLocationLabel(client: any, branchId: any) {
  if (!branchId) {
    return "";
  }

  const label = await customerAuthRepo.selectOrganizationLocationLabel(client, branchId);
  return label || "Branch";
}

/**
 * Which active subscription rows a portal user should hold grants for.
 * Head office sees every branch; non-head users only their assigned location.
 * Exported for unit tests.
 */
export function selectSubscriptionRowsForGrants(
  subscriptionRows: any[],
  user: { branchId?: string | null },
  organization: any,
) {
  const rows = Array.isArray(subscriptionRows) ? subscriptionRows : [];
  if (isHeadOfficePortalUser(user, organization)) {
    return rows;
  }
  const branchId = String(user?.branchId || "").trim();
  if (!branchId) {
    return [];
  }
  return rows.filter((sub: any) => String(sub.branch_id || sub.branchId || "").trim() === branchId);
}

/**
 * Entitlements payload subscriptions for the portal dashboard.
 * Head office: all active org subscriptions (grants can lag after multi-branch sync).
 * Branch user: grant-scoped, with branch_id fallback when grants are empty/stale.
 * Exported for unit tests.
 */
export function selectEntitledSubscriptions(
  subscriptions: any[],
  user: { branchId?: string | null; grants?: any[] },
  { isHeadOffice = false }: { isHeadOffice?: boolean } = {},
) {
  const list = (Array.isArray(subscriptions) ? subscriptions : []).filter(
    (sub: any) => (sub.status || "active") === "active",
  );
  if (isHeadOffice) {
    return list;
  }

  const grantIds = new Set(
    (user?.grants || []).map((grant: any) => String(grant.subscriptionId || "")).filter(Boolean),
  );
  const granted = list.filter((sub: any) => grantIds.has(String(sub.id)));
  if (granted.length) {
    return granted;
  }

  const branchId = String(user?.branchId || "").trim();
  if (!branchId) {
    return [];
  }
  return list.filter((sub: any) => String(sub.branchId || sub.branch_id || "").trim() === branchId);
}

async function syncSubscriptionGrants(client: any, customerUserRow: any, organizationId: any) {
  const user = mapCustomerUser(customerUserRow);
  const rows = await customerAuthRepo.selectActiveSubscriptionsByOrganization(
    client,
    organizationId,
  );
  const organization = await getOrganizationById(organizationId, client as any);
  const entitledSubs = selectSubscriptionRowsForGrants(rows, user, organization);
  const headOffice = isHeadOfficePortalUser(user, organization);

  for (const sub of entitledSubs) {
    await customerAuthRepo.insertProductAccessGrant(client, customerUserRow.id, sub.id);
  }

  // Head office must keep grants across all branches — never strip non-HQ locations.
  if (!headOffice && user.branchId) {
    await customerAuthRepo.deleteProductAccessGrantsOutsideLocation(
      client,
      customerUserRow.id,
      organizationId,
      user.branchId,
    );
  }
}

export async function resyncOrganizationCustomerGrants(client: any, organizationId: any) {
  const rows = await customerAuthRepo.selectActiveCustomerUsersByOrganization(
    client,
    organizationId,
  );

  for (const row of rows) {
    await syncSubscriptionGrants(client, row, organizationId);
  }
}

/**
 * Head office = portal user whose `branchId` matches the organization's primary location
 * (`organization_locations.is_primary`). Legacy `"hq"` id is treated as head when no primary row exists.
 */
export function isHeadOfficePortalUser(user: any, organization: any) {
  const branchId = String(user?.branchId || "").trim();
  if (!branchId) {
    return false;
  }

  const locations = organization?.locations || [];
  const primary = locations.find((entry: any) => entry?.isPrimary === true);
  if (primary?.id != null && String(primary.id).trim() !== "") {
    return String(primary.id) === branchId;
  }

  return branchId === "hq";
}

/**
 * Head-office portal users receive the full location list.
 * Non-head branch users only receive their assigned location (and matching billing address)
 * so dashboard / onboarding / hub cannot surface other branches' details.
 * Product/subscription access remains grant-scoped separately.
 */
export function filterOrganizationForCustomer(organization: any, user: any) {
  if (!organization) {
    return organization;
  }

  if (isHeadOfficePortalUser(user, organization)) {
    return organization;
  }

  const branchId = String(user?.branchId || "").trim();
  if (!branchId) {
    return {
      ...organization,
      locations: [],
      billingAddress: "",
    };
  }

  const locations = (organization.locations || []).filter(
    (entry: any) => String(entry?.id) === branchId,
  );
  const own = locations[0];

  return {
    ...organization,
    locations,
    // Clear HQ billing address so portal lead-shape does not synthesize a second "Head office" row.
    billingAddress: own?.address || "",
    // Scope tax to the assigned branch so HQ GST is not exposed on non-head entitlements.
    taxNumber: own?.taxNumber || "",
    country: own?.country || organization.country || "",
    contactName: own?.contactName || organization.contactName || "",
    designation: own?.designation || organization.designation || "",
    workEmail: own?.workEmail || organization.workEmail || "",
    industryType: own?.industryType || organization.industryType || "",
    mobileCountryCode: own?.mobileCountryCode || organization.mobileCountryCode || "",
    mobileNumber: own?.mobileNumber || organization.mobileNumber || "",
    secondaryMobileCountryCode:
      own?.secondaryMobileCountryCode || organization.secondaryMobileCountryCode || "",
    secondaryMobileNumber: own?.secondaryMobileNumber || organization.secondaryMobileNumber || "",
  };
}

/**
 * Creates/updates the HQ branch portal user for the lead login email.
 * Name kept for call-site compatibility; never creates an org-wide admin.
 */
export async function ensureOrgAdminCustomerUser(client: any, organizationId: any, leadProfile: any) {
  const email = resolvePortalLoginEmail(leadProfile);
  if (!email) {
    return null;
  }

  const hqBranchId = await resolveHqBranchId(client, organizationId);
  try {
    return await ensureBranchCustomerUser(client, organizationId, {
      branchId: hqBranchId,
      email,
      displayName: leadProfile.contactName || leadProfile.displayName || "",
    });
  } catch {
    // Email already bound to another branch — do not overwrite.
    return null;
  }
}

/** @deprecated use ensureOrgAdminCustomerUser (HQ branch user) */
export async function ensureDefaultCustomerUser(client: any, organizationId: any, leadProfile: any) {
  return ensureOrgAdminCustomerUser(client, organizationId, leadProfile);
}

export async function ensureBranchCustomerUser(
  client: any,
  organizationId: any,
  { branchId, email, displayName = "" }: any,
) {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  const resolvedBranchId = String(branchId || "").trim();

  if (!normalizedEmail || !resolvedBranchId) {
    throw new Error("Branch location and work email are required.");
  }

  const existing = await customerAuthRepo.selectCustomerUserByOrganizationEmail(
    client,
    organizationId,
    normalizedEmail,
  );

  if (existing) {
    const existingUser = mapCustomerUser(existing);
    if (existingUser.branchId && existingUser.branchId !== resolvedBranchId) {
      throw new Error("This email is already used for another portal branch.");
    }

    await customerAuthRepo.updateCustomerUserBranch(
      client,
      existing.id,
      CUSTOMER_ROLES.BRANCH_USER,
      resolvedBranchId,
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
    resolvedBranchId,
  ]);

  await syncSubscriptionGrants(client, user, organizationId);

  return {
    user: mapCustomerUser(user, await loadAccessGrants(client, user.id)),
    temporaryPassword: tempPassword,
    created: true,
  };
}

export async function regenerateBranchPortalPassword(client: any, organizationId: any, branchAccess: any) {
  const ensured = await ensureBranchCustomerUser(client, organizationId, branchAccess);
  if (!ensured?.user) {
    return null;
  }

  const tempPassword = generateTemporaryPassword();
  await customerAuthRepo.updateCustomerUserPasswordHash(
    client,
    await hashCustomerPassword(tempPassword),
    ensured.user.id,
    { mustChangePassword: true },
  );
  // Force re-login with the new temporary password, then mandatory change.
  await customerAuthRepo.deleteCustomerAuthSessionsForUser(ensured.user.id);

  return {
    user: { ...ensured.user, mustChangePassword: true },
    email: ensured.user.email,
    branchId: ensured.user.branchId,
    temporaryPassword: tempPassword,
    created: ensured.created,
  };
}

export async function regenerateCustomerPortalPassword(client: any, organizationId: any, leadProfile: any) {
  const email = resolvePortalLoginEmail(leadProfile);
  if (!email) {
    return null;
  }

  const hqBranchId = await resolveHqBranchId(client, organizationId);
  try {
    const portalAccess = await regenerateBranchPortalPassword(client, organizationId, {
      branchId: hqBranchId,
      email,
      displayName: leadProfile.contactName || leadProfile.displayName || "",
    });
    if (!portalAccess) {
      return null;
    }
    return {
      ...portalAccess,
      email: portalAccess.email || email,
      role: CUSTOMER_ROLES.BRANCH_USER,
    };
  } catch {
    return null;
  }
}

export async function listOrganizationCustomerUsers(organizationId: any, client: any = null) {
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

/** Admin: clear all portal sessions for one customer_users row. */
export async function forceLogoutCustomerUserByAdmin(customerUserId: any) {
  const row = await customerAuthRepo.selectCustomerUserById(pool, customerUserId);
  if (!row) {
    const error = new Error("Customer portal user not found.");
    (error as any).status = 404;
    throw error;
  }

  await customerAuthRepo.deleteCustomerAuthSessionsForUser(customerUserId);
  return { ok: true, customerUserId: String(customerUserId) };
}

/** Admin: activate / deactivate a customer portal login. */
export async function setCustomerUserActiveByAdmin(customerUserId: any, isActive: boolean) {
  const row = await customerAuthRepo.selectCustomerUserById(pool, customerUserId);
  if (!row) {
    const error = new Error("Customer portal user not found.");
    (error as any).status = 404;
    throw error;
  }

  const updated = await customerAuthRepo.updateCustomerUserIsActive(
    customerUserId,
    Boolean(isActive),
  );
  if (!updated) {
    const error = new Error("Customer portal user not found.");
    (error as any).status = 404;
    throw error;
  }

  if (!isActive) {
    await customerAuthRepo.deleteCustomerAuthSessionsForUser(customerUserId);
  }

  return {
    ok: true,
    customerUserId: String(customerUserId),
    isActive: updated.is_active !== false,
  };
}

/** Admin: permanently remove a customer portal login. */
export async function deleteCustomerUserByAdmin(customerUserId: any) {
  const row = await customerAuthRepo.selectCustomerUserById(pool, customerUserId);
  if (!row) {
    const error = new Error("Customer portal user not found.");
    (error as any).status = 404;
    throw error;
  }

  const deleted = await customerAuthRepo.deleteCustomerUserById(customerUserId);
  if (!deleted) {
    const error = new Error("Customer portal user not found.");
    (error as any).status = 404;
    throw error;
  }

  return { ok: true, customerUserId: String(customerUserId) };
}

/** Admin: list customer portal users for directory / force-logout. */
export async function listAdminCustomerUsers({ q = "" }: any = {}) {
  const rows = await customerAuthRepo.selectAdminCustomerUsers(pool, { q });
  return rows.map((row: any) => ({
    id: row.id,
    email: row.email || "",
    displayName: row.display_name || "",
    role: row.role || "",
    branchId: row.branch_id || null,
    branchLabel: row.branch_label || null,
    organizationId: row.organization_id || null,
    companyName: row.company_name || "",
    isActive: row.is_active !== false,
    updatedAt: row.updated_at || null,
    resource: row.resource || "Internal",
    inchargeName: row.incharge_name || "",
  }));
}

export async function setCustomerPortalPassword(client: any, customerUserId: any, password: any) {
  await customerAuthRepo.updateCustomerUserPasswordHash(
    client,
    await hashCustomerPassword(password),
    customerUserId,
    { mustChangePassword: false },
  );
}

export async function assertCustomerPassword(customerUserId: any, password: any) {
  const user = await customerAuthRepo.selectCustomerUserById(pool, customerUserId);
  const storedHash = user?.password_hash || null;

  if (!storedHash) {
    throw new Error("Customer account not found.");
  }

  if (!(await verifyCustomerPassword(storedHash, String(password || "")))) {
    throw new Error("Current password is incorrect.");
  }

  return user;
}

export async function changeCustomerPassword(customerUserId: any, currentPassword: any, newPassword: any) {
  const user = await customerAuthRepo.selectCustomerUserById(pool, customerUserId);
  const storedHash = user?.password_hash || null;

  if (!storedHash) {
    throw new Error("Customer account not found.");
  }

  if (!(await verifyCustomerPassword(storedHash, currentPassword))) {
    throw new Error("Current password is incorrect.");
  }

  validatePasswordPolicy(newPassword);

  const nextHash = await hashCustomerPassword(newPassword);
  // Keep every active portal account for this email on the same password so login
  // cannot fall through to another org row still holding the old hash.
  if (user.email) {
    await customerAuthRepo.updateCustomerPasswordByEmail(user.email, nextHash, {
      clearMustChangePassword: true,
    });
    await customerAuthRepo.deleteCustomerAuthSessionsByEmail(user.email);
  } else {
    await customerAuthRepo.updateCustomerPassword(customerUserId, nextHash, {
      clearMustChangePassword: true,
    });
    await customerAuthRepo.deleteCustomerAuthSessionsForUser(customerUserId);
  }
}

export async function loginCustomerUser(email: any, password: any, { replaceSession = false }: any = {}) {
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

  if (matchedUser.branch_id) {
    const locationRow = await customerAuthRepo.selectOrganizationLocationById(
      pool,
      matchedUser.organization_id,
      matchedUser.branch_id,
    );
    if (locationRow && (locationRow.status || "active") === "inactive") {
      throw new Error("This branch portal is inactive. Contact Worktual support.");
    }
  }

  if (!isCustomerPasswordHashed(matchedUser.password_hash)) {
    await customerAuthRepo.updateCustomerPassword(
      matchedUser.id,
      await hashCustomerPassword(password),
    );
  }

  const user = matchedUser;

  if (await customerAuthRepo.hasActiveCustomerSessionForUser(user.id)) {
    if (replaceSession) {
      await customerAuthRepo.deleteCustomerAuthSessionsForUser(user.id);
    } else {
      throw createSessionAlreadyActiveError();
    }
  }

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
    const branchLabel = await resolveCustomerLocationLabel(client, mappedUser.branchId);
    return {
      token,
      email: normalizedEmail,
      organizationId: user.organization_id,
      mustChangePassword: Boolean(mappedUser.mustChangePassword),
      user: {
        ...mappedUser,
        branchLabel,
      },
    };
  } finally {
    client.release();
  }
}

export async function getCustomerSession(token: any) {
  if (!token) {
    return null;
  }

  const row = await customerAuthRepo.selectCustomerSession(token);

  if (!row) {
    return null;
  }

  const session = rowToCamel(row);
  const role = normalizeCustomerRole(session!.userRole, session!.userBranchId);

  return {
    token: session!.token,
    customerUserId: session!.customerUserId,
    organizationId: session!.organizationId,
    email: session!.email,
    displayName: session!.displayName || "",
    role,
    branchId: session!.userBranchId || null,
    mustChangePassword: Boolean(session!.mustChangePassword),
    expiresAt: new Date((session!.expiresAt as any)).getTime(),
  };
}

export async function logoutCustomerUser(token: any) {
  await customerAuthRepo.deleteCustomerAuthSession(token);
}

import { runWithOrganizationContext } from "../../db/tenantContext.js";

export async function requireCustomerAuth(request: any, response: any, next: any) {
  try {
    const header = request.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const session = await getCustomerSession(token);

    if (!session) {
      response.status(401).json({ error: "Customer authentication required." });
      return;
    }

    request.customerUser = session;
    runWithOrganizationContext((session.organizationId as any), () => next());
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
}

export async function getCustomerEntitlements(customerUserId: any) {
  const client = await pool.connect();
  try {
    const row = await customerAuthRepo.selectCustomerUserById(client, customerUserId);
    if (!row) {
      return null;
    }

    let fullOrganization: any = await getOrganizationById(row.organization_id, (client as any));

    // Heal stale org profile/location contact fields from the source lead (portal reads org, sales writes lead).
    const sourceLeadId = fullOrganization?.sourceLeadId;
    if (sourceLeadId && fullOrganization?.id) {
      const leadRow = await selectLeadById(client, sourceLeadId);
      const leadWork = String(leadRow?.work_email || "")
        .trim()
        .toLowerCase();
      const orgWork = String(fullOrganization.workEmail || "")
        .trim()
        .toLowerCase();
      const hqLocation = (fullOrganization.locations || []).find((entry: any) => entry.isPrimary);
      const locationWork = String(hqLocation?.workEmail || "")
        .trim()
        .toLowerCase();
      const leadIndustry = String(leadRow?.industry_type || "").trim();
      const orgIndustry = String(fullOrganization.industryType || "").trim();
      const leadMobile = String(leadRow?.mobile_number || "").replace(/\D/g, "");
      const orgMobile = String(fullOrganization.mobileNumber || "").replace(/\D/g, "");
      const locationMissingContactFields = (fullOrganization.locations || []).some(
        (entry: any) =>
          !String(entry.industryType || "").trim() ||
          !String(entry.mobileNumber || "").replace(/\D/g, ""),
      );
      const { rows: branchContactRows } = await client.query(
        `SELECT 1
         FROM additional_addresses
         WHERE lead_id = $1
           AND (
             COALESCE(industry_type, '') <> ''
             OR COALESCE(mobile_number, '') <> ''
           )
         LIMIT 1`,
        [sourceLeadId],
      );
      const sourceHasContactFields =
        Boolean(leadIndustry) ||
        Boolean(leadMobile) ||
        branchContactRows.length > 0;
      const needsLeadProfileSync =
        (leadWork && (leadWork !== orgWork || (hqLocation && leadWork !== locationWork))) ||
        (leadIndustry && leadIndustry !== orgIndustry) ||
        (leadMobile && leadMobile !== orgMobile) ||
        (locationMissingContactFields && sourceHasContactFields);
      if (needsLeadProfileSync) {
        await syncOrganizationProfileFromLead(client, sourceLeadId, fullOrganization.id);
        fullOrganization = await getOrganizationById(row.organization_id, (client as any));
      }
    }

    // Re-attach grants after multi-branch payments / portal provisioning so HQ is not
    // left with only head-office subscriptions (or zero when products live at a branch).
    await syncSubscriptionGrants(client, row, row.organization_id);

    const user = mapCustomerUser(row, await loadAccessGrants(client, customerUserId));
    const isHeadOffice = isHeadOfficePortalUser(user, fullOrganization);
    const organization = filterOrganizationForCustomer(fullOrganization, user);
    const subscriptions = await listSubscriptionsByOrganization(user.organizationId, (client as any));
    const entitledSubscriptions = selectEntitledSubscriptions(subscriptions, user, {
      isHeadOffice,
    });

    return {
      organization,
      user: {
        ...user,
        isHeadOffice,
      },
      subscriptions: entitledSubscriptions,
    };
  } finally {
    client.release();
  }
}

export async function assertCustomerSubscriptionAccess(customerUserId: any, subscriptionId: any) {
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

export async function grantCustomerAccess(client: any, customerUserId: any, subscriptionId: any, role = "user") {
  await customerAuthRepo.upsertProductAccessGrant(client, customerUserId, subscriptionId, role);
}

export async function getCustomerSubscriptionScope(customerUser: any) {
  const entitlements = await getCustomerEntitlements(customerUser.customerUserId);
  return (entitlements?.subscriptions || []).map((entry: any) => entry.id);
}
