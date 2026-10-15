import { assertCrmConnectUser, assertCrmAutomationActor, pickDefaultAutomationActor, resolveCrmRoleName } from "./crm-access.js";
import { requireCampaignEntitlementForCrm } from "./entitlements.js";
import { resolveOrganizationId } from "../helpers/tenant.js";
import type {
  CampaignIndustry,
  CampaignMode,
  CampaignSessionUser,
} from "../types/auth.js";
import { accountQuery } from "../plugins/account-pool.js";
import { AppError } from "../helpers/response-builders.js";
import type { SetupUserRow } from "./crm-access.js";

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

/**
 * CRM JWT connect — steps 2–6.
 * Caller verifies JWT (step 1) before invoking.
 */
export async function buildSessionFromCrmAccess(
  userId: string,
): Promise<CampaignSessionUser> {
  const user = await assertCrmConnectUser(userId);
  const organizationId = resolveOrganizationId(String(user.organization_id));
  const branchId = await requireCampaignEntitlementForCrm(organizationId);
  const role = await resolveCrmRoleName(
    String(user.id),
    String(user.organization_id),
  );
  const org = await loadOrganization(String(user.organization_id));
  return toSession(user, organizationId, branchId, role, org);
}

/**
 * CRM monitor/agent Personalised CRM — tenant from organization_id.
 * acting_user_id is optional; if omitted, first active user in the org is used for created_by.
 */
export async function buildSessionFromCrmAutomation(
  organizationId: string,
  actingUserId?: string | null,
): Promise<CampaignSessionUser> {
  const orgId = resolveOrganizationId(organizationId);
  const org = await loadOrganization(orgId);
  if (!org) {
    throw new AppError(`Unknown organization_id ${orgId}.`, 400);
  }
  const actorId = String(actingUserId || "").trim();
  const user = actorId
    ? await assertCrmAutomationActor(actorId, orgId)
    : await pickDefaultAutomationActor(orgId);
  const branchId = await requireCampaignEntitlementForCrm(orgId);
  const role = await resolveCrmRoleName(String(user.id), orgId);
  return toSession(user, orgId, branchId, role, org);
}
