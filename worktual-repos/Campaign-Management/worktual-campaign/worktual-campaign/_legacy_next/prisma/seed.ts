import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const DEFAULT_TENANT_ID =
  process.env.DEFAULT_TENANT_ID?.trim() ||
  "00000000-0000-4000-8000-000000000001";

const prisma = new PrismaClient();

async function main() {
  const branch = await prisma.branch.upsert({
    where: { id: "10000000-0000-4000-8000-000000000001" },
    create: {
      id: "10000000-0000-4000-8000-000000000001",
      tenantId: DEFAULT_TENANT_ID,
      name: "Default",
      isDefault: true,
    },
    update: {
      name: "Default",
      isDefault: true,
    },
  });

  await prisma.organizationProduct.upsert({
    where: {
      tenantId_branchId_productCode: {
        tenantId: DEFAULT_TENANT_ID,
        branchId: branch.id,
        productCode: "campaign",
      },
    },
    create: {
      tenantId: DEFAULT_TENANT_ID,
      branchId: branch.id,
      productCode: "campaign",
      status: "active",
      startsAt: new Date(),
    },
    update: {
      status: "active",
    },
  });

  // Also mark CRM product for orgs that have both (optional demo entitlement)
  await prisma.organizationProduct.upsert({
    where: {
      tenantId_branchId_productCode: {
        tenantId: DEFAULT_TENANT_ID,
        branchId: branch.id,
        productCode: "crm",
      },
    },
    create: {
      tenantId: DEFAULT_TENANT_ID,
      branchId: branch.id,
      productCode: "crm",
      status: "active",
      startsAt: new Date(),
    },
    update: {
      status: "active",
    },
  });

  console.log(
    `Seeded campaign_db: tenant=${DEFAULT_TENANT_ID} branch=${branch.id} products=campaign,crm`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
