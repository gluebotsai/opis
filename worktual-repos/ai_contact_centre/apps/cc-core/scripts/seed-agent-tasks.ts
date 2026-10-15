/**
 * Seed agent tasks derived from real org conversations and transcripts.
 *
 * Usage:
 *   npx tsx apps/cc-core/scripts/seed-agent-tasks.ts
 *   npx tsx apps/cc-core/scripts/seed-agent-tasks.ts --live
 *   npx tsx apps/cc-core/scripts/seed-agent-tasks.ts --agent-email agent.test@worktual.local --live
 */
import "@ai-contact-center/config/load-root-env";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ccPrisma } from "@ai-contact-center/db-cc";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ORG_ID = process.env.ORGANIZATION_ID ?? "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const SEED_PACK = "worktual1_agent_tasks_v2";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin.test@worktual.local").toLowerCase();
const AGENT_EMAIL = (process.env.AGENT_EMAIL ?? "agent.test@worktual.local").toLowerCase();
const live = process.argv.includes("--live");

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const organizationId = readArg("org-id") ?? ORG_ID;
const agentEmail = (readArg("agent-email") ?? AGENT_EMAIL).toLowerCase();
const adminEmail = (readArg("admin-email") ?? ADMIN_EMAIL).toLowerCase();

async function ensureAgentTasksTable() {
  const sql = readFileSync(
    join(__dirname, "../../../packages/db-cc/prisma/migrations/agent_tasks_v1.sql"),
    "utf8",
  );
  const statements = sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await ccPrisma.$executeRawUnsafe(`${statement};`);
  }
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function displayName(firstName: string | null, lastName: string | null, fallback: string): string {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name || fallback;
}

type ConversationContext = {
  id: string;
  channel: string;
  contactId: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  lastCustomerSnippet: string | null;
};

