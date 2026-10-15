import type { DbClient } from "../lib/rls.js";
import { serializeEntityIdOptional } from "../lib/id-schema.js";

/** Email stores the setup channel config id on mailbox_connection_id. */
export function channelConfigIdFromMailbox(
  mailboxConnectionId: string | null | undefined,
): string | null {
  if (mailboxConnectionId == null) return null;
  const trimmed = String(mailboxConnectionId).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function resolveWebchatChannelConfigId(
  db: DbClient,
  organizationId: string,
  webchatId: string,
): Promise<string | null> {
  const rows = await db.$queryRaw<{ channel_config_id: string | bigint }[]>`
    SELECT wc.channel_config_id
    FROM accounts.setup_webchat_configs wc
    INNER JOIN accounts.setup_channel_configs cc ON cc.id = wc.channel_config_id
    WHERE wc.webchat_id = ${webchatId}
      AND cc.organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  return serializeEntityIdOptional(rows[0]?.channel_config_id) ?? null;
}

export async function backfillWebchatChannelConfigIds(
  db: DbClient,
  organizationId?: string,
): Promise<number> {
  if (organizationId) {
    const result = await db.$executeRaw`
      UPDATE ccass.conversations c
      SET channel_config_id = wc.channel_config_id,
          updated_at = NOW()
      FROM accounts.setup_webchat_configs wc
      INNER JOIN accounts.setup_channel_configs cc ON cc.id = wc.channel_config_id
      WHERE c.channel = 'webchat'
        AND c.webchat_id = wc.webchat_id
        AND c.organization_id = cc.organization_id
        AND c.organization_id = ${organizationId}::bigint
        AND c.channel_config_id IS NULL
    `;
    return Number(result);
  }

  const result = await db.$executeRaw`
    UPDATE ccass.conversations c
    SET channel_config_id = wc.channel_config_id,
        updated_at = NOW()
    FROM accounts.setup_webchat_configs wc
    INNER JOIN accounts.setup_channel_configs cc ON cc.id = wc.channel_config_id
    WHERE c.channel = 'webchat'
      AND c.webchat_id = wc.webchat_id
      AND c.organization_id = cc.organization_id
      AND c.channel_config_id IS NULL
  `;
  return Number(result);
}

export async function backfillEmailChannelConfigIds(
  db: DbClient,
  organizationId?: string,
): Promise<number> {
  if (organizationId) {
    const result = await db.$executeRaw`
      UPDATE ccass.conversations
      SET channel_config_id = mailbox_connection_id,
          updated_at = NOW()
      WHERE channel = 'email'
        AND organization_id = ${organizationId}::bigint
        AND mailbox_connection_id IS NOT NULL
        AND channel_config_id IS NULL
    `;
    return Number(result);
  }

  const result = await db.$executeRaw`
    UPDATE ccass.conversations
    SET channel_config_id = mailbox_connection_id,
        updated_at = NOW()
    WHERE channel = 'email'
      AND mailbox_connection_id IS NOT NULL
      AND channel_config_id IS NULL
  `;
  return Number(result);
}
