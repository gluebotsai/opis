import { prisma } from "@/server/db/prisma";

export async function hasActiveCampaignProduct(
  tenantId: string,
  branchId?: string | null,
): Promise<boolean> {
  const row = await prisma.organizationProduct.findFirst({
    where: {
      tenantId,
      productCode: "campaign",
      status: "active",
      ...(branchId ? { branchId } : {}),
      OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function getDefaultBranchId(tenantId: string): Promise<string | null> {
  const branch = await prisma.branch.findFirst({
    where: { tenantId, isDefault: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (branch) return branch.id;

  const any = await prisma.branch.findFirst({
    where: { tenantId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return any?.id ?? null;
}
