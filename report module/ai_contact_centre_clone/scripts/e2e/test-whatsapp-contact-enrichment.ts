#!/usr/bin/env npx tsx
/**
 * WhatsApp post-handoff contact enrichment E2E:
 * bot session → handoff → agent active → customer sends email in message →
 * message in inbox + contact profile updated.
 *
 * Usage: npx tsx scripts/e2e/test-whatsapp-contact-enrichment.ts
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

  try {
    const session = await cc.loginAgent(AGENT_EMAIL, AGENT_PASSWORD);
    await cc.updatePresence(session, "ready");
  } catch {
    // agent may already be logged in elsewhere
  }
}

function buildIngestPayload(input: {
  organizationId: string;
  channelConfigId: string;
  phoneNumberId: string;
  customerPhone: string;
  body: string;
  externalMessageId?: string;
}) {
  return {
    organizationId: input.organizationId,
    channelConfigId: input.channelConfigId,
    channelType: "whatsapp" as const,
    externalThreadId: input.customerPhone,
    externalMessageId: input.externalMessageId ?? `wamid-${randomUUID()}`,
    customerRef: input.customerPhone,
    customerName: "E2E Enrich Customer",
    body: input.body,
    messageType: "text",
    phoneNumberId: input.phoneNumberId,
    occurredAt: new Date().toISOString(),
  };
}

async function handoffToActiveAgent(
  cc: CcCoreClient,
  orgId: string,
  conversationId: string,
  agent: Awaited<ReturnType<CcCoreClient["loginAgent"]>>,
) {
  await prepareAgentsForHandoff(orgId, cc);
  await cc.handoff(orgId, conversationId, "explicit_request");

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
      return acceptingAgent;
    }
    if (conversation.status === "assigned" && conversation.assignedAgentId) {
      const assignedEmail =
        (await resolveAgentEmail(orgId, conversation.assignedAgentId)) ?? AGENT_EMAIL;
      acceptingAgent =
        assignedEmail === AGENT_EMAIL ? agent : await cc.loginAgent(assignedEmail, AGENT_PASSWORD);
      try {
        await cc.acceptOffer(acceptingAgent, conversationId);
      } catch {
        // offer may not be ready yet
      }
    }
    await sleep(250);
  }

  const { conversation: finalConversation } = await cc.getConversation(orgId, conversationId);
  throw new Error(`Expected active conversation after handoff, got ${finalConversation.status}`);
}

export async function runWhatsAppContactEnrichmentE2e() {
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
  const cc = new CcCoreClient(config);
  const nlp = new NlpClient(config);
  const ids = createTestRunIds("wa-enrich");
  const customerPhone = ids.phone.replace(/\D/g, "");
  const customerEmail = ids.email;
  const emailMessage = `My email address is ${customerEmail}`;

  const agent = await cc.loginAgent(AGENT_EMAIL, AGENT_PASSWORD);
  await prepareAgentsForHandoff(orgId, cc);

  console.log(`customerPhone=${customerPhone} customerEmail=${customerEmail}`);

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
  assert.equal(firstIngest.botEligible, true, "new whatsapp session should be bot eligible");
  const conversationId = firstIngest.conversation.id;

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
    handoffRecommended: false,
  });

  const handoffTurn = await nlp.whatsappTurn({
    organizationId: orgId,
    conversationId,
    message: "Please connect me to a live agent",
  });
  await cc.recordNlpTurn(orgId, conversationId, {
    customerText: "Please connect me to a live agent",
    botReply: handoffTurn.reply,
    intent: handoffTurn.intent,
    handoffRecommended: true,
    handoffReason: "explicit_request",
  });

  const acceptingAgent = await handoffToActiveAgent(cc, orgId, conversationId, agent);
  const activeView = await cc.getWorkspaceConversation(acceptingAgent, conversationId);
  assert.equal(activeView.conversation.status, "active");
  assert.equal(activeView.conversation.botActive, false, "bot should be off after handoff");

  const enrichIngest = await cc.ingestSocial(
    orgId,
    buildIngestPayload({
      organizationId: orgId,
      channelConfigId,
      phoneNumberId,
      customerPhone,
      body: emailMessage,
      externalMessageId: `wamid-enrich-${randomUUID()}`,
    }),
  );
  assert.equal(enrichIngest.botEligible, false, "post-handoff message should not be bot eligible");
  assert.ok(enrichIngest.conversation.id, "ingest should return conversation");

  const { messages } = await cc.listWorkspaceMessages(acceptingAgent, conversationId);
  const customerBodies = messages
    .filter((message) => message.senderType === "customer")
    .map((message) => message.body);
  assert.ok(
    customerBodies.some((body) => body.includes(customerEmail)),
    `expected customer email message in inbox, got: ${customerBodies.join(" | ")}`,
  );

  const enrichedView = await cc.getWorkspaceConversation(acceptingAgent, conversationId);
  assert.ok(enrichedView.contact, "workspace should include linked contact");
  assert.equal(
    enrichedView.contact?.primaryEmail?.toLowerCase(),
    customerEmail.toLowerCase(),
    "contact profile should include captured email",
  );
  assert.ok(
    enrichedView.contact?.primaryPhone?.includes(customerPhone.slice(-10)) ||
      enrichedView.contact?.primaryPhone === customerPhone,
    "contact profile should retain whatsapp phone",
  );

  console.log(
    `PASS whatsapp contact enrichment (handoff → email message → inbox + contact updated) conv=${conversationId} contact=${enrichedView.contact?.id}`,
  );
  return { organizationId: orgId, conversationId, customerEmail, contactId: enrichedView.contact?.id };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWhatsAppContactEnrichmentE2e()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await ccPrisma.$disconnect();
    });
}
