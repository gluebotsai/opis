import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const ORG = "1000";

  const queue = await ccPrisma.$queryRaw`
    SELECT q.id::text, q.name, q.shift_types, q.business_hours_id::text,
      bh.name AS hours_name, bh.open_time, bh.close_time, bh.working_days, bh.timezone
    FROM accounts.setup_ccaas_queues q
    LEFT JOIN accounts.setup_business_hours bh ON bh.id = q.business_hours_id
    WHERE q.organization_id = ${ORG}::bigint AND q.id = 1001::bigint
  `;

  const shifts = await ccPrisma.$queryRaw`
    SELECT bh.name AS hours_name, s.shift_type, s.day_of_week, s.start_time, s.end_time, s.crosses_midnight
    FROM accounts.setup_business_hour_shifts s
    JOIN accounts.setup_business_hours bh ON bh.id = s.business_hours_id
    WHERE bh.organization_id = ${ORG}::bigint
    ORDER BY bh.name, s.shift_type, s.day_of_week
  `;

  const allHours = await ccPrisma.$queryRaw`
    SELECT id::text, name, open_time, close_time, working_days, timezone, status
    FROM accounts.setup_business_hours
    WHERE organization_id = ${ORG}::bigint
    ORDER BY name
  `;

  console.log(JSON.stringify({ queue, allHours, shifts }, null, 2));
}

main().catch(console.error).finally(() => ccPrisma.$disconnect());