async function loadConversationContext(
  conversationId: string,
): Promise<ConversationContext | null> {
  const rows = await ccPrisma.$queryRaw<
    Array<{
      id: string;
      channel: string;
      contact_id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
    }>
  >`
    SELECT
      c.id,
      c.channel,
      c.contact_id,
      cp.first_name,
      cp.last_name,
      email_ik.key_value AS email,
      phone_ik.key_value AS phone
    FROM ccass.conversations c
    LEFT JOIN cdp.customer_profile cp
      ON cp.cdp_id = c.contact_id::text
     AND cp.organization_id = c.organization_id
    LEFT JOIN LATERAL (
      SELECT key_value
      FROM cdp.identity_keys
      WHERE cdp_id = c.contact_id::text
        AND organization_id = c.organization_id
        AND key_type IN ('email', 'email_secondary')
      LIMIT 1
    ) email_ik ON TRUE
    LEFT JOIN LATERAL (
      SELECT key_value
      FROM cdp.identity_keys
      WHERE cdp_id = c.contact_id::text
        AND organization_id = c.organization_id
        AND key_type IN ('phone', 'phone_secondary', 'whatsapp_phone')
      LIMIT 1
    ) phone_ik ON TRUE
    WHERE c.organization_id = ${organizationId}::bigint
      AND c.id = ${conversationId}::bigint
    LIMIT 1
  `;
  const row = rows[0];
  if (!row?.contact_id) return null;

  const messageRows = await ccPrisma.$queryRaw<Array<{ body: string }>>`
    SELECT body
    FROM ccass.conversation_messages
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND sender_type = 'customer'
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const fallback =
    row.channel === "email"
      ? row.email?.split("@")[0] ?? "Customer"
      : row.channel === "whatsapp" || row.channel === "instagram" || row.channel === "facebook"
        ? "Customer"
        : "Webchat visitor";

  return {
    id: row.id,
    channel: row.channel,
    contactId: row.contact_id,
    customerName: displayName(row.first_name, row.last_name, fallback),
    customerEmail: row.email,
    customerPhone: row.phone,
    lastCustomerSnippet: messageRows[0]?.body?.slice(0, 200).replace(/\s+/g, " ").trim() ?? null,
  };
}

async function main() {
  await ensureAgentTasksTable();
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;

  const [agentUser, adminUser] = await Promise.all([
    ccPrisma.$queryRaw<
      Array<{ id: string; first_name: string | null; last_name: string | null; email: string }>
    >`
      SELECT id, first_name, last_name, lower(work_email) AS email
      FROM accounts.setup_users
      WHERE organization_id = ${organizationId}::bigint
        AND lower(work_email) = ${agentEmail}
      LIMIT 1
    `,
    ccPrisma.$queryRaw<
      Array<{ id: string; first_name: string | null; last_name: string | null; email: string }>
    >`
      SELECT id, first_name, last_name, lower(work_email) AS email
      FROM accounts.setup_users
      WHERE organization_id = ${organizationId}::bigint
        AND lower(work_email) = ${adminEmail}
      LIMIT 1
    `,
  ]);

  const agent = agentUser[0];
  const admin = adminUser[0];
  if (!agent) throw new Error(`Agent not found: ${agentEmail}`);
  if (!admin) throw new Error(`Admin not found: ${adminEmail}`);

  const adminLabel = `Supervisor · ${displayName(admin.first_name, admin.last_name, admin.email.split("@")[0] ?? "Admin")}`;

  // Real conversation IDs from the org — tasks mirror actual chat transcripts.
  const conversationIds = [
    "13c1f1fc-52ae-4fad-afc2-614e43d5efa1", // Facebook — order shipping
    "0fbc80c8-3d68-4fe0-89b3-911c8f9d897f", // Webchat — branch question, agents busy
    "70158fab-0fa2-4daa-a476-f51749a40275", // WhatsApp Bharathi — live agent loops
    "29c7c3e8-7302-449d-980b-bbb935b002a3", // Email Kamali — demo request
    "628c1a29-b10f-48ae-a141-ff24e7400078", // Instagram — connect live agent
    "bc02a302-b282-41c3-9d13-f21afaa3abcc", // Webchat — shared email after agent chat
    "f61e00a3-cae4-4b85-b713-5bd9eeba6a1a", // WhatsApp Bharathi — branches answered
  ] as const;

  const contexts = new Map<string, ConversationContext>();
  for (const id of conversationIds) {
    const ctx = await loadConversationContext(id);
    if (ctx) contexts.set(id, ctx);
  }

  const fb = contexts.get("13c1f1fc-52ae-4fad-afc2-614e43d5efa1");
  const webchatBranches = contexts.get("0fbc80c8-3d68-4fe0-89b3-911c8f9d897f");
  const waHandoff = contexts.get("70158fab-0fa2-4daa-a476-f51749a40275");
  const emailDemo = contexts.get("29c7c3e8-7302-449d-980b-bbb935b002a3");
  const igHandoff = contexts.get("628c1a29-b10f-48ae-a141-ff24e7400078");
  const webchatEmail = contexts.get("bc02a302-b282-41c3-9d13-f21afaa3abcc");
  const waBranches = contexts.get("f61e00a3-cae4-4b85-b713-5bd9eeba6a1a");

  if (!fb || !webchatBranches || !waHandoff || !emailDemo || !igHandoff || !webchatEmail || !waBranches) {
    throw new Error(
      `Missing conversation context. Found: ${[...contexts.keys()].join(", ")}`,
    );
  }

  const tasks = [
    {
      id: "b1111111-1111-4111-8111-111111111101",
      conversation: fb,
      task_type: "callback",
      status: "open",
      priority: "high",
      source: "admin",
      title: "Order shipping callback",
      summary: `${fb.customerName} placed an order yesterday on Facebook Messenger and never received shipping updates. Call back with tracking or open a support ticket.`,
      notes: `Last message: "${fb.lastCustomerSnippet ?? "Order status inquiry"}"`,
      due_at: hoursFromNow(3),
      created_at: hoursAgo(4),
    },
    {
      id: "b1111111-1111-4111-8111-111111111102",
      conversation: webchatBranches,
      task_type: "callback",
      status: "open",
      priority: "high",
      source: "system",
      title: "Branch locations callback",
      summary: `${webchatBranches.customerName} asked "what are the branches you have?" on webchat but only received the agents-busy message. Call back with Chennai and Bangalore branch details.`,
      notes: "Conversation ended without a branch answer. Reference branch list from prior WhatsApp chat if needed.",
      due_at: hoursAgo(2),
      created_at: hoursAgo(8),
    },
    {
      id: "b1111111-1111-4111-8111-111111111103",
      conversation: waHandoff,
      task_type: "callback",
      status: "open",
      priority: "critical",
      source: "admin",
      title: "WhatsApp live-agent callback",
      summary: `${waHandoff.customerName} requested a live agent four times on WhatsApp. Every handoff failed with the agents-busy message. Priority callback required.`,
      notes: waHandoff.customerPhone
        ? `WhatsApp: ${waHandoff.customerPhone}. Prefer afternoon IST.`
        : null,
      due_at: hoursFromNow(1),
      created_at: hoursAgo(6),
    },
    {
      id: "b1111111-1111-4111-8111-111111111104",
      conversation: emailDemo,
      task_type: "callback",
      status: "open",
      priority: "high",
      source: "self",
      title: "Demo booking callback",
      summary: `${emailDemo.customerName} emailed to book a Contact Centre demo. Agent replied asking for preferred time — schedule the demo call and confirm calendar invite.`,
      notes: emailDemo.customerEmail ? `Email: ${emailDemo.customerEmail}` : null,
      due_at: hoursFromNow(5),
      created_at: hoursAgo(12),
    },
    {
      id: "b1111111-1111-4111-8111-111111111105",
      conversation: igHandoff,
      task_type: "callback",
      status: "open",
      priority: "high",
      source: "system",
      title: "Instagram handoff callback",
      summary: `Instagram customer asked to "Connect me to live agent" repeatedly. Handoff never completed — call back or reply on Instagram DM.`,
      notes: `Last customer message: "${igHandoff.lastCustomerSnippet ?? "Connect to live agent"}"`,
      due_at: hoursFromNow(2),
      created_at: hoursAgo(3),
    },
    {
      id: "b1111111-1111-4111-8111-111111111106",
      conversation: webchatEmail,
      task_type: "follow_up",
      status: "open",
      priority: "normal",
      source: "self",
      title: "Webchat email follow-up",
      summary: `After connecting on webchat, customer shared ${webchatEmail.customerEmail ?? "their email"}. Follow up on the original live-agent request.`,
      notes: "Customer said: \"now try to connect with live agent\" then provided email mid-session.",
      due_at: hoursFromNow(20),
      created_at: hoursAgo(18),
    },
    {
      id: "b1111111-1111-4111-8111-111111111107",
      conversation: waBranches,
      task_type: "suggestion",
      status: "open",
      priority: "normal",
      source: "coworker",
      title: "Confirm branch details received",
      summary: `Co-worker noticed ${waBranches.customerName} asked for branch locations on WhatsApp. Agent shared Chennai and Bangalore addresses — suggest a quick confirmation callback.`,
      notes: "Customer ended with \"bye\" after branch list was sent.",
      due_at: hoursFromNow(24),
      created_at: hoursAgo(2),
    },
    {
      id: "b1111111-1111-4111-8111-111111111108",
      conversation: waHandoff,
      task_type: "follow_up",
      status: "open",
      priority: "critical",
      source: "admin",
      title: "Handoff failure follow-up",
      summary: `${adminLabel} flagged repeated live-agent routing failures for ${waHandoff.customerName}. Investigate queue capacity before the callback.`,
      notes: "Same WhatsApp thread as the live-agent callback task.",
      due_at: hoursFromNow(4),
      created_at: hoursAgo(1),
    },
    {
      id: "b1111111-1111-4111-8111-111111111109",
      conversation: waBranches,
      task_type: "callback",
      status: "completed",
      priority: "normal",
      source: "self",
      title: "Branch info callback completed",
      summary: `Confirmed ${waBranches.customerName} received Chennai and Bangalore branch addresses on WhatsApp.`,
      notes: null,
      due_at: daysAgo(1),
      created_at: daysAgo(2),
      completed_at: daysAgo(1),
    },
  ] as const;

  const preview = {
    organizationId,
    live,
    seedPack: SEED_PACK,
    agent: { id: agent.id, email: agent.email },
    admin: { id: admin.id, email: admin.email, label: adminLabel },
    conversations: [...contexts.values()].map((ctx) => ({
      id: ctx.id,
      channel: ctx.channel,
      customerName: ctx.customerName,
      customerEmail: ctx.customerEmail,
      customerPhone: ctx.customerPhone,
    })),
    tasksToSeed: tasks.length,
  };

  console.log(JSON.stringify(preview, null, 2));

  if (!live) {
    console.log("\nDry run only. Re-run with --live to seed tasks.");
    return;
  }

  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;

  await ccPrisma.$executeRaw`
    DELETE FROM ccass.agent_tasks
    WHERE organization_id = ${organizationId}::bigint
      AND metadata->>'seedPack' IN ('worktual1_agent_tasks_v1', ${SEED_PACK})
  `;

  for (const task of tasks) {
    const ctx = task.conversation;
    await ccPrisma.$executeRaw`
      INSERT INTO ccass.agent_tasks (
        id,
        organization_id,
        assigned_user_id,
        created_by_user_id,
        contact_id,
        conversation_id,
        task_type,
        status,
        priority,
        source,
        title,
        summary,
        notes,
        channel,
        due_at,
        completed_at,
        assigned_by_user_id,
        assigned_by_label,
        metadata,
        created_at,
        updated_at
      ) VALUES (
        ${task.id}::bigint,
        ${organizationId}::bigint,
        ${agent.id}::bigint,
        ${task.source === "admin" ? admin.id : task.source === "coworker" ? null : agent.id}::bigint,
        ${ctx.contactId}::bigint,
        ${ctx.id}::bigint,
        ${task.task_type},
        ${task.status},
        ${task.priority},
        ${task.source},
        ${task.title},
        ${task.summary},
        ${task.notes},
        ${ctx.channel},
        ${task.due_at},
        ${"completed_at" in task ? task.completed_at : null},
        ${task.source === "admin" ? admin.id : null}::bigint,
        ${task.source === "admin" ? adminLabel : null},
        ${JSON.stringify({
          seedPack: SEED_PACK,
          customerName: ctx.customerName,
          conversationId: ctx.id,
          channel: ctx.channel,
        })}::jsonb,
        ${task.created_at},
        NOW()
      )
    `;
  }

  console.log(JSON.stringify({ status: "seeded", taskCount: tasks.length, seedPack: SEED_PACK }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
