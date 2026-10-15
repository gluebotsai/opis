/**
 * Configure worktual1 org for contact-center email bot (channel credentials only).
 *
 * - Enables email on pre-sales queue + test agent
 * - Upserts mailbox policy (channel_config_id as connectionId)
 * - Publishes queue to ccass routing
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/setup-worktual1-email.ts
 *   npx tsx apps/cc-core/scripts/setup-worktual1-email.ts --live
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { publishQueueToRouting } from "../src/services/queue-publish.js";
import {
  resolveEmailMailboxPolicy,
  upsertEmailMailboxPolicy,
} from "../src/services/email-policies.js";

const ORG_ID = "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const QUEUE_ID = "81019f3d-826b-498f-8273-18abe4df6dba"; // pre sales
const CHANNEL_ID = "0d720f7e-3f00-44b6-954a-31fe175dfc68";
const MAILBOX = "sample151102@gmail.com";
const AGENT_EMAIL = "agent.test@worktual.local";

const live = process.argv.includes("--live");

await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;

  const channel = await db.$queryRaw<
    Array<{ oauth_connection_id: string | null; needs_reauth: boolean | null; scope: string | null }>
  >`
    SELECT ec.oauth_connection_id, oauth.needs_reauth, oauth.scope
    FROM accounts.setup_channel_configs cc
    INNER JOIN accounts.setup_email_configs ec ON ec.channel_config_id = cc.id
    LEFT JOIN accounts.mail_oauth_connections oauth ON oauth.id = ec.oauth_connection_id
    WHERE cc.id = ${CHANNEL_ID}::bigint
      AND cc.organization_id = ${ORG_ID}::bigint
      AND cc.channel_type = 'email'
      AND cc.status = 'active'
    LIMIT 1
  `;
  const row = channel[0];
  if (!row?.oauth_connection_id || row.needs_reauth || !row.scope) {
    throw new Error(
      `Email channel ${CHANNEL_ID} missing valid OAuth on setup tables. Reconnect Google on this channel.`,
    );
  }
});

await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await db.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

  const org = await db.organizations.findUnique({
    where: { id: ORG_ID },
    select: { company_name: true },
  });
  if (!org || org.company_name?.toLowerCase() !== "worktual1") {
    throw new Error(`Expected worktual1 org at ${ORG_ID}, found ${org?.company_name ?? "missing"}`);
  }

  const channel = await db.$queryRaw<
    Array<{
      channel_config_id: string;
      account_email: string;
      oauth_connection_id: string | null;
      needs_reauth: boolean | null;
      scope: string | null;
    }>
  >`
    SELECT
      cc.id AS channel_config_id,
      COALESCE(NULLIF(trim(ec.sender_email), ''), oauth.account_email) AS account_email,
      ec.oauth_connection_id,
      oauth.needs_reauth,
      oauth.scope
    FROM accounts.setup_channel_configs cc
    INNER JOIN accounts.setup_email_configs ec ON ec.channel_config_id = cc.id
    LEFT JOIN accounts.mail_oauth_connections oauth ON oauth.id = ec.oauth_connection_id
    WHERE cc.id = ${CHANNEL_ID}::bigint
      AND cc.organization_id = ${ORG_ID}::bigint
      AND cc.channel_type = 'email'
      AND cc.status = 'active'
    LIMIT 1
  `;

  const row = channel[0];
  if (!row?.oauth_connection_id || row.needs_reauth || !row.scope) {
    throw new Error(
      `Email channel ${CHANNEL_ID} missing valid OAuth on setup tables. Reconnect Google on this channel.`,
    );
  }

  const agentUser = await db.setup_users.findFirst({
    where: {
      organization_id: ORG_ID,
      work_email: { equals: AGENT_EMAIL, mode: "insensitive" },
      status: "active",
    },
    select: { id: true, work_email: true },
  });
  if (!agentUser) {
    throw new Error(`Agent user not found: ${AGENT_EMAIL}. Run seed:worktual-test-accounts first.`);
  }

  await db.setup_ccaas_queue_agents.updateMany({
    where: { queue_id: QUEUE_ID, user_id: agentUser.id },
    data: {
      handles_email: true,
      email_concurrency: 3,
    },
  });
});

await publishQueueToRouting(ccPrisma, ORG_ID, QUEUE_ID);

const result = await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await db.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

  const org = await db.organizations.findUnique({
    where: { id: ORG_ID },
    select: { company_name: true },
  });

  const agentUser = await db.setup_users.findFirst({
    where: {
      organization_id: ORG_ID,
      work_email: { equals: AGENT_EMAIL, mode: "insensitive" },
    },
    select: { id: true, work_email: true },
  });

  const runtimeAgent = await db.agents.findFirst({
    where: { organization_id: ORG_ID, setup_user_id: agentUser!.id },
    select: { id: true },
  });
  if (!runtimeAgent) {
    throw new Error(`Runtime agent missing for ${AGENT_EMAIL}`);
  }

  await db.$executeRaw`
    INSERT INTO ccass.agent_capacity (
      organization_id, agent_id, channel, max_concurrency, reserved_count, active_count
    ) VALUES (
      ${ORG_ID}::bigint,
      ${runtimeAgent.id}::bigint,
      'email',
      3,
      0,
      0
    )
    ON CONFLICT (agent_id, channel) DO UPDATE
      SET max_concurrency = 3, updated_at = NOW()
  `;

  const policy = await upsertEmailMailboxPolicy(db, ORG_ID, {
    connectionId: CHANNEL_ID,
    accountEmail: MAILBOX,
    botEnabled: true,
    liveAgentEnabled: true,
    shadowMode: !live,
    autoSendEnabled: live,
    confidenceThreshold: 0.85,
    defaultQueueId: QUEUE_ID,
    allowedQueueIds: [QUEUE_ID],
    approvedServiceMessage: null,
  });

  const resolved = await resolveEmailMailboxPolicy(db, ORG_ID, {
    connectionId: CHANNEL_ID,
    accountEmail: MAILBOX,
  });

  const members = await db.$queryRaw<
    Array<{ queue_name: string; agent_email: string; handles_email: boolean; email_concurrency: number }>
  >`
    SELECT q.name AS queue_name, u.work_email AS agent_email, m.handles_email, m.email_concurrency
    FROM ccass.queue_members m
    JOIN ccass.queues q ON q.id = m.queue_id
    JOIN ccass.agents a ON a.id = m.agent_id
    JOIN accounts.setup_users u ON u.id = a.setup_user_id
    WHERE q.organization_id = ${ORG_ID}::bigint
      AND m.handles_email = TRUE
  `;

  return {
    organization: { id: ORG_ID, name: org!.company_name },
    channel: { id: CHANNEL_ID, mailbox: MAILBOX },
    queue: { id: QUEUE_ID, name: "pre sales" },
    agent: { email: agentUser!.work_email, runtimeAgentId: runtimeAgent.id },
    policy,
    resolved,
    emailEnabledMembers: members,
    mode: live ? "live-auto-send" : "shadow",
  };
});

console.log(JSON.stringify(result, null, 2));

await ccPrisma.$disconnect();
