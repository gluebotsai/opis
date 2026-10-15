import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { ccPrisma } from "@ai-contact-center/db-cc";
import { runRollbackIntegration } from "@ai-contact-center/test-harness";

import { enrichContactFromConversation } from "../src/services/contact-identity.js";
import { listContactInteractions } from "../src/services/contact-interactions.js";
import { ingestInboundEmailConversation } from "../src/services/email-conversations.js";
import { ingestInboundSocialConversation } from "../src/services/social-conversations.js";

const fixtures = await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  return db.$queryRaw<
    Array<{
      organization_id: string;
      connection_id: string;
      account_email: string;
      whatsapp_channel_config_id: string | null;
    }>
  >`
    SELECT
      org.id AS organization_id,
      COALESCE(email_cc.id, gen_random_uuid()) AS connection_id,
      COALESCE(
        NULLIF(trim(ec.sender_email), ''),
        'integration-mailbox@example.test'
      ) AS account_email,
      wa_cc.id AS whatsapp_channel_config_id
    FROM accounts.organizations org
    LEFT JOIN accounts.setup_channel_configs email_cc
      ON email_cc.organization_id = org.id
      AND email_cc.channel_type = 'email'
      AND email_cc.status = 'active'
    LEFT JOIN accounts.setup_email_configs ec
      ON ec.channel_config_id = email_cc.id
    LEFT JOIN accounts.setup_channel_configs wa_cc
      ON wa_cc.organization_id = org.id
      AND wa_cc.channel_type = 'whatsapp'
      AND wa_cc.status = 'active'
    WHERE org.lifecycle_status = 'active'
    ORDER BY org.created_at DESC
    LIMIT 1
  `;
});

const fixture = fixtures[0];
if (!fixture?.whatsapp_channel_config_id) {
  console.log("SKIP contact identity integration: no active whatsapp channel");
  await ccPrisma.$disconnect();
  process.exit(0);
}

await runRollbackIntegration(async (db) => {
  const runId = randomUUID().slice(0, 8);
  const sharedEmail = `identity-${runId}@example.com`;
  const phone = `1555${runId.replace(/\D/g, "").slice(0, 7).padEnd(7, "0")}`;

  const emailIngest = await ingestInboundEmailConversation(db, {
    organizationId: fixture.organization_id,
    externalThreadId: `email-thread-${runId}`,
    externalMessageId: `email-msg-${runId}`,
    customerEmail: sharedEmail,
    customerName: "Identity Test",
    subject: "Cross-channel identity",
    body: "Email from shared customer.",
    occurredAt: new Date().toISOString(),
    mailboxConnectionId: fixture.connection_id,
    mailboxEmail: fixture.account_email,
    rfcMessageId: `<email-${runId}@example.com>`,
  });

  const whatsappIngest = await ingestInboundSocialConversation(db, {
    organizationId: fixture.organization_id,
    channelConfigId: fixture.whatsapp_channel_config_id,
    channelType: "whatsapp",
    externalThreadId: phone,
    externalMessageId: `wa-msg-${runId}`,
    customerRef: phone,
    customerName: "Identity Test",
    body: "WhatsApp from shared customer.",
    occurredAt: new Date().toISOString(),
  });

  const emailContactId = emailIngest.conversation.contactId;
  assert.ok(emailContactId);
  const originalWhatsappContactId = whatsappIngest.conversation.contactId;
  assert.ok(originalWhatsappContactId);

  await enrichContactFromConversation(db, fixture.organization_id, whatsappIngest.conversation.id, {
    email: sharedEmail,
  });

  const whatsappRows = await db.$queryRaw<Array<{ contact_id: string | null }>>`
    SELECT contact_id FROM ccass.conversations
    WHERE id = ${whatsappIngest.conversation.id}::bigint
    LIMIT 1
  `;
  assert.equal(whatsappRows[0]?.contact_id, emailContactId);

  // Reverse cross-channel: email conversation receives phone in body → links to merged contact.
  const emailWithPhoneIngest = await ingestInboundEmailConversation(db, {
    organizationId: fixture.organization_id,
    externalThreadId: `email-thread-phone-${runId}`,
    externalMessageId: `email-msg-phone-${runId}`,
    customerEmail: `other-${runId}@example.com`,
    customerName: "Identity Test",
    subject: "Phone in body",
    body: `Please call me. My mobile number is ${phone}.`,
    occurredAt: new Date().toISOString(),
    mailboxConnectionId: fixture.connection_id,
    mailboxEmail: fixture.account_email,
    rfcMessageId: `<email-phone-${runId}@example.com>`,
  });

  await enrichContactFromConversation(db, fixture.organization_id, emailWithPhoneIngest.conversation.id, {
    phone,
    sourceMessageId: emailWithPhoneIngest.message.id,
  });

  const emailWithPhoneRows = await db.$queryRaw<Array<{ contact_id: string | null }>>`
    SELECT contact_id FROM ccass.conversations
    WHERE id = ${emailWithPhoneIngest.conversation.id}::bigint
    LIMIT 1
  `;
  assert.equal(
    emailWithPhoneRows[0]?.contact_id,
    emailContactId,
    "email with phone in body should resolve to existing cross-channel contact",
  );

  const interactions = await listContactInteractions(
    db,
    fixture.organization_id,
    emailContactId,
    { limit: 20 },
  );
  const channels = new Set(interactions.interactions.map((row) => row.channel));
  assert.ok(channels.has("email"));
  assert.ok(channels.has("whatsapp"));
  assert.ok(interactions.interactions.length >= 2);

  const duplicateRetired = await db.$queryRaw<
    Array<{ custom_fields: Record<string, unknown> | null }>
  >`
    SELECT custom_fields
    FROM cdp.customer_profile
    WHERE organization_id = ${fixture.organization_id}::bigint
      AND cdp_id = ${originalWhatsappContactId}::text
    LIMIT 1
  `;
  if (originalWhatsappContactId !== emailContactId) {
    assert.equal(duplicateRetired[0]?.custom_fields?.mergedInto, emailContactId);
  }

  await enrichContactFromConversation(db, fixture.organization_id, whatsappIngest.conversation.id, {
    email: sharedEmail,
  });

  const whatsappRowsAfterRetry = await db.$queryRaw<Array<{ contact_id: string | null }>>`
    SELECT contact_id FROM ccass.conversations
    WHERE id = ${whatsappIngest.conversation.id}::bigint
    LIMIT 1
  `;
  assert.equal(whatsappRowsAfterRetry[0]?.contact_id, emailContactId);

  console.log("PASS contact identity integration");
});

await ccPrisma.$disconnect();
