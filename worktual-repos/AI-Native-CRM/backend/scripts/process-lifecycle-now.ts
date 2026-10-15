import { prisma } from "../src/dao/db/prisma.js";
import { processLeadLifecycleJob } from "../src/service/ai/lead-lifecycle-job.js";

const contactId = process.argv[2] || "723c9f6a-4b90-4221-9411-3d17835144e0";

async function main() {
  const job = await prisma.leadLifecycleJob.findFirst({
    where: { contactId },
    orderBy: { updatedAt: "desc" },
  });
  console.log(
    "before",
    JSON.stringify(
      {
        id: job?.id,
        status: job?.status,
        decision: job?.decision,
        reason: job?.reason,
        resultSummary: job?.resultSummary,
      },
      null,
      2,
    ),
  );

  if (job?.id) {
    const result = await processLeadLifecycleJob(job.id);
    console.log(
      "after",
      JSON.stringify(
        {
          status: result?.status,
          decision: result?.decision,
          reason: result?.reason,
          resultSummary: result?.resultSummary,
        },
        null,
        2,
      ),
    );
  }

  const deal = await prisma.deal.findFirst({ where: { contactId } });
  console.log("deal stage", deal?.stage);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
