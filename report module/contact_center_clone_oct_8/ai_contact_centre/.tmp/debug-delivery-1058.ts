import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;

  const rows = await ccPrisma.$queryRaw`
    SELECT m.id::text, left(m.body, 100) AS body, m.delivery_state, m.created_at,
           da.status, da.error_message, da.attempt_number, da.provider_response
    FROM ccass.conversation_messages m
    LEFT JOIN ccass.message_delivery_attempts da ON da.message_id = m.id
    WHERE m.organization_id = 1000
      AND m.conversation_id = 1058::bigint
      AND m.sender_type = 'system'
    ORDER BY m.created_at DESC, da.attempt_number NULLS LAST
  `;

  const presence = await ccPrisma.$queryRaw`
    SELECT ap.presence_state, ap.reason_code, ap.status, ap.lease_expires_at, ap.heartbeat_at
    FROM ccass.agent_presence ap
    WHERE ap.agent_id = 1003::bigint
  `;

  console.log(JSON.stringify({ messages: rows, presence }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => ccPrisma.$disconnect());
