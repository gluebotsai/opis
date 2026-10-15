/**
 * Create Worktual test admin + agent accounts with routing setup for live-agent testing.
 *
 * Usage:
 *   npm run seed:worktual-test-accounts -w cc-core
 */
import "@ai-contact-center/config/load-root-env";
import bcrypt from "bcryptjs";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { publishQueueToRouting } from "../src/services/queue-publish.js";

const ORG_ID = process.env.ORGANIZATION_ID ?? "1000";
const WEBCHAT_QUEUE_ID = process.env.WEBCHAT_QUEUE_ID ?? "f5d9f6f7-b1db-4494-b400-f5437051ec03";
const CONTACT_CENTER_PRODUCT = "contact-center";
const PASSWORD = process.env.PASSWORD ?? "Worktual@123";

type TestAccount = {
  email: string;
  firstName: string;
  lastName: string;
  roleName: "Admin" | "Agent";
  provisionAgent: boolean;
};

const ACCOUNTS: TestAccount[] = [
  {
    email: "admin.test@worktual.local",
    firstName: "Test",
    lastName: "Admin",
    roleName: "Admin",
    provisionAgent: false,
  },
  {
    email: "agent.test@worktual.local",
    firstName: "Test",
    lastName: "Agent",
    roleName: "Agent",
    provisionAgent: true,
  },
  {
    email: "agent2.test@worktual.local",
    firstName: "Test",
    lastName: "Agent Two",
    roleName: "Agent",
    provisionAgent: true,
  },
  {
    email: "yaswanthmg1@gmail.com",
    firstName: "Yaswanth",
    lastName: "MG",
    roleName: "Agent",
    provisionAgent: true,
  },
];

async function resolveRoleId(roleName: string): Promise<string> {
  const role = await ccPrisma.setup_roles.findFirst({
    where: {
      organization_id: ORG_ID,
      name: { equals: roleName, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });
  if (!role) {
    throw new Error(`Role "${roleName}" not found for organization ${ORG_ID}`);
  }
  return role.id;
}

async function upsertAccount(account: TestAccount): Promise<{ id: string; email: string } | null> {
  const roleId = await resolveRoleId(account.roleName);
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const email = account.email.trim().toLowerCase();

  const existing = await ccPrisma.setup_users.findFirst({
    where: {
      work_email: { equals: email, mode: "insensitive" },
    },
    select: {
      id: true,
      work_email: true,
      organization_id: true,
      setup_user_product_access: {
        where: { product_id: CONTACT_CENTER_PRODUCT },
        select: { id: true },
      },
    },
  });

  if (existing && existing.organization_id !== ORG_ID) {
    console.warn(
      `Skipping ${email}: already exists in organization ${existing.organization_id}, not ${ORG_ID}`,
    );
    return null;
  }

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
      },
      select: { id: true },
    });

    if (existing.setup_user_product_access.length === 0) {
      await ccPrisma.setup_user_product_access.create({
        data: {
          organization_id: ORG_ID,
          user_id: existing.id,
          product_id: CONTACT_CENTER_PRODUCT,
          role_id: roleId,
        },
      });
    } else {
      await ccPrisma.setup_user_product_access.updateMany({
        where: {
          user_id: existing.id,
          product_id: CONTACT_CENTER_PRODUCT,
        },
        data: { role_id: roleId },
      });
    }

    return { id: existing.id, email };
  }

  const user = await ccPrisma.setup_users.create({
    data: {
      organization_id: ORG_ID,
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
          organization_id: ORG_ID,
          product_id: CONTACT_CENTER_PRODUCT,
          role_id: roleId,
        },
      },
    },
    select: { id: true, work_email: true },
  });

  return { id: user.id, email: user.work_email };
}

