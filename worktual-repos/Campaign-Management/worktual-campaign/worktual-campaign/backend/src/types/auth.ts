export type CampaignMode = "b2b" | "b2c";

export type CampaignIndustry = "generic-b2b" | "generic-b2c";

export type CampaignSessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  initials: string;
  organizationId: string;
  branchId: string;
  orgName: string;
  /** From accounts.organizations.business_type */
  mode: CampaignMode;
  industry: CampaignIndustry;
  businessType: string;
  industryType: string | null;
};

export type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  organizationId: string;
  /** @deprecated legacy JWT claim — dual-read only */
  tenantId?: string;
  branchId: string;
  mode?: CampaignMode;
  industry?: CampaignIndustry;
  industryType?: string | null;
};

/** Resolve org id from JWT payload (supports legacy tenantId claim). */
export function jwtOrganizationId(payload: {
  organizationId?: string;
  tenantId?: string;
}): string {
  return String(payload.organizationId ?? payload.tenantId ?? "").trim();
}
