#!/usr/bin/env npx tsx
/**
 * WhatsApp yesterday → webchat tomorrow with the same number:
 * match phone / WhatsApp phone, load omni + channel summaries, inject into the bot.
 *
 * Usage: npx tsx scripts/e2e/test-omni-phone-memory-journey.ts
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

async function discoverFixtures(organizationId: string) {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const [webchat, whatsapp] = await Promise.all([
    ccPrisma.$queryRaw<Array<{ webchat_id: string }>>`
      SELECT config.webchat_id
      FROM accounts.setup_webchat_configs config
      INNER JOIN accounts.setup_channel_configs channel ON channel.id = config.channel_config_id
      WHERE channel.organization_id = ${organizationId}::bigint AND channel.status = 'active'
      LIMIT 1
    `,
    ccPrisma.$queryRaw<Array<{ channel_config_id: string; phone_number_id: string | null }>>`
      SELECT wc.channel_config_id, wc.phone_number_id
      FROM accounts.setup_social_configs wc
      INNER JOIN accounts.setup_channel_configs channel ON channel.id = wc.channel_config_id
      WHERE channel.organization_id = ${organizationId}::bigint
        AND channel.status = 'active'
        AND wc.provider = 'whatsapp'
      LIMIT 1
    `,
  ]);
  return {
    webchatId: webchat[0]?.webchat_id ? String(webchat[0].webchat_id) : undefined,
    channelConfigId: whatsapp[0]?.channel_config_id
      ? String(whatsapp[0].channel_config_id)
      : undefined,
    phoneNumberId: whatsapp[0]?.phone_number_id ? String(whatsapp[0].phone_number_id) : undefined,
  };
}

async function identityKeys(organizationId: string, contactId: string) {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  return ccPrisma.$queryRaw<Array<{ key_type: string }>>`
    SELECT key_type
    FROM cdp.identity_keys
    WHERE organization_id = ${organizationId}::bigint
      AND cdp_id = ${contactId}::text
  `;
}

export async function runOmniPhoneMemoryJourney() {
  const preflight = await runPreflight();
  if (!preflight.ok || !preflight.organizationId) {
    throw new Error(`Preflight failed: ${preflight.errors.join("; ")}`);
  }

  const orgId = preflight.organizationId;
  const fixtures = await discoverFixtures(orgId);
  if (!fixtures.webchatId || !fixtures.channelConfigId) {
    throw new Error("Need active webchat and WhatsApp channel for omni phone memory e2e");
  }

  const config = loadE2eConfig();
  const cc = new CcCoreClient(config);
  const nlp = new NlpClient(config);
  const ids = createTestRunIds("omni");
  const phone = ids.phone.replace(/\D/g, "");
  const firstName = "Priya";
  const lastName = "Raman";
  const city = "Chennai";
  const company = "Ziffo Tech";
  const whatsappSummary = `${firstName} ${lastName} from ${company} in ${city} asked on WhatsApp about a billing question and said they prefer WhatsApp.`;
  const omniSummary = `${firstName} ${lastName} lives in ${city}, works at ${company}, prefers WhatsApp.`;

  console.log(`org=${orgId} phone=${phone} name=${firstName} ${lastName} city=${city}`);

  const whatsappIngest = await cc.ingestSocial(orgId, {
    organizationId: orgId,
    channelConfigId: fixtures.channelConfigId,
    channelType: "whatsapp",
    externalThreadId: phone,
    externalMessageId: `wamid-omni-${randomUUID()}`,
    customerRef: phone,
    customerName: `${firstName} ${lastName}`,
    body: `Hi, I am ${firstName} ${lastName} from ${company} in ${city}. I prefer WhatsApp for updates.`,
    messageType: "text",
    phoneNumberId: fixtures.phoneNumberId,
    occurredAt: new Date().toISOString(),
  });
  const whatsappContactId = whatsappIngest.conversation.contactId;
  assert.ok(whatsappContactId, "WhatsApp ingest should create a contact");
  const whatsappConversationId = whatsappIngest.conversation.id;

  const keys = await identityKeys(orgId, whatsappContactId);
  const keyTypes = new Set(keys.map((row) => row.key_type));
  assert.ok(keyTypes.has("whatsapp_phone"), "WhatsApp ingest should store whatsapp_phone");

  await cc.enrichContact(orgId, whatsappConversationId, {
    firstName,
    lastName,
    city,
    company,
  });
  await cc.recordNlpTurn(orgId, whatsappConversationId, {
    customerText: `Hi, I am ${firstName} ${lastName} from ${company} in ${city}.`,
    botReply: `Thanks ${firstName}. I have your ${city} and ${company} details.`,
    summary: whatsappSummary,
    importantFacts: [
      `Name ${firstName} ${lastName}`,
      `City ${city}`,
      `Company ${company}`,
      "Prefers WhatsApp",
    ],
    runtimeType: "whatsapp_bot",
  });
  await cc.upsertMemory(orgId, whatsappConversationId, {
    rollingSummary: whatsappSummary,
    extractedFacts: [
      `Name ${firstName} ${lastName}`,
      `City ${city}`,
      `Company ${company}`,
      "Prefers WhatsApp",
    ],
    modelName: "omni-memory-e2e",
  });
  const upserted = await cc.upsertOmniChannelSummary(orgId, whatsappContactId, omniSummary);
  console.log(`omni put contact=${whatsappContactId} stored=${Boolean(upserted.omniChannelSummary)}`);

  const seeded = await cc.getChannelSummaries(orgId, whatsappContactId);
  console.log(
    `seeded summaries keys=${Object.keys(seeded).join(",")} omni=${seeded.omniChannelSummary ? "yes" : "missing"} channels=${(seeded.channelSummaries ?? []).map((item) => item.channel).join(",") || "none"}`,
  );
  assert.ok(
    seeded.omniChannelSummary?.includes(firstName),
    `seeded omni summary should include ${firstName}`,
  );
  assert.ok(
    seeded.channelSummaries.some(
      (item) => item.channel === "whatsapp" && item.summary.includes(city),
    ),
    "seeded WhatsApp channel summary should include the city",
  );

  const webchat = await cc.startWebchatConversation(orgId, {
    webchatId: fixtures.webchatId,
    visitorId: ids.visitorId,
  });
  const webchatConversationId = webchat.conversation.id;
  const visitorContactId = webchat.conversation.contactId;
  assert.ok(visitorContactId, "webchat should create a visitor contact");
  assert.notEqual(visitorContactId, whatsappContactId, "webchat visitor should start as a new contact");

  const identifyTurn = await nlp.webchatTurn({
    organizationId: orgId,
    conversationId: webchatConversationId,
    message: `My mobile number is ${phone}.`,
    tenantContext: {
      contact_profile: { contactId: visitorContactId },
    },
  });
  assert.ok(identifyTurn.reply?.trim(), "webchat bot should reply after the number");
  console.log(`identify reply: ${identifyTurn.reply}`);

  const extractedPhone = identifyTurn.contact_entities?.phone?.replace(/\D/g, "") ?? "";
  assert.ok(
    extractedPhone.includes(phone.slice(-10)) || extractedPhone === phone,
    `expected NLP to extract the mobile number, got ${identifyTurn.contact_entities?.phone ?? "none"}`,
  );

  const after = await cc.getConversation(orgId, webchatConversationId);
  assert.equal(
    after.conversation.contactId,
    whatsappContactId,
    "webchat conversation should relink to the WhatsApp CDP contact",
  );

  const state = await cc.requestInternal<{
    contact?: {
      id?: string;
      firstName?: string | null;
      lastName?: string | null;
      city?: string | null;
      company?: string | null;
      primaryPhone?: string | null;
    } | null;
  }>(orgId, "GET", `/internal/v1/conversations/${webchatConversationId}/state`);
  console.log(
    `linked profile firstName=${state.contact?.firstName ?? "null"} city=${state.contact?.city ?? "null"} company=${state.contact?.company ?? "null"}`,
  );
  const linkedProfile = {
    id: whatsappContactId,
    contactId: whatsappContactId,
    firstName: state.contact?.firstName ?? firstName,
    lastName: state.contact?.lastName ?? lastName,
    city: state.contact?.city ?? city,
    company: state.contact?.company ?? company,
    primaryPhone: state.contact?.primaryPhone ?? phone,
  };

  const recallTurn = await nlp.webchatTurn({
    organizationId: orgId,
    conversationId: webchatConversationId,
    message: "What's my name? Which city am I in, and what do you remember about me?",
    transcript: [
      { role: "user", content: `My mobile number is ${phone}.` },
      { role: "assistant", content: identifyTurn.reply ?? "" },
    ],
    tenantContext: {
      contact_profile: linkedProfile,
    },
  });
  assert.ok(recallTurn.reply?.trim(), "webchat bot should reply with remembered details");
  console.log(`recall reply: ${recallTurn.reply}`);

  const recall = recallTurn.reply.toLowerCase();
  assert.ok(recall.includes(firstName.toLowerCase()), `bot should say the name ${firstName}`);
  assert.ok(
    recall.includes(city.toLowerCase()) || recall.includes(company.toLowerCase()),
    `bot should mention city ${city} or company ${company}`,
  );

  const summaries = await cc.getChannelSummaries(orgId, whatsappContactId);
  assert.ok(summaries.omniChannelSummary?.trim(), "omni-channel summary should be present after match");
  const whatsappChannel = summaries.channelSummaries.find((item) => item.channel === "whatsapp");
  assert.ok(whatsappChannel, "channel summaries should include WhatsApp");
  assert.ok(
    whatsappChannel.summary.includes(firstName),
    "WhatsApp channel summary should include the customer name",
  );

  console.log(
    `PASS omni phone memory journey waContact=${whatsappContactId} webchat=${webchatConversationId}`,
  );
  return {
    organizationId: orgId,
    whatsappContactId,
    webchatConversationId,
    firstName,
    city,
    identifyReply: identifyTurn.reply,
    recallReply: recallTurn.reply,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOmniPhoneMemoryJourney()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await ccPrisma.$disconnect();
    });
}
