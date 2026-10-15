/**
 * Re-key mailbox policies and conversations from legacy setup_app_connections ids
 * to setup_channel_configs ids for the same mailbox email.
 */
import { ccPrisma } from "@ai-contact-center/db-cc";

const updated = await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  const policies = await db.$executeRaw`
    UPDATE ccass.email_mailbox_policies policy
    SET
      connection_id = channel.channel_config_id,
      updated_at = NOW()
    FROM (
      SELECT
        cc.id AS channel_config_id,
        cc.organization_id,
        COALESCE(NULLIF(trim(ec.sender_email), ''), oauth.account_email) AS account_email
      FROM accounts.setup_channel_configs cc
      INNER JOIN accounts.setup_email_configs ec ON ec.channel_config_id = cc.id
      LEFT JOIN accounts.mail_oauth_connections oauth ON oauth.id = ec.oauth_connection_id
      WHERE cc.channel_type = 'email'
        AND cc.status = 'active'
    ) channel
    WHERE policy.organization_id = channel.organization_id
      AND lower(policy.account_email) = lower(channel.account_email)
      AND policy.connection_id <> channel.channel_config_id
  `;
  const conversations = await db.$executeRaw`
    UPDATE ccass.conversations conversation
    SET
      mailbox_connection_id = channel.channel_config_id,
      updated_at = NOW()
    FROM (
      SELECT
        cc.id AS channel_config_id,
        cc.organization_id,
        COALESCE(NULLIF(trim(ec.sender_email), ''), oauth.account_email) AS account_email
      FROM accounts.setup_channel_configs cc
      INNER JOIN accounts.setup_email_configs ec ON ec.channel_config_id = cc.id
      LEFT JOIN accounts.mail_oauth_connections oauth ON oauth.id = ec.oauth_connection_id
      WHERE cc.channel_type = 'email'
        AND cc.status = 'active'
    ) channel
    WHERE conversation.organization_id = channel.organization_id
      AND conversation.channel = 'email'
      AND conversation.mailbox_connection_id IS NOT NULL
      AND conversation.mailbox_connection_id <> channel.channel_config_id
      AND lower(conversation.visitor_id) = lower(channel.account_email)
  `;
  return { policies, conversations };
});

console.log(JSON.stringify({ rekeyed: updated }, null, 2));
await ccPrisma.$disconnect();
