import "@ai-contact-center/config/load-root-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { ccPrisma } from "@ai-contact-center/db-cc";
import { runRollbackIntegration } from "@ai-contact-center/test-harness";

import { IDENTITY_KEY_TYPES, findCdpIdByIdentityKey } from "../src/services/cdp-customer-profile.js";
import { enrichContactFromConversation } from "../src/services/contact-identity.js";
import { startConversation } from "../src/services/conversations.js";
import { upsertConversationMemory } from "../src/services/conversation-memory.js";
import {
  getContactOmniChannelSummary,
  listContactChannelSummaries,
  upsertOmniChannelSummary,
} from "../src/services/omni-channel-summary.js";
import { ingestInboundSocialConversation } from "../src/services/social-conversations.js";

const fixtures = await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  return db.$queryRaw<
    Array<{
      organization_id: string;
      webchat_id: string | null;
      whatsapp_channel_config_id: string | null;
    }>
  >`
    SELECT
      org.id AS organization_id,
      webchat.webchat_id,
      social.channel_config_id AS whatsapp_channel_config_id
    FROM accounts.organizations org
    INNER JOIN accounts.setup_social_configs social
      ON social.provider = 'whatsapp'
    INNER JOIN accounts.setup_channel_configs wa_cc
      ON wa_cc.id = social.channel_config_id
      AND wa_cc.organization_id = org.id
      AND wa_cc.status = 'active'
    INNER JOIN accounts.setup_webchat_configs webchat
      ON webchat.channel_config_id IN (
        SELECT cc.id
        FROM accounts.setup_channel_configs cc
        WHERE cc.organization_id = org.id
          AND cc.status = 'active'
      )
    WHERE org.lifecycle_status = 'active'
    ORDER BY CASE WHEN org.id = 1000 THEN 0 ELSE 1 END, org.created_at DESC
    LIMIT 1
  `;
});

const fixture = fixtures[0];
if (!fixture?.whatsapp_channel_config_id || !fixture.webchat_id) {
  console.log("SKIP omni phone memory integration: need active WhatsApp + webchat");
  await ccPrisma.$disconnect();
  process.exit(0);
}

const organizationId = String(fixture.organization_id);
const whatsappChannelConfigId = String(fixture.whatsapp_channel_config_id);
const webchatId = String(fixture.webchat_id);

await runRollbackIntegration(async (db) => {
  const runId = randomUUID().slice(0, 8);
  const phone = `1555${runId.replace(/\D/g, "").slice(0, 7).padEnd(7, "0")}`;
  const orderToken = `OMNI-${runId.toUpperCase()}`;
  const whatsappSummary = `Customer asked about a refund for order ${orderToken} on WhatsApp.`;
  const omniSummary = `Refund for ${orderToken} is in progress; prefers WhatsApp.`;

  const whatsappIngest = await ingestInboundSocialConversation(db, {
    organizationId,
    channelConfigId: whatsappChannelConfigId,
    channelType: "whatsapp",
    externalThreadId: phone,
    externalMessageId: `wa-omni-${runId}`,
    customerRef: phone,
    customerName: "Omni Memory Test",
    body: `I need a refund for order ${orderToken}.`,
    occurredAt: new Date().toISOString(),
  });

  const whatsappContactId = whatsappIngest.conversation.contactId;
  assert.ok(whatsappContactId, "WhatsApp ingest should create a contact");

  const byWhatsappPhone = await findCdpIdByIdentityKey(
    db,
    organizationId,
    IDENTITY_KEY_TYPES.WHATSAPP_PHONE,
    phone,
  );
  assert.equal(byWhatsappPhone, whatsappContactId);

  await upsertConversationMemory(db, organizationId, whatsappIngest.conversation.id, {
    rollingSummary: whatsappSummary,
    extractedFacts: [`Order ${orderToken} refund in progress`],
    modelName: "omni-memory-integration",
  });
  await upsertOmniChannelSummary(db, organizationId, whatsappContactId, omniSummary);

  const started = await startConversation(
    db,
    organizationId,
    {
      webchatId,
      visitorId: `omni-${runId}`,
    },
    { deferSideEffects: true },
  );
  const visitorContactId = started.conversation.contactId;
  assert.ok(visitorContactId);
  assert.notEqual(visitorContactId, whatsappContactId);

  await enrichContactFromConversation(db, organizationId, started.conversation.id, {
    phone,
  });

  const webchatRows = await db.$queryRaw<Array<{ contact_id: string | null }>>`
    SELECT contact_id FROM ccass.conversations
    WHERE id = ${started.conversation.id}::bigint
    LIMIT 1
  `;
  assert.equal(
    webchatRows[0]?.contact_id,
    whatsappContactId,
    "webchat phone should match the WhatsApp identity and relink the conversation",
  );

  const summaries = await listContactChannelSummaries(db, organizationId, whatsappContactId);
  const channels = new Set(summaries.map((item) => item.channel));
  assert.ok(channels.has("whatsapp"), "channel summaries should include WhatsApp");
  assert.ok(
    summaries.some((item) => item.summary.includes(orderToken)),
    "WhatsApp channel summary should include the order token",
  );

  const omni = await getContactOmniChannelSummary(db, organizationId, whatsappContactId);
  assert.ok(omni.omniChannelSummary?.includes(orderToken));

  console.log("PASS omni phone memory integration");
});

await ccPrisma.$disconnect();
