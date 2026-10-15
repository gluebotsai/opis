/**
 * Campaign list/report visibility — admin sees branch-wide; others see own campaigns only.
 */
import type { CampaignSessionUser } from "../types/auth.js";
import { isAdminRole } from "./config-channels.js";

export type CampaignDataScope = "org" | "mine";

/** Resolved data scope for the signed-in user (JWT role only — no query override in v1). */
export function resolveCampaignDataScope(
  session: CampaignSessionUser,
): CampaignDataScope {
  return isAdminRole(session.role) ? "org" : "mine";
}

/** Prisma `where` tenant filter for campaign reads (lists, counts, detail). */
export function campaignTenantWhere(session: CampaignSessionUser): {
  organizationId: string;
  branchId: string;
  createdByUserId?: string;
} {
  const base = {
    organizationId: session.organizationId,
    branchId: session.branchId,
  };
  if (resolveCampaignDataScope(session) === "mine") {
    return { ...base, createdByUserId: session.id };
  }
  return base;
}

export function scopeAppliedLabel(scope: CampaignDataScope): string {
  return scope === "org" ? "All branch campaigns" : "Your campaigns";
}
