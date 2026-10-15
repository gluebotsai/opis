import { listAssignmentCandidates } from "../src/dao/sales/territory-assignment.js";
import { prisma } from "../src/dao/db/prisma.js";

async function main() {
  const orgs = await prisma.contactProfile.groupBy({
    by: ["organizationId"],
    _count: true,
    orderBy: { _count: { organizationId: "desc" } },
    take: 10,
  });
  for (const o of orgs) {
    const orgId = String(o.organizationId);
    const { candidates } = await listAssignmentCandidates({ organizationId: orgId });
    console.log(orgId, "profiles:", o._count, "candidates:", candidates.length);
  }
}

main()
  .finally(() => prisma.$disconnect());
