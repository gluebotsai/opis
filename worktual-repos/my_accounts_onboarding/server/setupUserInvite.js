import crypto from "node:crypto";
import bcrypt from "bcrypt";

import { pool, withTransaction } from "./db/pool.js";
import * as repo from "./repositories/raw/setupOrganization.repo.js";
import { validatePasswordPolicy } from "./passwordPolicy.js";
import { notifySetupUserInvite, resolveAppBaseUrl } from "./notifications.js";
import { getProductName } from "../src/lib/productCatalog.js";
import { isOrgAdminCustomer } from "./customerAuth.js";

const BCRYPT_ROUNDS = 10;
const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

function assertOrgAdmin(customerUser) {
  if (!isOrgAdminCustomer(customerUser)) {
    const error = new Error("Only organization admins can modify setup workspace.");
    error.statusCode = 403;
    throw error;
  }
}

function hashInviteToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

function generateRawInviteToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function normalizeProductAccess(rawAccess = []) {
  if (!Array.isArray(rawAccess)) return [];
  return rawAccess
    .map((entry) => ({
      productId: String(entry?.productId || "").trim(),
      roleId: String(entry?.roleId || "").trim(),
    }))
    .filter((entry) => entry.productId && entry.roleId);
}

function productNamesFromAccess(productAccess) {
  return normalizeProductAccess(productAccess).map((grant) => getProductName(grant.productId));
}

async function loadOrgName(organizationId) {
  const profile = await repo.selectBusinessProfile(pool, organizationId);
  return profile?.company_name || "Your organization";
}

/**
 * Create invite token, mark user invited, send set-password email (link only).
 */
export async function issueSetupUserInvite(customerUser, userId, { requirePendingOrInvited = false } = {}) {
  assertOrgAdmin(customerUser);
  const organizationId = customerUser.organizationId;
  const user = await repo.getUserById(pool, organizationId, userId);
  if (!user) {
    const error = new Error("User not found.");
    error.statusCode = 404;
    throw error;
  }

  const productAccess = normalizeProductAccess(user.product_access || []);
  if (!productAccess.length) {
    const error = new Error("Assign at least one product before sending an invite.");
    error.statusCode = 400;
    throw error;
  }

  const inviteStatus = user.invite_status || "pending";
  if (requirePendingOrInvited && inviteStatus === "active") {
    const error = new Error("This user already set a password. Invite cannot be resent.");
    error.statusCode = 400;
    throw error;
  }
  if (inviteStatus === "disabled" || user.status === "inactive") {
    const error = new Error("Cannot invite an inactive or disabled user.");
    error.statusCode = 400;
    throw error;
  }

  const rawToken = generateRawInviteToken();
  const tokenHash = hashInviteToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  await withTransaction(async (client) => {
    await repo.invalidateUnusedInviteTokens(client, userId);
    await repo.insertInviteToken(client, {
      organizationId,
      userId,
      tokenHash,
      expiresAt,
      createdBy: customerUser.id || null,
    });
    await repo.markUserInvited(client, organizationId, userId);
  });

  const setPasswordUrl = `${resolveAppBaseUrl()}/invite/set-password?token=${encodeURIComponent(rawToken)}`;
  const orgName = await loadOrgName(organizationId);

  try {
    await notifySetupUserInvite({
      toEmail: user.work_email,
      firstName: user.first_name,
      orgName,
      productNames: productNamesFromAccess(productAccess),
      setPasswordUrl,
      expiresAt,
    });
  } catch (err) {
    const error = new Error(
      err.message || "Invite was created but the email could not be sent. Try Resend invite.",
    );
    error.statusCode = 502;
    error.inviteCreated = true;
    throw error;
  }

  const refreshed = await repo.getUserById(pool, organizationId, userId);
  return {
    invited: true,
    email: user.work_email,
    expiresAt: expiresAt.toISOString(),
    user: refreshed,
  };
}

export async function getInvitePreview(rawToken) {
  const tokenHash = hashInviteToken(rawToken);
  const row = await repo.findInviteByTokenHash(pool, tokenHash);
  if (!row) {
    const error = new Error("This invite link is invalid.");
    error.statusCode = 404;
    throw error;
  }
  if (row.used_at) {
    const error = new Error("This invite link has already been used.");
    error.statusCode = 410;
    throw error;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    const error = new Error("This invite link has expired. Ask your admin to resend the invite.");
    error.statusCode = 410;
    throw error;
  }
  if (row.user_status === "inactive" || row.invite_status === "disabled") {
    const error = new Error("This account is inactive. Contact your administrator.");
    error.statusCode = 403;
    throw error;
  }

  const products = productNamesFromAccess(row.product_access || []);
  return {
    email: row.work_email,
    firstName: row.first_name,
    lastName: row.last_name,
    orgName: row.company_name || "",
    products,
    expiresAt: row.expires_at,
  };
}

export async function completeSetupUserInvite({ token, password, confirmPassword }) {
  const rawToken = String(token || "").trim();
  if (!rawToken) {
    const error = new Error("Invite token is required.");
    error.statusCode = 400;
    throw error;
  }
  if (String(password || "") !== String(confirmPassword || "")) {
    const error = new Error("Password and confirmation do not match.");
    error.statusCode = 400;
    throw error;
  }
  validatePasswordPolicy(password);

  const tokenHash = hashInviteToken(rawToken);
  const row = await repo.findInviteByTokenHash(pool, tokenHash);
  if (!row) {
    const error = new Error("This invite link is invalid.");
    error.statusCode = 404;
    throw error;
  }
  if (row.used_at) {
    const error = new Error("This invite link has already been used.");
    error.statusCode = 410;
    throw error;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    const error = new Error("This invite link has expired. Ask your admin to resend the invite.");
    error.statusCode = 410;
    throw error;
  }

  const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const products = productNamesFromAccess(row.product_access || []);

  await withTransaction(async (client) => {
    await repo.setUserPasswordAndActivate(client, row.organization_id, row.user_id, passwordHash);
    await repo.markInviteTokenUsed(client, row.id);
    await repo.invalidateUnusedInviteTokens(client, row.user_id);
  });

  return {
    ok: true,
    email: row.work_email,
    firstName: row.first_name,
    orgName: row.company_name || "",
    products,
  };
}

export { productNamesFromAccess, normalizeProductAccess };
