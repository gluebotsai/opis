import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { ccPrisma } from "@ai-contact-center/db-cc";
import {
  CcCoreClient,
  createTestRunIds,
  loadE2eConfig,
  runPreflight,
  SocialClient,
} from "@ai-contact-center/test-harness";

async function discoverFixtures(organizationId: string) {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const [webchat, email, whatsapp] = await Promise.all([
    ccPrisma.$queryRaw<Array<{ webchat_id: string }>>`
      SELECT config.webchat_id
      FROM accounts.setup_webchat_configs config
      INNER JOIN accounts.setup_channel_configs channel ON channel.id = config.channel_config_id
      WHERE channel.organization_id = ${organizationId}::bigint AND channel.status = 'active'
      LIMIT 1
    `,
    ccPrisma.$queryRaw<Array<{ connection_id: string; account_email: string }>>`
      SELECT cc.id AS connection_id, COALESCE(NULLIF(trim(ec.sender_email), ''), 'e2e@example.test') AS account_email
      FROM accounts.setup_channel_configs cc
      LEFT JOIN accounts.setup_email_configs ec ON ec.channel_config_id = cc.id
      WHERE cc.organization_id = ${organizationId}::bigint AND cc.channel_type = 'email' AND cc.status = 'active'
      LIMIT 1
    `,
    ccPrisma.$queryRaw<Array<{ phone_number_id: string | null }>>`
      SELECT wc.phone_number_id
      FROM accounts.setup_social_configs wc
      INNER JOIN accounts.setup_channel_configs channel ON channel.id = wc.channel_config_id
      WHERE channel.organization_id = ${organizationId}::bigint AND channel.status = 'active' AND wc.provider = 'whatsapp'
      LIMIT 1
    `,
  ]);
  return {
    webchatId: webchat[0]?.webchat_id,
    email: email[0],
    phoneNumberId: whatsapp[0]?.phone_number_id,
  };
}

export async function runCrossChannelJourney(options: { smoke?: boolean } = {}) {
  const preflight = await runPreflight();
  if (!preflight.ok || !preflight.organizationId) {
    throw new Error(`Preflight failed: ${preflight.errors.join("; ")}`);
  }

  const config = loadE2eConfig();
  const ccCore = new CcCoreClient(config);
  const social = new SocialClient(config);
  const ids = createTestRunIds("xch");
  const fixtures = await discoverFixtures(preflight.organizationId);
  const sharedEmail = ids.email;
  const phone = ids.phone.replace(/\D/g, "");

  if (fixtures.phoneNumberId) {
    await social.postWhatsAppWebhook(
      social.buildInboundWebhookPayload({
        phoneNumberId: fixtures.phoneNumberId,
        from: phone,
        messageId: `wamid-${randomUUID()}`,
        body: `My email is ${sharedEmail}`,
      }),
    );
  }

  if (fixtures.webchatId) {
    await ccCore.startWebchatConversation(preflight.organizationId, {
      webchatId: fixtures.webchatId,
      visitorId: ids.visitorId,
      prechatAnswers: { email: sharedEmail, name: "Cross Channel User" },
    });
  }

  if (fixtures.email) {
    const msgId = `xch-${randomUUID()}`;
    await ccCore.ingestEmail(preflight.organizationId, {
      organizationId: preflight.organizationId,
      externalThreadId: `xch-thread-${ids.runId}`,
      externalMessageId: msgId,
      customerEmail: sharedEmail,
      customerName: "Cross Channel User",
      subject: "Cross channel follow-up",
      body: "Following up on my earlier messages.",
      occurredAt: new Date().toISOString(),
      mailboxConnectionId: fixtures.email.connection_id,
      mailboxEmail: fixtures.email.account_email,
      rfcMessageId: `<${msgId}@example.com>`,
    });
  }

  const session = await ccCore.loginAgent();
  const resolved = await ccCore.resolveContact(session, { email: sharedEmail });
  assert.ok(resolved.contactId);

  const interactions = await ccCore.getContactInteractions(session, resolved.contactId);
  assert.ok(interactions.interactions.length >= (options.smoke ? 1 : 2));

  if (!options.smoke && interactions.interactions.length >= 2) {
    const channels = new Set(interactions.interactions.map((row) => row.channel));
    assert.ok(channels.size >= 2);
  }

  console.log(`PASS cross-channel journey${options.smoke ? " (smoke)" : ""}`);
  return { contactId: resolved.contactId, organizationId: preflight.organizationId, session };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const smoke = process.argv.includes("--smoke");
  runCrossChannelJourney({ smoke })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await ccPrisma.$disconnect();
    });
}
