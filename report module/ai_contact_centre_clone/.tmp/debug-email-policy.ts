import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { getConversation } from "../apps/cc-core/src/services/conversations.js";
import { resolveEmailMailboxPolicy, toEmailMailboxPolicy } from "../apps/cc-core/src/services/email-policies.js";

const ORG_ID = "1000";
const CONVERSATION_ID = "1056";
const CONNECTION_ID = "1008";

await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  await db.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

  const conv = await getConversation(db, ORG_ID, CONVERSATION_ID);
  console.log("conversation", conv);

  const policyRows = await db.$queryRaw<
    Array<{
      bot_enabled: boolean;
      auto_send_enabled: boolean;
      shadow_mode: boolean;
      confidence_threshold: unknown;
    }>
  >`
    SELECT bot_enabled, auto_send_enabled, shadow_mode, confidence_threshold
    FROM ccass.email_mailbox_policies
    WHERE organization_id = ${ORG_ID}::bigint
      AND connection_id = ${CONNECTION_ID}::bigint
      AND status = 'active'
    LIMIT 1
  `;
  console.log("persistedPolicy", policyRows[0] ?? null);

  const resolved = await resolveEmailMailboxPolicy(db, ORG_ID, {
    connectionId: CONNECTION_ID,
    accountEmail: "sample151102@gmail.com",
  });
  console.log("channelPolicy", toEmailMailboxPolicy(resolved));

  const existing = await db.$queryRaw<
    Array<{ message_id: string | null; delivery_id: string | null }>
  >`
    SELECT turn.bot_message_id AS message_id, delivery.id AS delivery_id
    FROM ccass.nlp_turns turn
    LEFT JOIN ccass.email_delivery_outbox delivery
      ON delivery.source_message_id = turn.customer_message_id
      AND delivery.organization_id = turn.organization_id
    WHERE turn.organization_id = ${ORG_ID}::bigint
      AND turn.conversation_id = ${CONVERSATION_ID}::bigint
      AND turn.customer_message_id = 1109::bigint
    LIMIT 1
  `;
  console.log("existingTurn", existing[0] ?? null);
});

await ccPrisma.$disconnect();