async function provisionAgentUser(
  userId: string,
  email: string,
  firstName: string,
  lastName: string,
  queueTeamId: string,
) {
  const displayName = `${firstName} ${lastName}`.trim();

  const existingAgent = await ccPrisma.agents.findFirst({
    where: { organization_id: ORG_ID, setup_user_id: userId },
    select: { id: true },
  });

  const agent = existingAgent
    ? await ccPrisma.agents.update({
        where: { id: existingAgent.id },
        data: {
          display_name: displayName,
          email,
          updated_at: new Date(),
        },
        select: { id: true },
      })
    : await ccPrisma.agents.create({
        data: {
          organization_id: ORG_ID,
          setup_user_id: userId,
          display_name: displayName,
          email,
          status: "offline",
        },
        select: { id: true },
      });

  await ccPrisma.setup_users.update({
    where: { id: userId },
    data: { team_id: queueTeamId },
  });

  const existingQueueAgent = await ccPrisma.setup_ccaas_queue_agents.findFirst({
    where: {
      queue_id: WEBCHAT_QUEUE_ID,
      user_id: userId,
      shift_type: "Regular",
    },
    select: { id: true },
  });

  if (existingQueueAgent) {
    await ccPrisma.setup_ccaas_queue_agents.update({
      where: { id: existingQueueAgent.id },
      data: {
        handles_chat: true,
        chat_concurrency: 3,
        handles_instagram: true,
        handles_facebook: true,
        handles_social: true,
        instagram_concurrency: 3,
        facebook_concurrency: 3,
      },
    });
  } else {
    await ccPrisma.setup_ccaas_queue_agents.create({
      data: {
        queue_id: WEBCHAT_QUEUE_ID,
        user_id: userId,
        handles_chat: true,
        chat_concurrency: 3,
        handles_instagram: true,
        handles_facebook: true,
        handles_social: true,
        instagram_concurrency: 3,
        facebook_concurrency: 3,
        handles_calls: false,
        handles_email: false,
        shift_type: "Regular",
        call_type: "both",
      },
    });
  }

  await publishQueueToRouting(ccPrisma, ORG_ID, WEBCHAT_QUEUE_ID);

  for (const channel of ["chat", "instagram", "facebook"] as const) {
    await ccPrisma.$executeRaw`
      INSERT INTO ccass.agent_capacity (
        organization_id, agent_id, channel, max_concurrency, reserved_count, active_count
      ) VALUES (
        ${ORG_ID}::bigint,
        ${agent.id}::bigint,
        ${channel},
        3,
        0,
        0
      )
      ON CONFLICT (agent_id, channel) DO UPDATE
        SET max_concurrency = 3, updated_at = NOW()
    `;
  }

  return agent.id;
}

async function main() {
  const org = await ccPrisma.organizations.findUnique({
    where: { id: ORG_ID },
    select: { company_name: true },
  });
  if (!org) {
    throw new Error(`Organization not found: ${ORG_ID}`);
  }

  const queue = await ccPrisma.setup_ccaas_queues.findFirst({
    where: { id: WEBCHAT_QUEUE_ID, organization_id: ORG_ID },
    select: { team_id: true },
  });
  if (!queue?.team_id) {
    throw new Error(`Queue ${WEBCHAT_QUEUE_ID} not found or has no team`);
  }

  const created: Array<{ email: string; role: string; userId: string; agentId?: string }> = [];

  for (const account of ACCOUNTS) {
    const user = await upsertAccount(account);
    if (!user) continue;
    let agentId: string | undefined;
    if (account.provisionAgent) {
      agentId = await provisionAgentUser(
        user.id,
        user.email,
        account.firstName,
        account.lastName,
        queue.team_id,
      );
    }
    created.push({
      email: user.email,
      role: account.roleName,
      userId: user.id,
      agentId,
    });
  }

  console.log(
    JSON.stringify(
      {
        organizationId: ORG_ID,
        organizationName: org.company_name,
        webchatQueueId: WEBCHAT_QUEUE_ID,
        password: PASSWORD,
        accounts: created,
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
    process.exit(1);
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
