import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG_ID = "1000";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

  await ccPrisma.$executeRaw`
    UPDATE ccass.conversation_assignments
    SET state = 'ended', ended_at = NOW(), reason = 'test_cleanup'
    WHERE organization_id = ${ORG_ID}::bigint
      AND state IN ('offered', 'accepted')
      AND conversation_id IN (
        SELECT id FROM ccass.conversations
        WHERE organization_id = ${ORG_ID}::bigint
          AND channel = 'webchat'
          AND status IN ('active', 'assigned', 'queued', 'bot_active')
      )
  `;

  await ccPrisma.$executeRaw`
    UPDATE ccass.conversations
    SET
      status = 'resolved',
      lifecycle_state = 'ended',
      bot_active = FALSE,
      assigned_agent_id = NULL,
      assigned_user_id = NULL,
      resolved_at = COALESCE(resolved_at, NOW()),
      ended_at = NOW(),
      end_reason = 'test_cleanup',
      end_actor = 'system',
      updated_at = NOW()
    WHERE organization_id = ${ORG_ID}::bigint
      AND channel = 'webchat'
      AND status IN ('active', 'assigned', 'queued', 'bot_active')
  `;

  await ccPrisma.$executeRaw`
    UPDATE ccass.agent_capacity ac
    SET active_count = 0, reserved_count = 0, updated_at = NOW()
    FROM ccass.agents a
    WHERE ac.agent_id = a.id
      AND a.organization_id = ${ORG_ID}::bigint
      AND ac.channel = 'chat'
  `;

  console.log("cleanup ok");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
