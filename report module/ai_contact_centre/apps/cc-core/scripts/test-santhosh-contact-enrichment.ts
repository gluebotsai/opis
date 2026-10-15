import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { ccPrisma } from "@ai-contact-center/db-cc";
import { runRollbackIntegration } from "@ai-contact-center/test-harness";

import { enrichContactFromConversation } from "../src/services/contact-identity.js";
import { startConversation } from "../src/services/conversations.js";

const fixtures = await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  return db.$queryRaw<Array<{ organization_id: string; webchat_id: string | null }>>`
    SELECT org.id AS organization_id, wc.webchat_id
    FROM accounts.organizations org
    LEFT JOIN accounts.setup_webchat_configs wc ON wc.organization_id = org.id
    WHERE org.lifecycle_status = 'active'
    ORDER BY org.created_at DESC
    LIMIT 1
  `;
});

const fixture = fixtures[0];
if (!fixture?.webchat_id) {
  console.log("SKIP santhosh contact enrichment: no webchat config");
  await ccPrisma.$disconnect();
  process.exit(0);
}

await runRollbackIntegration(async (db) => {
  const visitorId = `v_santhosh_${randomUUID().slice(0, 8)}`;
  const started = await startConversation(db, fixture.organization_id, {
    webchatId: fixture.webchat_id,
    visitorId,
    conversationId: randomUUID(),
  });

  const result = await enrichContactFromConversation(
    db,
    fixture.organization_id,
    started.conversation.id,
    {
      email: "santhosh@example.com",
      displayName: "Santhosh",
      sourceMessageId: randomUUID(),
    },
  );

  assert.ok(result);
  assert.equal(result!.contact.primaryEmail, "santhosh@example.com");
  assert.match(result!.contact.fullName, /Santhosh/i);

  const linked = await db.$queryRaw<Array<{ contact_id: string | null }>>`
    SELECT contact_id FROM ccass.conversations
    WHERE id = ${started.conversation.id}::bigint
    LIMIT 1
  `;
  assert.ok(linked[0]?.contact_id);

  const listed = await db.$queryRaw<Array<{ key_value: string }>>`
    SELECT ik.key_value
    FROM cdp.identity_keys ik
    WHERE ik.organization_id = ${fixture.organization_id}::bigint
      AND ik.key_type = 'email'
      AND lower(ik.key_value) = lower('santhosh@example.com')
    LIMIT 1
  `;
  assert.equal(listed[0]?.key_value, "santhosh@example.com");

  console.log("OK santhosh contact enrichment e2e");
});

await ccPrisma.$disconnect();
