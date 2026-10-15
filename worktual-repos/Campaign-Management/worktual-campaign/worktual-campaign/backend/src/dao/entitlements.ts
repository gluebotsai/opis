import { prisma } from "../plugins/prisma.js";
import { fromDbId, toDbId } from "../helpers/account-ids.js";
import { AppError } from "../helpers/response-builders.js";

export async function hasActiveCampaignProduct(
  organizationId: string,
  branchId?: string | null,
): Promise<boolean> {
  const row = await prisma.organizationProduct.findFirst({
    where: {
      organizationId: toDbId(organizationId),
      productCode: "campaign",
      status: "active",
      ...(branchId ? { branchId: toDbId(branchId) } : {}),
      OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function getDefaultBranchId(
  organizationId: string,
): Promise<string | null> {
  const tid = toDbId(organizationId);
  const branch = await prisma.branch.findFirst({
    where: { organizationId: tid, isDefault: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (branch) return fromDbId(branch.id);

  const any = await prisma.branch.findFirst({
    where: { organizationId: tid },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return any ? fromDbId(any.id) : null;
}

/**
 * Ensure campaign.branch + campaign product entitlement exist for this org.
 * Writes only to campaign schema (not accounts).
 */
export async function ensureCampaignAccessForOrganization(
  organizationId: string,
): Promise<string> {
  const tid = toDbId(organizationId);
  let branchId = await getDefaultBranchId(organizationId);
  if (!branchId) {
    const created = await prisma.branch.create({
      data: {
        organizationId: tid,
        name: "Default",
        isDefault: true,
      },
      select: { id: true },
    });
    branchId = fromDbId(created.id);
  }

  const entitled = await hasActiveCampaignProduct(organizationId, branchId);
  if (!entitled) {
    await prisma.organizationProduct.create({
      data: {
        organizationId: tid,
        branchId: toDbId(branchId),
        productCode: "campaign",
        status: "active",
      },
    });
  }
  return branchId;
}

/**
 * CRM connect (step 5) — org must already have active Campaign product.
 * Does not auto-provision branch or entitlement.
 */
export async function requireCampaignEntitlementForCrm(
  organizationId: string,
): Promise<string> {
  const branchId = await getDefaultBranchId(organizationId);
  if (!branchId) {
    throw new AppError(
      "No branch configured for this organization. Contact support.",
      403,
    );
  }

  const entitled = await hasActiveCampaignProduct(organizationId, branchId);
  if (!entitled) {
    throw new AppError(
      "Campaign product is not enabled for this organization.",
      403,
    );
  }

  return branchId;
}
