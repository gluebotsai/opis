/**
 * Seed E2E support queue + agent.test / agent2.test on worktual_bigint org 1000.
 *
 * Usage:
 *   ORGANIZATION_ID=1000 npx tsx apps/cc-core/scripts/seed-e2e-support-setup.ts
 */
import "@ai-contact-center/config/load-root-env";
import bcrypt from "bcryptjs";
import { ccPrisma } from "@ai-contact-center/db-cc";

import { publishQueueToRouting } from "../src/services/queue-publish.js";

const ORG_ID = process.env.ORGANIZATION_ID ?? "1000";
const CONTACT_CENTER_PRODUCT = "contact-center";
const PASSWORD = process.env.PASSWORD ?? "Worktual@123";
const WEBCHAT_ID = process.env.PLAYWRIGHT_WEBCHAT_ID ?? "wc_5d80cd9b1ace4080bc70717552472611";
const QUEUE_NAME = process.env.E2E_QUEUE_NAME ?? "Support";
const CONCURRENCY = Number(process.env.E2E_AGENT_CONCURRENCY ?? "2");

const AGENTS = [
  { email: "agent.test@worktual.local", firstName: "Test", lastName: "Agent" },
  { email: "agent2.test@worktual.local", firstName: "Test", lastName: "Agent Two" },
] as const;

function orgBigInt(): bigint {
  return BigInt(ORG_ID);
}

