import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const DEFAULT_TENANT_ID = BigInt(
  process.env.DEFAULT_TENANT_ID?.trim() || "1000",
);

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.branch.findFirst({
    where: { tenantId: DEFAULT_TENANT_ID, isDefault: true },
  });

  const branch =
    existing ??
    (await prisma.branch.create({
      data: {
        tenantId: DEFAULT_TENANT_ID,
        name: "Default",
        isDefault: true,
      },
    }));

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
    },
    update: { status: "active" },
  });

  console.log(
    `Seeded campaign tenant=${DEFAULT_TENANT_ID} branch=${branch.id}`,
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
