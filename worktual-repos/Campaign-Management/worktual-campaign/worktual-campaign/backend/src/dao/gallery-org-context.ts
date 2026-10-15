// @ts-nocheck
/** Org industry context for gallery bootstrap (no chat session required). */

import { accountQuery } from "../plugins/account-pool.js";
import { prisma } from "../plugins/prisma.js";
import {
  buildSeedPayload,
  normalizePayload,
} from "../helpers/industry-pack-seed.js";

export type GalleryOrgContext = {
  organizationId: string;
  companyName: string;
  industryType: string;
  packId: string;
  mode: "b2b" | "b2c";
  industry: string;
  companyPack: Record<string, unknown>;
};

function orgPayloadForAgents(ctx: GalleryOrgContext) {
  return {
    company_name: ctx.companyName,
    industry: ctx.industry,
    industry_type: ctx.industryType,
    pack_id: ctx.packId,
    mode: ctx.mode,
    company_pack: ctx.companyPack,
  };
}

export { orgPayloadForAgents };

async function loadOrgRow(organizationId: string) {
  const { rows } = await accountQuery<{
    company_name: string | null;
    business_type: string | null;
    industry_type: string | null;
  }>(
    `SELECT company_name, business_type, industry_type
     FROM accounts.organizations
     WHERE id::text = $1
     LIMIT 1`,
    [organizationId],
  );
  return rows[0];
}

export async function loadGalleryOrgContext(
  organizationId: string,
): Promise<GalleryOrgContext> {
  const org = await loadOrgRow(organizationId);
  const businessType = String(org?.business_type || "").toLowerCase();
  const mode: "b2b" | "b2c" = businessType === "b2c" ? "b2c" : "b2b";
  const industryType = String(org?.industry_type || "").trim();

  let pack = await prisma.tenantIndustryPack.findUnique({
    where: { organizationId },
  });
  if (!pack) {
    const seed = buildSeedPayload({ mode, industryType });
    pack = await prisma.tenantIndustryPack.create({
      data: {
        organizationId,
        packId: mode === "b2c" ? "generic-b2c" : "generic-b2b",
        seedIndustryType: industryType,
        payload: seed,
      },
    });
  }

  const payload = normalizePayload(pack.payload);
  return {
    organizationId: String(organizationId),
    companyName: String(org?.company_name || "").trim() || "Your company",
    industryType: industryType || pack.seedIndustryType || "",
    packId: pack.packId,
    mode: payload.mode === "b2c" ? "b2c" : "b2b",
    industry: pack.packId,
    companyPack: payload as Record<string, unknown>,
  };
}
