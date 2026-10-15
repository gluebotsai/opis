import "@ai-contact-center/config/load-root-env";
import { PrismaClient } from "../src/generated/index.js";

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const tables = await db.$queryRaw<{ table_schema: string; table_name: string }[]>`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = 'cdp'
        AND table_name IN ('customer_profile', 'identity_keys', 'contacts', 'contact_identities')
      ORDER BY table_name
    `;
    const profileCols = await db.$queryRaw<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'cdp' AND table_name = 'customer_profile'
      ORDER BY ordinal_position
    `;
    const identityCols = await db.$queryRaw<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'cdp' AND table_name = 'identity_keys'
      ORDER BY ordinal_position
    `;
    console.log("CDP contact tables:", tables);
    console.log("cdp.customer_profile columns:", profileCols);
    console.log("cdp.identity_keys columns:", identityCols);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
