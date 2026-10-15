/**
 * Resolve the org's CRM email channel from accounts.
 *
 * Product assignment lives on setup_channel_configs.product_ids (JSONB),
 * not on setup_email_configs. Join email settings via channel_config_id.
 * Selection is product-scoped only (`product_ids` contains "crm").
 * `setup_email_configs.is_bot` is a CCAAS concern — CRM ignores it.
 */

import { accountQuery } from "@/dao/db/account-pool";
import { encryptAccountsSecret } from "@/service/account/accounts-token-crypto";
import { getCurrentOrganizationId } from "@/service/auth/require-role";

export type CrmBotMailbox = {
  channelConfigId: string;
  channelName: string;
  emailConfigId: string;
  providerType: string;
  thirdPartyMode: string | null;
  oauthProvider: "google" | "microsoft" | null;
  oauthConnectionId: string | null;
  senderEmail: string | null;
  senderName: string | null;
  replyTo: string | null;
  accountEmail: string | null;
  accountName: string | null;
  msTenantId: string | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  oauthScope: string | null;
  needsReauth: boolean;
};

type Row = {
  channel_config_id: string;
  channel_name: string;
  email_config_id: string;
  provider_type: string;
  third_party_mode: string | null;
  oauth_provider: string | null;
  oauth_connection_id: string | null;
  sender_email: string | null;
  sender_name: string | null;
  reply_to: string | null;
  account_email: string | null;
  account_name: string | null;
  ms_tenant_id: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  expires_at: Date | null;
  oauth_scope: string | null;
  needs_reauth: boolean | null;
};

function mapOauthProvider(
  raw: string | null,
): "google" | "microsoft" | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "google") return "google";
  if (v === "microsoft" || v === "outlook" || v === "azure") return "microsoft";
  return null;
}

/** Active email channel assigned to product "crm" (most recently updated). */
export async function resolveCrmBotMailbox(
  organizationId: string,
): Promise<CrmBotMailbox | null> {
  const orgId = organizationId?.trim();
  if (!orgId) return null;

  const { rows } = await accountQuery<Row>(
    `SELECT
       c.id::text AS channel_config_id,
       c.name AS channel_name,
       e.id::text AS email_config_id,
       e.provider_type,
       e.third_party_mode,
       e.oauth_provider,
       e.oauth_connection_id::text AS oauth_connection_id,
       e.sender_email,
       e.sender_name,
       e.reply_to,
       o.account_email,
       o.account_name,
       o.ms_tenant_id,
       o.access_token_encrypted,
       o.refresh_token_encrypted,
       o.expires_at,
       o.scope AS oauth_scope,
       o.needs_reauth
     FROM accounts.setup_channel_configs c
     INNER JOIN accounts.setup_email_configs e
       ON e.channel_config_id = c.id
     LEFT JOIN accounts.mail_oauth_connections o
       ON o.id = e.oauth_connection_id
     WHERE c.organization_id = $1::bigint
       AND c.channel_type = 'email'
       AND lower(c.status) = 'active'
       AND c.product_ids @> '["crm"]'::jsonb
     ORDER BY c.updated_at DESC, e.id DESC
     LIMIT 1`,
    [orgId],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    channelConfigId: row.channel_config_id,
    channelName: row.channel_name,
    emailConfigId: row.email_config_id,
    providerType: row.provider_type,
    thirdPartyMode: row.third_party_mode,
    oauthProvider: mapOauthProvider(row.oauth_provider),
    oauthConnectionId: row.oauth_connection_id,
    senderEmail: row.sender_email,
    senderName: row.sender_name,
    replyTo: row.reply_to,
    accountEmail: row.account_email,
    accountName: row.account_name,
    msTenantId: row.ms_tenant_id,
    accessTokenEncrypted: row.access_token_encrypted,
    refreshTokenEncrypted: row.refresh_token_encrypted,
    tokenExpiresAt: row.expires_at ? new Date(row.expires_at) : null,
    oauthScope: row.oauth_scope,
    needsReauth: Boolean(row.needs_reauth),
  };
}

export async function saveCrmBotGoogleTokens(input: {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  accountEmail: string | null;
  scope: string | null;
}): Promise<{ ok: true; email: string | null } | { ok: false; error: string }> {
  const mailbox = await resolveCrmBotMailbox(await getCurrentOrganizationId());
  if (!mailbox) {
    return {
      ok: false,
      error:
        "No active CRM email channel in Accounts. Create one with product_ids including crm.",
    };
  }
  if (!mailbox.oauthConnectionId) {
    return {
      ok: false,
      error: "CRM email channel has no OAuth connection row to update.",
    };
  }
  const expected = (mailbox.accountEmail || mailbox.senderEmail || "")
    .trim()
    .toLowerCase();
  const got = (input.accountEmail || "").trim().toLowerCase();
  if (expected && got && expected !== got) {
    return {
      ok: false,
      error: `wrong_account:${mailbox.accountEmail || mailbox.senderEmail}`,
    };
  }
  const accessEnc = encryptAccountsSecret(input.accessToken);
  const refreshEnc = encryptAccountsSecret(input.refreshToken);
  await accountQuery(
    `UPDATE accounts.mail_oauth_connections
     SET access_token_encrypted = $2,
         refresh_token_encrypted = $3,
         expires_at = $4,
         account_email = COALESCE($5, account_email),
         scope = COALESCE($6, scope),
         needs_reauth = false,
         updated_at = now()
     WHERE id = $1::bigint`,
    [
      mailbox.oauthConnectionId,
      accessEnc,
      refreshEnc,
      input.expiresAt?.toISOString() ?? null,
      input.accountEmail,
      input.scope,
    ],
  );
  if (input.accountEmail) {
    await accountQuery(
      `UPDATE accounts.setup_email_configs
       SET sender_email = $2, updated_at = now()
       WHERE id = $1::bigint`,
      [mailbox.emailConfigId, input.accountEmail],
    );
  }
  return { ok: true, email: input.accountEmail || mailbox.accountEmail };
}