async function resolveAgentRoleId(): Promise<bigint> {
  const role = await ccPrisma.setup_roles.findFirst({
    where: {
      organization_id: orgBigInt(),
      product_id: CONTACT_CENTER_PRODUCT,
      name: { equals: "Agent", mode: "insensitive" },
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!role) {
    throw new Error(`Agent role not found for org ${ORG_ID} / product ${CONTACT_CENTER_PRODUCT}`);
  }
  return role.id;
}

async function ensureSupportQueue(teamId: bigint): Promise<bigint> {
  const existing = await ccPrisma.setup_ccaas_queues.findFirst({
    where: { organization_id: orgBigInt(), name: QUEUE_NAME },
    select: { id: true },
  });
  if (existing) {
    await ccPrisma.setup_ccaas_queues.update({
      where: { id: existing.id },
      data: { status: "active", team_id: teamId, updated_at: new Date() },
    });
    return existing.id;
  }

  const created = await ccPrisma.setup_ccaas_queues.create({
    data: {
      organization_id: orgBigInt(),
      team_id: teamId,
      name: QUEUE_NAME,
      description: "E2E support queue",
      status: "active",
      shift_types: ["Regular"],
      skills: [],
    },
    select: { id: true },
  });
  return created.id;
}

async function upsertAgentUser(
  roleId: bigint,
  account: (typeof AGENTS)[number],
): Promise<bigint> {
  const email = account.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const existing = await ccPrisma.setup_users.findFirst({
    where: {
      organization_id: orgBigInt(),
      work_email: { equals: email, mode: "insensitive" },
    },
    select: {
      id: true,
      setup_user_product_access: {
        where: { product_id: CONTACT_CENTER_PRODUCT },
        select: { id: true },
      },
    },
  });

  if (existing) {
    await ccPrisma.setup_users.update({
      where: { id: existing.id },
      data: {
        first_name: account.firstName,
        last_name: account.lastName,
        status: "active",
        invite_status: "active",
        password_hash: passwordHash,
        password_set_at: new Date(),
        shift_types: ["Regular"],
      },
    });
    if (existing.setup_user_product_access.length === 0) {
      await ccPrisma.setup_user_product_access.create({
        data: {
          organization_id: orgBigInt(),
          user_id: existing.id,
          product_id: CONTACT_CENTER_PRODUCT,
          role_id: roleId,
        },
      });
    } else {
      await ccPrisma.setup_user_product_access.updateMany({
        where: { user_id: existing.id, product_id: CONTACT_CENTER_PRODUCT },
        data: { role_id: roleId },
      });
    }
    return existing.id;
  }

  const user = await ccPrisma.setup_users.create({
    data: {
      organization_id: orgBigInt(),
      first_name: account.firstName,
      last_name: account.lastName,
      work_email: email,
      status: "active",
      invite_status: "active",
      password_hash: passwordHash,
      password_set_at: new Date(),
      shift_types: ["Regular"],
      setup_user_product_access: {
        create: {
          organization_id: orgBigInt(),
          product_id: CONTACT_CENTER_PRODUCT,
          role_id: roleId,
        },
      },
    },
    select: { id: true },
  });
  return user.id;
}

async function ensureQueueMember(queueId: bigint, userId: bigint, teamId: bigint) {
  await ccPrisma.setup_users.update({
    where: { id: userId },
    data: { team_id: teamId },
  });

  const memberData = {
    handles_calls: false,
    handles_email: true,
    handles_chat: true,
    handles_social: true,
    handles_whatsapp: true,
    handles_instagram: true,
    handles_facebook: true,
    chat_concurrency: CONCURRENCY,
    email_concurrency: CONCURRENCY,
    social_concurrency: CONCURRENCY,
    whatsapp_concurrency: CONCURRENCY,
    instagram_concurrency: CONCURRENCY,
    facebook_concurrency: CONCURRENCY,
    call_type: "both" as const,
    shift_type: "Regular",
  };

  const existing = await ccPrisma.setup_ccaas_queue_agents.findFirst({
    where: { queue_id: queueId, user_id: userId, shift_type: "Regular" },
    select: { id: true },
  });

  if (existing) {
    await ccPrisma.setup_ccaas_queue_agents.update({
      where: { id: existing.id },
      data: memberData,
    });
  } else {
    await ccPrisma.setup_ccaas_queue_agents.create({
      data: { queue_id: queueId, user_id: userId, ...memberData },
    });
  }
}

async function ensureRuntimeAgentCapacity(userId: bigint, email: string): Promise<bigint> {
  const displayName = email.split("@")[0] ?? "Agent";
  const existing = await ccPrisma.agents.findFirst({
    where: { organization_id: orgBigInt(), setup_user_id: userId },
    select: { id: true },
  });

  const agent = existing
    ? await ccPrisma.agents.update({
        where: { id: existing.id },
        data: {
          display_name: displayName,
          email,
          updated_at: new Date(),
        },
        select: { id: true },
      })
    : await ccPrisma.agents.create({
        data: {
          organization_id: orgBigInt(),
          setup_user_id: userId,
          display_name: displayName,
          email,
          status: "offline",
        },
        select: { id: true },
      });

  await ccPrisma.agent_presence.upsert({
    where: { agent_id: agent.id },
    create: {
      organization_id: orgBigInt(),
      agent_id: agent.id,
      status: "ready",
      presence_state: "ready",
      source: "e2e_seed",
      heartbeat_at: new Date(),
      lease_expires_at: new Date(Date.now() + 90_000),
    },
    update: {
      status: "ready",
      presence_state: "ready",
      source: "e2e_seed",
      heartbeat_at: new Date(),
      lease_expires_at: new Date(Date.now() + 90_000),
    },
  });

  for (const channel of ["chat", "email", "whatsapp", "instagram", "facebook", "social"] as const) {
    await ccPrisma.$executeRaw`
      INSERT INTO ccass.agent_capacity (
        organization_id, agent_id, channel, max_concurrency, reserved_count, active_count
      ) VALUES (
        ${ORG_ID}::bigint,
        ${agent.id}::bigint,
        ${channel},
        ${CONCURRENCY},
        0,
        0
      )
      ON CONFLICT (agent_id, channel) DO UPDATE
        SET max_concurrency = ${CONCURRENCY}, updated_at = NOW()
    `;
  }

  return agent.id;
}

async function ensureWebchatChannel(queueId: bigint): Promise<void> {
  const existingWebchat = await ccPrisma.setup_webchat_configs.findUnique({
    where: { webchat_id: WEBCHAT_ID },
    select: { channel_config_id: true },
  });

  let channelConfigId: bigint;
  if (existingWebchat) {
    channelConfigId = existingWebchat.channel_config_id;
    await ccPrisma.setup_channel_configs.update({
      where: { id: channelConfigId },
      data: { status: "active", updated_at: new Date() },
    });
  } else {
    const created = await ccPrisma.setup_channel_configs.create({
      data: {
        organization_id: orgBigInt(),
        channel_type: "webchat",
        name: "E2E Webchat",
        status: "active",
        product_ids: [CONTACT_CENTER_PRODUCT],
      },
      select: { id: true },
    });
    channelConfigId = created.id;
  }

  await ccPrisma.setup_webchat_configs.upsert({
    where: { webchat_id: WEBCHAT_ID },
    create: {
      webchat_id: WEBCHAT_ID,
      channel_config_id: channelConfigId,
      title: "E2E Support Webchat",
      alias_title: "Support",
      greeting_message: "Hello! How can we help you today?",
      routing_queue_id: queueId,
      personalisation: {},
    },
    update: {
      routing_queue_id: queueId,
      title: "E2E Support Webchat",
      updated_at: new Date(),
    },
  });
}

async function ensureRoutingPolicy(queueId: bigint): Promise<void> {
  await ccPrisma.$executeRaw`
    INSERT INTO ccass.routing_policies (
      organization_id, queue_id, strategy, offer_timeout_seconds, max_attempts
    ) VALUES (
      ${ORG_ID}::bigint,
      ${queueId}::bigint,
      'skill_round_robin',
      20,
      3
    )
    ON CONFLICT (queue_id) DO UPDATE
      SET offer_timeout_seconds = 20, updated_at = NOW()
  `;
}

async function main() {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;

  const org = await ccPrisma.organizations.findUnique({
    where: { id: orgBigInt() },
    select: { company_name: true, tenant_id: true },
  });
  if (!org) {
    throw new Error(`Organization ${ORG_ID} not found`);
  }

  let team = await ccPrisma.setup_teams.findFirst({
    where: { organization_id: orgBigInt(), status: "active" },
    orderBy: { id: "asc" },
    select: { id: true, name: true },
  });
  if (!team) {
    team = await ccPrisma.setup_teams.create({
      data: {
        organization_id: orgBigInt(),
        name: "Support Team",
        status: "active",
      },
      select: { id: true, name: true },
    });
  }

  const roleId = await resolveAgentRoleId();
  const queueId = await ensureSupportQueue(team.id);

  const provisioned: Array<{
    email: string;
    userId: string;
    agentId: string;
  }> = [];

  for (const account of AGENTS) {
    const userId = await upsertAgentUser(roleId, account);
    await ensureQueueMember(queueId, userId, team.id);
    const agentId = await ensureRuntimeAgentCapacity(userId, account.email);
    provisioned.push({
      email: account.email,
      userId: String(userId),
      agentId: String(agentId),
    });
  }

  await ensureWebchatChannel(queueId);
  await publishQueueToRouting(ccPrisma, ORG_ID, String(queueId));
  await ensureRoutingPolicy(queueId);

  console.log(
    JSON.stringify(
      {
        organizationId: ORG_ID,
        organizationName: org.company_name,
        tenantSlug: org.tenant_id,
        teamId: String(team.id),
        teamName: team.name,
        queueId: String(queueId),
        queueName: QUEUE_NAME,
        webchatId: WEBCHAT_ID,
        agentConcurrency: CONCURRENCY,
        password: PASSWORD,
        agents: provisioned,
        loginUrl: "http://localhost:5173/login",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
