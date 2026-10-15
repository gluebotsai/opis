#!/usr/bin/env npx tsx
/**
 * WhatsApp bot lifecycle: ingest → bot reply → handoff → accept → end
 *
 * Usage: npx tsx scripts/e2e/test-whatsapp-bot-lifecycle.ts
 */
import "@ai-contact-center/config/load-root-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { ccPrisma } from "@ai-contact-center/db-cc";
import {
  CcCoreClient,
  createTestRunIds,
  loadE2eConfig,
  NlpClient,
  runPreflight,
  SocialClient,
} from "@ai-contact-center/test-harness";

const AGENT_EMAIL = process.env.E2E_AGENT_EMAIL ?? "agent.test@worktual.local";
const AGENT_PASSWORD = process.env.E2E_AGENT_PASSWORD ?? "Worktual@123";

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function discoverWhatsAppChannel(organizationId: string) {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const rows = await ccPrisma.$queryRaw<
    Array<{ channel_config_id: string; phone_number_id: string | null }>
  >`
    SELECT wc.channel_config_id, wc.phone_number_id
    FROM accounts.setup_social_configs wc
    INNER JOIN accounts.setup_channel_configs channel ON channel.id = wc.channel_config_id
    WHERE channel.organization_id = ${organizationId}::bigint
      AND channel.status = 'active'
      AND wc.provider = 'whatsapp'
    LIMIT 1
  `;
  return rows[0];
}

async function resolveAgentEmail(organizationId: string, agentId: string) {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const rows = await ccPrisma.$queryRaw<Array<{ email: string }>>`
    SELECT u.work_email AS email
    FROM ccass.agents a
    INNER JOIN accounts.setup_users u ON u.id = a.setup_user_id
    WHERE a.organization_id = ${organizationId}::bigint
      AND a.id = ${agentId}::bigint
    LIMIT 1
  `;
  return rows[0]?.email ?? null;
}

async function prepareAgentsForHandoff(orgId: string, cc: CcCoreClient) {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await ccPrisma.$executeRaw`
    UPDATE ccass.agent_capacity
    SET active_count = 0, reserved_count = 0, updated_at = NOW()
    WHERE organization_id = ${orgId}::bigint
      AND channel = 'whatsapp'
  `;

  for (const email of [AGENT_EMAIL, "agent2.test@worktual.local"]) {
    try {
      const session = await cc.loginAgent(email, AGENT_PASSWORD);
      await cc.updatePresence(
        session,
        email === AGENT_EMAIL ? "ready" : "not_ready",
      );
    } catch {
      // optional secondary agent
    }
  }
}

function buildIngestPayload(input: {
  organizationId: string;
  channelConfigId: string;
  phoneNumberId: string;
  customerPhone: string;
  body: string;
}) {
  return {
    organizationId: input.organizationId,
    channelConfigId: input.channelConfigId,
    channelType: "whatsapp" as const,
    externalThreadId: input.customerPhone,
    externalMessageId: `wamid-${randomUUID()}`,
    customerRef: input.customerPhone,
    customerName: "E2E Customer",
    body: input.body,
    messageType: "text",
    phoneNumberId: input.phoneNumberId,
    occurredAt: new Date().toISOString(),
  };
}

async function ingestViaWebhook(
  social: SocialClient,
  phoneNumberId: string,
  from: string,
  body: string,
) {
  const payload = social.buildInboundWebhookPayload({
    phoneNumberId,
    from,
    messageId: `wamid-${randomUUID()}`,
    body,
  });
  await social.postWhatsAppWebhook(payload);
}

