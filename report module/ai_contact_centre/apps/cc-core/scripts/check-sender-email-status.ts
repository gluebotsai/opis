import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG = "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const SENDER = process.argv[2] ?? "bhrthsivakumar@gmail.com";

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG}, true)`;

  const conversations = await ccPrisma.$queryRaw<
    Array<{
      id: string;
      status: string;
      subject: string | null;
      priority: string | null;
      queued_at: Date | null;
      assigned_at: Date | null;
      accepted_at: Date | null;
      created_at: Date;
      updated_at: Date;
      assigned_agent_id: string | null;
      assigned_user_id: string | null;
      queue_id: string | null;
      queue_name: string | null;
      agent_email: string | null;
      agent_name: string | null;
      contact_email: string | null;
    }>
  >`
    SELECT 
      c.id,
      c.status,
      c.subject,
      c.priority,
      c.queued_at,
      c.assigned_at,
      c.accepted_at,
      c.created_at,
      c.updated_at,
      c.assigned_agent_id,
      c.assigned_user_id,
      c.queue_id,
      q.name AS queue_name,
      u.work_email AS agent_email,
      u.display_name AS agent_name,
      ct.email AS contact_email
    FROM ccass.conversations c
    LEFT JOIN ccass.queues q ON q.id = c.queue_id
    LEFT JOIN ccass.agents a ON a.id = c.assigned_agent_id
    LEFT JOIN accounts.setup_users u ON u.id = COALESCE(c.assigned_user_id, a.setup_user_id)
    LEFT JOIN cdp.contacts ct ON ct.id = c.contact_id
    WHERE c.organization_id = ${ORG}::bigint
      AND c.channel = 'email'
      AND lower(ct.email) = lower(${SENDER})
    ORDER BY c.updated_at DESC
    LIMIT 5
  `;

  const convIds = conversations.map((r) => r.id);

  const messages =
    convIds.length > 0
      ? await ccPrisma.$queryRaw<
          Array<{
            conversation_id: string;
            direction: string;
            subject: string | null;
            body_text: string | null;
            created_at: Date;
          }>
        >`
        SELECT conversation_id, direction, subject, left(body_text, 120) AS body_text, created_at
        FROM ccass.conversation_messages
        WHERE conversation_id = ANY(${convIds}::bigint[])
        ORDER BY created_at DESC
        LIMIT 10
      `
      : [];

  const routing =
    convIds.length > 0
      ? await ccPrisma.$queryRaw<
          Array<{
            conversation_id: string;
            outcome: string;
            reason: string | null;
            created_at: Date;
            agent_id: string | null;
          }>
        >`
        SELECT conversation_id, outcome, reason, created_at, agent_id
        FROM ccass.routing_attempts
        WHERE conversation_id = ANY(${convIds}::bigint[])
        ORDER BY created_at DESC
        LIMIT 10
      `
      : [];

  const emailAgentCapacity = await ccPrisma.$queryRaw<
    Array<{
      agent_id: string;
      work_email: string;
      display_name: string | null;
      presence_state: string | null;
      status: string | null;
      active_count: number;
      max_concurrent: number;
    }>
  >`
    SELECT a.id AS agent_id, u.work_email, u.display_name, ap.presence_state, ap.status,
           ac.active_count, ac.max_concurrent
    FROM ccass.agents a
    JOIN accounts.setup_users u ON u.id = a.setup_user_id
    LEFT JOIN ccass.agent_presence ap ON ap.agent_id = a.id
    LEFT JOIN ccass.agent_capacity ac ON ac.agent_id = a.id AND ac.channel = 'email'
    WHERE u.organization_id = ${ORG}::bigint
    ORDER BY u.work_email
  `;

  console.log(
    JSON.stringify(
      { sender: SENDER, conversations, recentMessages: messages, routingAttempts: routing, emailAgentCapacity },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => ccPrisma.$disconnect());
