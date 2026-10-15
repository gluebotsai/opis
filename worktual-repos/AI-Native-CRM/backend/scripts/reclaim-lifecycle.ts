import { reclaimStaleAnalyzingLifecycleJobs } from "../src/dao/ai/lead-lifecycle-store.js";
import { prisma } from "../src/dao/db/prisma.js";

const contactId = process.argv[2] || "723c9f6a-4b90-4221-9411-3d17835144e0";

const n = await reclaimStaleAnalyzingLifecycleJobs();
const rows = await prisma.$queryRawUnsafe<
  Record<string, unknown>[]
>(
  `SELECT status, trigger_reason, last_error, updated_at FROM lead_lifecycle_jobs WHERE contact_id = $1`,
  contactId,
);
console.log(JSON.stringify({ reclaimed: n, job: rows[0] ?? null }));
await prisma.$disconnect();
