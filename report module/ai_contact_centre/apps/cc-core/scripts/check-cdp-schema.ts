import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const tables = await db.$queryRaw<Array<{ table_schema: string; table_name: string }>>`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema = 'cdp'
    ORDER BY table_name
  `;
  console.log(JSON.stringify({ tables }, null, 2));
});

await ccPrisma.$disconnect();
