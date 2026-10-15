/**
 * Reclaim a stuck lifecycle job and re-run lifecycle for a contact.
 * Usage: npx tsx --env-file=../.env scripts/requeue-lifecycle.ts [contactId]
 */
import { reclaimStaleAnalyzingLifecycleJobs } from "../src/dao/ai/lead-lifecycle-store.js";
import { enqueueLeadLifecycle } from "../src/service/ai/lead-lifecycle-job.js";
import { prisma } from "../src/dao/db/prisma.js";

const contactId = process.argv[2] || "723c9f6a-4b90-4221-9411-3d17835144e0";

async function main() {
  const reclaimed = await reclaimStaleAnalyzingLifecycleJobs();
  console.log("reclaimed", reclaimed);

  const job = await enqueueLeadLifecycle({
    contactId,
    triggerReason: "manual_requeue",
    processImmediately: true,
  });
  console.log("job", job?.id, job?.status);

  // Allow async lifecycle run to finish
  await new Promise((r) => setTimeout(r, 25_000));

  const { getContact } = await import("../src/dao/contacts/contact-service.js");
  const contact = await getContact(contactId);
  console.log(
    JSON.stringify(
      {
        leadStatus: contact?.person.leadStatus,
        contactType: contact?.person.contactType,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
