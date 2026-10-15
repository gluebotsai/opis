import { prisma } from "../src/dao/db/prisma";

const row = await prisma.proposal.findFirst({
  where: { status: "draft" },
  orderBy: { updatedAt: "desc" },
  select: { id: true, number: true, status: true },
});
console.log(JSON.stringify(row));
await prisma.$disconnect();
