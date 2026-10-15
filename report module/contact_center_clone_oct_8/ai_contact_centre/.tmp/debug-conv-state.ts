import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const convId = process.argv[2] ?? "1090";
  const assignments = await ccPrisma.$queryRaw`
    SELECT id::text, state, offered_at, expired_at, expires_at
    FROM ccass.conversation_assignments
    WHERE conversation_id = ${convId}::bigint
    ORDER BY offered_at DESC NULLS LAST
  `;
  const messages = await ccPrisma.$queryRaw`
    SELECT id::text, sender_type, left(body,100) body, delivery_state, created_at
    FROM ccass.conversation_messages
    WHERE conversation_id = ${convId}::bigint
    ORDER BY created_at DESC
  `;
  const presence = await ccPrisma.$queryRaw`
    SELECT presence_state, reason_code, lease_expires_at
    FROM ccass.agent_presence WHERE agent_id = 1003::bigint
  `;
  const attempts = await ccPrisma.$queryRaw`
    SELECT da.status, da.error_message, da.attempt_number, left(m.body,80) body
    FROM ccass.message_delivery_attempts da
    JOIN ccass.conversation_messages m ON m.id = da.message_id
    WHERE m.conversation_id = ${convId}::bigint
    ORDER BY da.attempt_number
  `;
  console.log(JSON.stringify({ assignments, messages, presence, attempts }, null, 2));
}

main().finally(() => ccPrisma.$disconnect());