export async function runWhatsAppBotLifecycle(options: { useWebhook?: boolean } = {}) {
  const preflight = await runPreflight({ requireStack: false });
  if (!preflight.ok || !preflight.organizationId) {
    throw new Error(`Preflight failed: ${preflight.errors.join("; ")}`);
  }

  const orgId = preflight.organizationId;
  const waChannel = await discoverWhatsAppChannel(orgId);
  const channelConfigId = String(waChannel?.channel_config_id ?? preflight.whatsappChannelConfigId);
  const phoneNumberId = String(waChannel?.phone_number_id ?? preflight.whatsappPhoneNumberId ?? "");
  if (!channelConfigId || !phoneNumberId) {
    throw new Error("No WhatsApp channel configured for E2E");
  }

  const config = loadE2eConfig();
  const social = new SocialClient(config);
  const cc = new CcCoreClient(config);
  const nlp = new NlpClient(config);
  const ids = createTestRunIds("wa-life");
  const customerPhone = ids.phone.replace(/\D/g, "");

  const agent = await cc.loginAgent(AGENT_EMAIL, AGENT_PASSWORD);
  await prepareAgentsForHandoff(orgId, cc);

  console.log(`customerPhone=${customerPhone}`);

  let conversationId: string;
  const useWebhook = options.useWebhook ?? process.env.E2E_WHATSAPP_WEBHOOK === "true";

  if (useWebhook) {
    await ingestViaWebhook(social, phoneNumberId, customerPhone, "Hello");
    await sleep(2000);
    await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
    const rows = await ccPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id
      FROM ccass.conversations
      WHERE organization_id = ${orgId}::bigint
        AND channel = 'whatsapp'
        AND visitor_id = ${customerPhone}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    assert.ok(rows[0]?.id, "expected whatsapp conversation after webhook ingest");
    conversationId = rows[0].id;

    const started = Date.now();
    while (Date.now() - started < 90_000) {
      const { turns } = await cc.listNlpTurns(orgId, conversationId);
      if (turns.some((turn) => turn.botReply?.trim())) break;
      await sleep(1000);
    }
    const { turns } = await cc.listNlpTurns(orgId, conversationId);
    assert.ok(turns.some((turn) => turn.botReply?.trim()), "expected bot reply from webhook path");

    await ingestViaWebhook(
      social,
      phoneNumberId,
      customerPhone,
      "Please connect me to a live agent",
    );
  } else {
    const firstIngest = await cc.ingestSocial(
      orgId,
      buildIngestPayload({
        organizationId: orgId,
        channelConfigId,
        phoneNumberId,
        customerPhone,
        body: "Hello",
      }),
    );
    assert.equal(firstIngest.botEligible, true, "whatsapp conversation should be bot eligible");
    conversationId = firstIngest.conversation.id;
    assert.ok(/^\d+$/.test(conversationId), `expected bigint conversation id, got ${conversationId}`);

    const botTurn = await nlp.whatsappTurn({
      organizationId: orgId,
      conversationId,
      message: "Hello",
    });
    assert.ok(botTurn.reply?.length, "expected NLP bot reply");
    await cc.recordNlpTurn(orgId, conversationId, {
      customerText: "Hello",
      botReply: botTurn.reply,
      intent: botTurn.intent,
      modelName: botTurn.model_name,
      handoffRecommended: botTurn.handoff_recommended ?? false,
    });
    console.log(`bot reply recorded (intent=${botTurn.intent ?? "n/a"})`);

    const handoffTurn = await nlp.whatsappTurn({
      organizationId: orgId,
      conversationId,
      message: "Please connect me to a live agent",
    });
    assert.equal(handoffTurn.handoff_recommended, true, "expected handoff recommendation");
    await cc.recordNlpTurn(orgId, conversationId, {
      customerText: "Please connect me to a live agent",
      botReply: handoffTurn.reply,
      intent: handoffTurn.intent,
      handoffRecommended: true,
      handoffReason: "explicit_request",
    });

    await prepareAgentsForHandoff(orgId, cc);
    await cc.handoff(orgId, conversationId, "explicit_request");
  }

  const acceptStarted = Date.now();
  let acceptingAgent = agent;
  while (Date.now() - acceptStarted < 30_000) {
    const { conversation } = await cc.getConversation(orgId, conversationId);
    if (conversation.status === "active") {
      if (conversation.assignedAgentId) {
        const assignedEmail =
          (await resolveAgentEmail(orgId, conversation.assignedAgentId)) ?? AGENT_EMAIL;
        acceptingAgent =
          assignedEmail === AGENT_EMAIL ? agent : await cc.loginAgent(assignedEmail, AGENT_PASSWORD);
      }
      break;
    }
    if (conversation.status === "bot_active") {
      throw new Error("Handoff routing returned to bot_active (no agent available)");
    }

    if (conversation.status === "assigned" && conversation.assignedAgentId) {
      const assignedEmail =
        (await resolveAgentEmail(orgId, conversation.assignedAgentId)) ?? AGENT_EMAIL;
      acceptingAgent =
        assignedEmail === AGENT_EMAIL ? agent : await cc.loginAgent(assignedEmail, AGENT_PASSWORD);
      if (assignedEmail !== AGENT_EMAIL) {
        await cc.updatePresence(acceptingAgent, "ready");
      }
      try {
        await cc.acceptOffer(acceptingAgent, conversationId);
      } catch {
        // offer may not be ready yet
      }
    }
    await sleep(250);
  }

  const { conversation: finalConversation } = await cc.getConversation(orgId, conversationId);
  console.log(
    `handoff status=${finalConversation.status} agent=${finalConversation.assignedAgentId ?? "none"}`,
  );
  if (finalConversation.status !== "active") {
    throw new Error(`Expected active conversation after accept, got ${finalConversation.status}`);
  }
  await cc.sendAgentMessage(acceptingAgent, conversationId, "Thanks — an agent is here to help you now.");

  const resolved = await cc.resolveConversation(acceptingAgent, conversationId);
  assert.equal(resolved.conversation.status, "resolved");

  console.log("PASS whatsapp bot lifecycle (bot → handoff → accept → end)");
  return { organizationId: orgId, conversationId, customerPhone };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWhatsAppBotLifecycle()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await ccPrisma.$disconnect();
    });
}
