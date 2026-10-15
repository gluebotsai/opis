import bcrypt from "bcryptjs";
import { accountQuery } from "../plugins/account-pool.js";
import { userUuidToAccountId } from "../helpers/account-ids.js";
import { resolveOrganizationId } from "../helpers/tenant.js";
import { ensureCampaignAccessForOrganization } from "./entitlements.js";
import { buildSessionFromCrmAccess } from "./crm-session.js";
import type {
  CampaignIndustry,
  CampaignMode,
  CampaignSessionUser,
} from "../types/auth.js";
import { AppError, UnauthorizedError } from "../helpers/response-builders.js";

/** accounts.setup_users — read only. */
type SetupUserRow = {
  id: string;
  work_email: string;
  password_hash: string | null;
  first_name: string;
  last_name: string;
  status: string;
  organization_id: string;
};

type OrgRow = {
  company_name: string | null;
  business_type: string | null;
  industry_type: string | null;
};

function initialsFromName(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (
    stored.startsWith("$2a$") ||
    stored.startsWith("$2b$") ||
    stored.startsWith("$2y$")
  ) {
    return bcrypt.compare(plain, stored);
  }
  return plain === stored;
}

async function resolveRoleName(
  userId: string,
  organizationId: string,
): Promise<string> {
  const { rows } = await accountQuery<{ name: string }>(
    `SELECT r.name
     FROM accounts.setup_user_product_access a
     JOIN accounts.setup_roles r ON r.id = a.role_id
     WHERE a.user_id::text = $1::text
       AND a.organization_id::text = $2::text
     ORDER BY CASE WHEN lower(r.name) = 'admin' THEN 0 ELSE 1 END, r.name
     LIMIT 1`,
    [userId, organizationId],
  );
  return rows[0]?.name?.trim() || "user";
}

async function loadOrganization(organizationId: string): Promise<OrgRow | null> {
  const { rows } = await accountQuery<OrgRow>(
    `SELECT company_name, business_type, industry_type
     FROM accounts.organizations
     WHERE id::text = $1::text
     LIMIT 1`,
    [organizationId],
  );
  return rows[0] ?? null;
}

function profileFromBusinessType(businessType: string | null | undefined): {
  mode: CampaignMode;
  industry: CampaignIndustry;
  businessType: string;
} {
  const raw = String(businessType || "").trim();
  const upper = raw.toUpperCase();
  if (upper === "B2C") {
    return { mode: "b2c", industry: "generic-b2c", businessType: raw || "B2C" };
  }
  return {
    mode: "b2b",
    industry: "generic-b2b",
    businessType: raw || "B2B",
  };
}

function toSession(
  user: SetupUserRow,
  organizationId: string,
  branchId: string,
  role: string,
  org: OrgRow | null,
): CampaignSessionUser {
  const name =
    `${user.first_name || ""} ${user.last_name || ""}`.trim() ||
    user.work_email.split("@")[0];
  const profile = profileFromBusinessType(org?.business_type);
  return {
    id: String(user.id),
    email: user.work_email,
    name,
    role,
    initials: initialsFromName(name),
    organizationId,
    branchId,
    orgName: org?.company_name?.trim() || "Worktual",
    mode: profile.mode,
    industry: profile.industry,
    businessType: profile.businessType,
    industryType: org?.industry_type?.trim() || null,
  };
}

async function loadSetupUserByEmail(email: string): Promise<SetupUserRow | null> {
  const { rows } = await accountQuery<SetupUserRow>(
    `SELECT id, work_email, password_hash, first_name, last_name, status, organization_id
     FROM accounts.setup_users
     WHERE lower(work_email) = $1
     LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}

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

async function buildSession(user: SetupUserRow): Promise<CampaignSessionUser> {
  if (!user.organization_id?.trim()) {
    throw new AppError(
      "Your account has no organization. Contact an admin to complete setup.",
      403,
    );
  }

  const organizationId = resolveOrganizationId(String(user.organization_id));
  const branchId = await ensureCampaignAccessForOrganization(organizationId);
  const role = await resolveRoleName(
    String(user.id),
    String(user.organization_id),
  );
  const org = await loadOrganization(String(user.organization_id));
  return toSession(user, organizationId, branchId, role, org);
}

/** CRM access path — 6-step connect spec (see dao/crm-access.ts). */
export async function getSessionUserFromCrmAccess(
  userId: string,
): Promise<CampaignSessionUser> {
  return buildSessionFromCrmAccess(userId);
}

export async function authenticateCampaignUser(input: {
  email: string;
  password: string;
}): Promise<CampaignSessionUser> {
  const email = input.email.trim().toLowerCase();
  const user = await loadSetupUserByEmail(email);
  if (!user || String(user.status).toLowerCase() !== "active") {
    throw new UnauthorizedError("Invalid email or password.");
  }
  if (!user.password_hash) {
    throw new UnauthorizedError(
      "Password not set for this user. Complete invite setup first.",
    );
  }

  const valid = await verifyPassword(input.password, user.password_hash);
  if (!valid) {
    throw new UnauthorizedError("Invalid email or password.");
  }

  return buildSession(user);
}

export async function getSessionUserById(
  userId: string,
): Promise<CampaignSessionUser | null> {
  const user = await loadSetupUserById(userId);
  if (!user || String(user.status).toLowerCase() !== "active") return null;
  return buildSession(user);
}

/**
 * Session for onboarding deep-link after Accounts invite set-password.
 * Requires active user with password already set.
 */
export async function getSessionUserForOnboarding(input: {
  email?: string;
  userId?: string;
}): Promise<CampaignSessionUser> {
  const email = input.email?.trim().toLowerCase() || "";
  const userId = input.userId?.trim() || "";
  if (!email && !userId) {
    throw new AppError("Provide email or userId.", 400);
  }

  const row = email
    ? await loadSetupUserByEmail(email)
    : await loadSetupUserById(userId);

  if (!row || String(row.status).toLowerCase() !== "active") {
    throw new AppError("User not found or inactive.", 404);
  }
  if (!row.password_hash) {
    throw new AppError(
      "Password not set yet. Complete invite setup before issuing a dashboard link.",
      409,
    );
  }

  return buildSession(row);
}
