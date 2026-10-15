import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG = "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const PHONE = process.argv[2] ?? "919150911820";
const EMAIL = process.argv[3] ?? "bhrthsivakumar@gmail.com";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG}, true)`;

  const convs = await ccPrisma.$queryRaw`
    SELECT c.id, c.channel, c.status, c.contact_id, c.visitor_id, c.subject,
           cp.first_name, cp.last_name
    FROM ccass.conversations c
    LEFT JOIN cdp.customer_profile cp ON cp.cdp_id = c.contact_id::text
    WHERE c.organization_id = ${ORG}::bigint
      AND (
        lower(c.visitor_id) = lower(${EMAIL})
        OR c.visitor_id LIKE ${`%${PHONE}%`}
        OR c.visitor_id = ${PHONE}
      )
    ORDER BY c.updated_at DESC
    LIMIT 20
  `;

  const keys = await ccPrisma.$queryRaw`
    SELECT ik.key_type, ik.key_value, ik.cdp_id,
           cp.first_name, cp.last_name
    FROM cdp.identity_keys ik
    JOIN cdp.customer_profile cp ON cp.cdp_id = ik.cdp_id
    WHERE ik.organization_id = ${ORG}::bigint
      AND (
        lower(ik.key_value) = lower(${EMAIL})
        OR ik.key_value LIKE ${`%${PHONE}%`}
      )
    ORDER BY ik.key_type
  `;

  console.log(JSON.stringify({ conversations: convs, identityKeys: keys }, null, 2));
}

main().finally(() => ccPrisma.$disconnect());
