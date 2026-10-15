/**
 * Enable Instagram + Facebook routing for an agent on a queue.
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/enable-social-queue-agent.ts --email agent.test@worktual.local
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { publishQueueToRouting } from "../src/services/queue-publish.js";

const ORG_ID = process.env.ORGANIZATION_ID ?? "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const QUEUE_ID = process.env.WEBCHAT_QUEUE_ID ?? "f5d9f6f7-b1db-4494-b400-f5437051ec03";

const emailArgIndex = process.argv.indexOf("--email");
const email = (emailArgIndex >= 0 ? process.argv[emailArgIndex + 1] : "agent.test@worktual.local")
  .trim()
  .toLowerCase();

async function main() {
  const user = await ccPrisma.setup_users.findFirst({
    where: {
      organization_id: ORG_ID,
      work_email: { equals: email, mode: "insensitive" },
    },
    select: { id: true, work_email: true },
  });
  if (!user) {
    throw new Error(`Agent user not found: ${email}`);
  }

  const existing = await ccPrisma.setup_ccaas_queue_agents.findFirst({
    where: {
      queue_id: QUEUE_ID,
      user_id: user.id,
      shift_type: "Regular",
    },
    select: { id: true },
  });

  if (existing) {
    await ccPrisma.setup_ccaas_queue_agents.update({
      where: { id: existing.id },
      data: {
        handles_instagram: true,
        handles_facebook: true,
        handles_social: true,
        instagram_concurrency: 3,
        facebook_concurrency: 3,
      },
    });
  } else {
    await ccPrisma.setup_ccaas_queue_agents.create({
      data: {
        queue_id: QUEUE_ID,
        user_id: user.id,
        shift_type: "Regular",
        handles_chat: true,
        chat_concurrency: 3,
        handles_instagram: true,
        handles_facebook: true,
        handles_social: true,
        instagram_concurrency: 3,
        facebook_concurrency: 3,
        handles_calls: false,
        handles_email: false,
        call_type: "both",
      },
    });
  }

  const agent = await ccPrisma.agents.findFirst({
    where: { organization_id: ORG_ID, setup_user_id: user.id },
    select: { id: true },
  });
  if (agent) {
    for (const channel of ["instagram", "facebook"] as const) {
      await ccPrisma.$executeRaw`
        INSERT INTO ccass.agent_capacity (
          organization_id, agent_id, channel, max_concurrency, reserved_count, active_count
        ) VALUES (
          ${ORG_ID}::bigint,
          ${agent.id}::bigint,
          ${channel},
          3,
          0,
          0
        )
        ON CONFLICT (agent_id, channel) DO UPDATE
          SET max_concurrency = 3, updated_at = NOW()
      `;
    }
  }

  await publishQueueToRouting(ccPrisma, ORG_ID, QUEUE_ID);

  const members = await ccPrisma.$queryRaw<
    Array<{
      setup_user_id: string;
      handles_instagram: boolean;
      handles_facebook: boolean;
      handles_chat: boolean;
    }>
  >`
    SELECT setup_user_id, handles_instagram, handles_facebook, handles_chat
    FROM ccass.queue_members
    WHERE queue_id = ${QUEUE_ID}::bigint
  `;

  console.log(
    JSON.stringify(
      {
        organizationId: ORG_ID,
        queueId: QUEUE_ID,
        email: user.work_email,
        userId: user.id,
        agentId: agent?.id ?? null,
        queueMembers: members,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
