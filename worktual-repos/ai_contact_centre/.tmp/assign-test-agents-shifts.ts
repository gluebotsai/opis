/**
 * Assign agent.test → Morning, agent2.test → Evening on support queue (org 1000).
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { publishQueueToRouting } from "../apps/cc-core/src/services/queue-publish.js";

const ORG_ID = process.env.ORGANIZATION_ID ?? "1000";
const QUEUE_ID = process.env.QUEUE_ID ?? "1001";

const ASSIGNMENTS = [
  { email: "agent.test@worktual.local", shiftType: "Morning" as const },
  { email: "agent2.test@worktual.local", shiftType: "Evening" as const },
];

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;

  for (const { email, shiftType } of ASSIGNMENTS) {
    const user = await ccPrisma.setup_users.findFirst({
      where: {
        organization_id: BigInt(ORG_ID),
        work_email: { equals: email, mode: "insensitive" },
      },
      select: { id: true, work_email: true, shift_types: true },
    });
    if (!user) {
      throw new Error(`User not found: ${email}`);
    }

    const userShifts = new Set(
      Array.isArray(user.shift_types) ? user.shift_types.map(String) : [],
    );
    userShifts.add(shiftType);

    await ccPrisma.setup_users.update({
      where: { id: user.id },
      data: {
        team_id: BigInt(ORG_ID),
        shift_types: [...userShifts],
      },
    });

    await ccPrisma.setup_ccaas_queue_agents.deleteMany({
      where: {
        queue_id: BigInt(QUEUE_ID),
        user_id: user.id,
        shift_type: "Regular",
      },
    });

    const existing = await ccPrisma.setup_ccaas_queue_agents.findFirst({
      where: {
        queue_id: BigInt(QUEUE_ID),
        user_id: user.id,
        shift_type: shiftType,
      },
      select: { id: true },
    });

    const memberData = {
      handles_calls: false,
      handles_email: true,
      handles_chat: true,
      handles_whatsapp: true,
      handles_instagram: true,
      handles_facebook: true,
      handles_social: true,
      chat_concurrency: 2,
      email_concurrency: 2,
      social_concurrency: 2,
      whatsapp_concurrency: 2,
      instagram_concurrency: 2,
      facebook_concurrency: 2,
      call_type: "both" as const,
    };

    if (existing) {
      await ccPrisma.setup_ccaas_queue_agents.update({
        where: { id: existing.id },
        data: memberData,
      });
    } else {
      await ccPrisma.setup_ccaas_queue_agents.create({
        data: {
          queue_id: BigInt(QUEUE_ID),
          user_id: user.id,
          shift_type: shiftType,
          ...memberData,
        },
      });
    }

    const agent = await ccPrisma.agents.findFirst({
      where: { organization_id: BigInt(ORG_ID), setup_user_id: user.id },
      select: { id: true },
    });
    if (!agent) {
      throw new Error(`Runtime agent not found for ${email}`);
    }

    for (const channel of ["chat", "email", "whatsapp", "instagram", "facebook", "social"] as const) {
      await ccPrisma.$executeRaw`
        INSERT INTO ccass.agent_capacity (
          organization_id, agent_id, channel, max_concurrency, reserved_count, active_count
        ) VALUES (
          ${ORG_ID}::bigint,
          ${agent.id}::bigint,
          ${channel},
          2,
          0,
          0
        )
        ON CONFLICT (agent_id, channel) DO UPDATE
          SET max_concurrency = 2, updated_at = NOW()
      `;
    }

    console.log(`Assigned ${email} → ${shiftType} (agent ${agent.id})`);
  }

  await publishQueueToRouting(ccPrisma, ORG_ID, QUEUE_ID);

  const members = await ccPrisma.$queryRaw`
    SELECT u.work_email, qa.shift_type, qa.handles_whatsapp
    FROM accounts.setup_ccaas_queue_agents qa
    JOIN accounts.setup_users u ON u.id = qa.user_id
    WHERE qa.queue_id = ${QUEUE_ID}::bigint
    ORDER BY qa.shift_type, u.work_email
  `;

  console.log(JSON.stringify({ queueId: QUEUE_ID, members }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
