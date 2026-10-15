import { prisma } from "../src/dao/db/prisma.js";
import { getContact } from "../src/dao/contacts/contact-service.js";
import { getLeadScoreStatus } from "../src/service/ai/lead-scoring-job.js";

const contactId = process.argv[2] || "723c9f6a-4b90-4221-9411-3d17835144e0";

async function main() {
  const contact = await getContact(contactId);
  const score = await getLeadScoreStatus(contactId).catch(() => null);

  const meetings = await prisma.contactActivity.findMany({
    where: { contactId, type: "meeting" },
    select: {
      id: true,
      subject: true,
      dueAt: true,
      completedAt: true,
      transcriptText: true,
      transcriptInsights: true,
      transcriptAnalyzedAt: true,
      transcriptSource: true,
    },
  });

  const deals = await prisma.deal.findMany({
    where: { contactId },
    select: { id: true, stage: true, title: true, createdAt: true },
  });

  const lifecycleJobRow = await prisma.$queryRawUnsafe<
    Record<string, unknown>[]
  >(
    `SELECT id, status, trigger_reason, attempts, last_error, decision, reason, ladder, from_stage, to_stage, updated_at, completed_at, result_summary
     FROM lead_lifecycle_jobs WHERE contact_id = $1 LIMIT 1`,
    contactId,
  );

  const proposals = deals.length
    ? await prisma.proposal.findMany({
        where: { dealId: { in: deals.map((d) => d.id) } },
        select: {
          id: true,
          status: true,
          title: true,
          createdAt: true,
          dealId: true,
          sharedAt: true,
          approvalStatus: true,
        },
      })
    : [];

  const quotes = deals.length
    ? await prisma.quote.findMany({
        where: { dealId: { in: deals.map((d) => d.id) } },
        select: { id: true, status: true, approvalStatus: true, number: true },
      })
    : [];

  console.log(
    JSON.stringify(
      {
        contact: contact
          ? {
              leadStatus: contact.person.leadStatus,
              contactType: contact.person.contactType,
              ownerUserId: contact.crm.ownerUserId,
            }
          : null,
        score,
        meetings: meetings.map((m) => ({
          id: m.id,
          subject: m.subject,
          dueAt: m.dueAt,
          completedAt: m.completedAt,
          transcriptLen: m.transcriptText?.length ?? 0,
          transcriptSource: m.transcriptSource,
          analyzedAt: m.transcriptAnalyzedAt,
          hasInsights: m.transcriptInsights != null,
        })),
        lifecycleJob: lifecycleJobRow[0] ?? null,
        proposals,
        quotes,
        deals,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
