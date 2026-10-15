import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { ccPrisma } from "@ai-contact-center/db-cc";
import {
  CcCoreClient,
  createTestRunIds,
  loadE2eConfig,
  runPreflight,
} from "@ai-contact-center/test-harness";

async function discoverEmailFixture(organizationId: string) {
  await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const rows = await ccPrisma.$queryRaw<
    Array<{ connection_id: string; account_email: string }>
  >`
    SELECT cc.id AS connection_id, COALESCE(NULLIF(trim(ec.sender_email), ''), 'e2e@example.test') AS account_email
    FROM accounts.setup_channel_configs cc
    LEFT JOIN accounts.setup_email_configs ec ON ec.channel_config_id = cc.id
    WHERE cc.organization_id = ${organizationId}::bigint
      AND cc.channel_type = 'email'
      AND cc.status = 'active'
    LIMIT 1
  `;
  return rows[0] ?? {
    connection_id: randomUUID(),
    account_email: "e2e@example.test",
  };
}

export async function runEmailJourney(options: { smoke?: boolean } = {}) {
  const preflight = await runPreflight();
  if (!preflight.ok || !preflight.organizationId) {
    throw new Error(`Preflight failed: ${preflight.errors.join("; ")}`);
  }

  const config = loadE2eConfig();
  const ccCore = new CcCoreClient(config);
  const ids = createTestRunIds("email");
  const mailbox = await discoverEmailFixture(preflight.organizationId);
  const externalMessageId = `e2e-${randomUUID()}`;

  const ingest = await ccCore.ingestEmail(preflight.organizationId, {
    organizationId: preflight.organizationId,
    externalThreadId: `thread-${ids.runId}`,
    externalMessageId,
    customerEmail: ids.email,
    customerName: "E2E Email Customer",
    subject: "E2E billing question",
    body: "Please explain your refund policy.",
    occurredAt: new Date().toISOString(),
    mailboxConnectionId: mailbox.connection_id,
    mailboxEmail: mailbox.account_email,
    rfcMessageId: `<${externalMessageId}@example.com>`,
  });

  assert.ok(ingest.conversation.id);

  if (options.smoke) {
    console.log("PASS email journey (smoke)");
    return { conversationId: ingest.conversation.id, organizationId: preflight.organizationId };
  }

  const session = await ccCore.loginAgent();
  if (ingest.conversation.contactId) {
    const interactions = await ccCore.getContactInteractions(session, ingest.conversation.contactId);
    assert.ok(interactions.interactions.length >= 1);
  }

  console.log("PASS email journey");
  return {
    conversationId: ingest.conversation.id,
    organizationId: preflight.organizationId,
    contactId: ingest.conversation.contactId,
    session,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const smoke = process.argv.includes("--smoke");
  runEmailJourney({ smoke })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await ccPrisma.$disconnect();
    });
}
