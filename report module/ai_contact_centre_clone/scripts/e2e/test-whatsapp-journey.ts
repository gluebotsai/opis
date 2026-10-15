import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { ccPrisma } from "@ai-contact-center/db-cc";
import {
  assertConversationStatus,
  CcCoreClient,
  createTestRunIds,
  loadE2eConfig,
  runPreflight,
  SocialClient,
} from "@ai-contact-center/test-harness";

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

export async function runWhatsAppJourney(options: { smoke?: boolean } = {}) {
  const preflight = await runPreflight();
  if (!preflight.ok || !preflight.organizationId) {
    throw new Error(`Preflight failed: ${preflight.errors.join("; ")}`);
  }

  const waChannel = await discoverWhatsAppChannel(preflight.organizationId);
  const phoneNumberId = preflight.whatsappPhoneNumberId ?? waChannel?.phone_number_id;
  if (!phoneNumberId) {
    throw new Error("No WhatsApp phone_number_id configured for E2E");
  }

  const config = loadE2eConfig();
  const social = new SocialClient(config);
  const ccCore = new CcCoreClient(config);
  const ids = createTestRunIds("whatsapp");
  const from = ids.phone.replace(/\D/g, "");

  const payload = social.buildInboundWebhookPayload({
    phoneNumberId,
    from,
    messageId: `wamid-${randomUUID()}`,
    body: options.smoke ? "Hello" : "I need help with my order please connect me to an agent",
  });

  await social.postWhatsAppWebhook(payload);

  if (options.smoke) {
    console.log("PASS whatsapp journey (smoke)");
    return { organizationId: preflight.organizationId, from };
  }

  const session = await ccCore.loginAgent();
  assert.ok(session.token);

  console.log("PASS whatsapp journey (webhook accepted)");
  return { organizationId: preflight.organizationId, from, session };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const smoke = process.argv.includes("--smoke");
  runWhatsAppJourney({ smoke })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await ccPrisma.$disconnect();
    });
}
