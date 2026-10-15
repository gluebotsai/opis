import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG = process.env.ORGANIZATION_ID ?? "1000";
const EMAIL = process.argv[2] ?? "agent.test@worktual.local";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG}, true)`;

  const agent = await ccPrisma.$queryRaw<
    Array<{ agent_id: string; work_email: string; presence_state: string | null; status: string | null }>
  >`
    SELECT a.id AS agent_id, u.work_email, ap.presence_state, ap.status
    FROM ccass.agents a
    JOIN accounts.setup_users u ON u.id = a.setup_user_id
    LEFT JOIN ccass.agent_presence ap ON ap.agent_id = a.id
    WHERE u.organization_id = ${ORG}::bigint AND lower(u.work_email) = lower(${EMAIL})
  `;

  const agentId = agent[0]?.agent_id;
  if (!agentId) {
    console.log(JSON.stringify({ error: "agent not found", email: EMAIL }, null, 2));
    return;
  }

  const capacity = await ccPrisma.$queryRaw`
    SELECT channel, active_count, reserved_count, max_concurrency
    FROM ccass.agent_capacity WHERE agent_id = ${agentId}::bigint
  `;

  const statusCounts = await ccPrisma.$queryRaw`
    SELECT status, channel, COUNT(*)::int AS count
    FROM ccass.conversations
    WHERE organization_id = ${ORG}::bigint AND assigned_agent_id = ${agentId}::bigint
    GROUP BY status, channel ORDER BY channel, status
  `;

  const activeEmail = await ccPrisma.$queryRaw`
    SELECT id, status, subject, channel, assigned_at, updated_at, closed_at, resolved_at
    FROM ccass.conversations
    WHERE organization_id = ${ORG}::bigint
      AND assigned_agent_id = ${agentId}::bigint
      AND channel = 'email'
      AND status IN ('active', 'assigned', 'offered', 'accepted', 'waiting', 'queued')
    ORDER BY updated_at DESC
  `;

  const allAssigned = await ccPrisma.$queryRaw`
    SELECT id, status, subject, channel, assigned_at, updated_at, closed_at, resolved_at
    FROM ccass.conversations
    WHERE organization_id = ${ORG}::bigint AND assigned_agent_id = ${agentId}::bigint
    ORDER BY updated_at DESC LIMIT 15
  `;

  console.log(
    JSON.stringify({ agent, capacity, statusCounts, activeEmail, allAssigned }, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    2),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => ccPrisma.$disconnect());
