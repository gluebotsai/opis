import { randomUUID } from "node:crypto";

/** CRM-originated people. Other writers use their own source_name (shopify, webtracking, …). */
export const CRM_CDP_SOURCE = "crm";

function slugSource(raw: string): string {
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!slug) {
    throw new Error("cdp_id source_name is required");
  }
  return slug;
}

function slugOrg(raw: string): string {
  const org = raw.trim();
  if (!org) {
    throw new Error("cdp_id organization_id is required");
  }
  return org;
}

function slugExternal(raw: string): string {
  const id = raw.trim().replace(/\s+/g, "");
  if (!id) {
    throw new Error("cdp_id external_id is required");
  }
  return id;
}

/** CDP-{source_name}-org{organization_id}-{external_id} */
export function formatCdpId(args: {
  sourceName: string;
  organizationId: string;
  externalId: string;
}): string {
  return `CDP-${slugSource(args.sourceName)}-org${slugOrg(args.organizationId)}-${slugExternal(args.externalId)}`;
}

/** New CRM contact: unique external token (compact UUID). */
export function newCrmCdpId(organizationId: string): string {
  return formatCdpId({
    sourceName: CRM_CDP_SOURCE,
    organizationId,
    externalId: randomUUID().replaceAll("-", ""),
  });
}
