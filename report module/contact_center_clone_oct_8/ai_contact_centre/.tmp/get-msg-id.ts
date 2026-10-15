import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
const rows = await ccPrisma.$queryRaw<{ id: string }[]>`
  SELECT id::text FROM ccass.conversation_messages
  WHERE conversation_id = 1057::bigint AND direction = 'inbound'
  ORDER BY created_at DESC LIMIT 1
`;
console.log(rows[0]?.id ?? "none");
await ccPrisma.$disconnect();
