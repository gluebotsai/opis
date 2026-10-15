import { prisma } from "../src/dao/db/prisma.js";

const contactId = process.argv[2] || "723c9f6a-4b90-4221-9411-3d17835144e0";
const activityId = process.argv[3] || "cmt2ptmeg00001aq86l5t4qbq";

const audits = await prisma.auditLog.findMany({
  where: {
    OR: [
      { meta: { path: ["contactId"], equals: contactId } },
      { entityId: activityId },
    ],
    meta: { path: ["agent"], string_contains: "" },
  },
  orderBy: { createdAt: "desc" },
  take: 30,
  select: { action: true, entityType: true, entityId: true, meta: true, createdAt: true },
});

// simpler raw query for agent audits
const agentAudits = await prisma.$queryRawUnsafe<
  Record<string, unknown>[]
>(
  `
  SELECT created_at, meta
  FROM crm.audit_logs
  WHERE (meta->>'contactId' = $1 OR entity_id = $2)
    AND meta->>'agent' IN ('meeting_mom', 'post_meeting_process')
  ORDER BY created_at DESC
  LIMIT 15
  `,
  contactId,
  activityId,
);

const notifications = await prisma.$queryRawUnsafe<
  Record<string, unknown>[]
>(
  `
  SELECT id, kind, title, recipient_user_id, created_at, read_at
  FROM crm.notifications
  WHERE contact_id = $1::text
     OR kind IN ('meeting_mom', 'post_meeting_draft_ready', 'post_meeting_quote_incomplete')
  ORDER BY created_at DESC
  LIMIT 20
  `,
  contactId,
);

const meeting = await prisma.contactActivity.findUnique({
  where: { id: activityId },
  select: { momSentAt: true, transcriptText: true },
});

console.log(
  JSON.stringify(
    {
      meeting: {
        momSentAt: meeting?.momSentAt,
        transcriptLen: meeting?.transcriptText?.length ?? 0,
      },
      agentAudits,
      notifications,
    },
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);

await prisma.$disconnect();
