/**
 * Make a setup user eligible for CCaaS queue assignment (active + Contact Center Agent).
 *
 * Usage:
 *   npx tsx scripts/ensure-ccaas-agent-eligible.ts --email agent.test@worktual.local
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const CONTACT_CENTER_PRODUCT = "contact-center";
const EMAIL =
  (process.argv.includes("--email")
    ? process.argv[process.argv.indexOf("--email") + 1]
    : process.env.EMAIL) ?? "agent.test@worktual.local";

function json(value: unknown) {
  return JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2);
}

async function main() {
  const email = EMAIL.trim().toLowerCase();
  const user = await ccPrisma.setup_users.findFirst({
    where: { work_email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      organization_id: true,
      status: true,
      invite_status: true,
      work_email: true,
      setup_user_product_access: {
        where: { product_id: CONTACT_CENTER_PRODUCT },
        select: {
          id: true,
          role_id: true,
          setup_roles: { select: { name: true } },
        },
      },
    },
  });
  if (!user) {
    throw new Error(`User not found: ${email}`);
  }

  const role = await ccPrisma.setup_roles.findFirst({
    where: {
      organization_id: user.organization_id,
      product_id: CONTACT_CENTER_PRODUCT,
      name: { equals: "Agent", mode: "insensitive" },
    },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });
  if (!role) {
    throw new Error(`Agent role not found for org ${user.organization_id.toString()}`);
  }

  await ccPrisma.setup_users.update({
    where: { id: user.id },
    data: { status: "active", invite_status: "active", updated_at: new Date() },
  });

  if (user.setup_user_product_access.length === 0) {
    await ccPrisma.setup_user_product_access.create({
      data: {
        organization_id: user.organization_id,
        user_id: user.id,
        product_id: CONTACT_CENTER_PRODUCT,
        role_id: role.id,
      },
    });
  } else {
    await ccPrisma.setup_user_product_access.updateMany({
      where: { user_id: user.id, product_id: CONTACT_CENTER_PRODUCT },
      data: { role_id: role.id },
    });
  }

  const updated = await ccPrisma.setup_users.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      work_email: true,
      status: true,
      invite_status: true,
      organization_id: true,
      setup_user_product_access: {
        where: { product_id: CONTACT_CENTER_PRODUCT },
        select: { product_id: true, setup_roles: { select: { name: true } } },
      },
    },
  });
  console.log(json({ before: user, after: updated }));

  const queueName = process.argv.includes("--queue")
    ? process.argv[process.argv.indexOf("--queue") + 1]
    : "Support";
  const queue = await ccPrisma.setup_ccaas_queues.findFirst({
    where: {
      organization_id: user.organization_id,
      name: { equals: queueName, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });
  if (!queue) return;
  const members = await ccPrisma.setup_ccaas_queue_agents.findMany({
    where: { queue_id: queue.id },
    select: {
      user_id: true,
      setup_users: {
        select: {
          work_email: true,
          status: true,
          setup_user_product_access: {
            where: { product_id: CONTACT_CENTER_PRODUCT },
            select: { setup_roles: { select: { name: true } } },
          },
        },
      },
    },
  });
  console.log(
    json({
      queue: { id: queue.id.toString(), name: queue.name },
      members: members.map((member) => {
        const role = member.setup_users.setup_user_product_access[0]?.setup_roles?.name ?? null;
        return {
          userId: member.user_id.toString(),
          email: member.setup_users.work_email,
          status: member.setup_users.status,
          role,
          eligible:
            member.setup_users.status === "active" &&
            Boolean(role && /^(agent|admin)$/i.test(role)),
        };
      }),
    }),
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
