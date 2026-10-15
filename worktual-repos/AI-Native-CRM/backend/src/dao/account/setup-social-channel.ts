/**
 * CRM social (Meta) channels from Accounts — same model as CCaaS:
 * setup_channel_configs (parent, product_ids includes crm) +
 * setup_social_configs (token + Meta ids). Not mail_oauth_connections.
 */

import { accountQuery } from "@/dao/db/account-pool";
import type {
  SetupAppConnection,
  SocialPublishPlatform,
} from "@/dao/account/setup-app-connections";
import { decryptAccountsSecret } from "@/service/account/accounts-token-crypto";

type SocialChannelRow = {
  channel_config_id: string;
  channel_name: string;
  channel_status: string;
  provider: string;
  access_token_encrypted: string | null;
  page_id: string | null;
  ig_business_account_id: string | null;
  ig_webhook_account_id: string | null;
  meta_connection_status: string | null;
  meta_auth_type: string | null;
  granted_scopes: string | null;
  meta_app_id: string | null;
};

const CRM_SOCIAL_CHANNEL_SQL = `
  SELECT
    c.id::text AS channel_config_id,
    c.name AS channel_name,
    c.status AS channel_status,
    sc.provider,
    sc.access_token_encrypted,
    sc.page_id,
    sc.ig_business_account_id,
    sc.ig_webhook_account_id,
    sc.meta_connection_status,
    sc.meta_auth_type,
    sc.granted_scopes,
    sc.meta_app_id
  FROM accounts.setup_channel_configs c
  INNER JOIN accounts.setup_social_configs sc
    ON sc.channel_config_id = c.id
  WHERE c.organization_id = $1::bigint
    AND c.channel_type = 'social'
    AND lower(c.status) = 'active'
    AND c.product_ids @> '["crm"]'::jsonb
  ORDER BY c.updated_at DESC NULLS LAST, sc.provider ASC
`;

function normalizeProvider(raw: string | null): string {
  return (raw ?? "").trim().toLowerCase();
}

function metaNeedsReauth(
  metaStatus: string | null,
  channelStatus: string | null,
  hasToken: boolean,
): boolean {
  if (!hasToken) return true;
  const hay = `${metaStatus ?? ""} ${channelStatus ?? ""}`.toLowerCase();
  return (
    hay.includes("reauth") ||
    hay.includes("disconnected") ||
    hay.includes("expired") ||
    hay.includes("revoked") ||
    hay.includes("error")
  );
}

function mapSocialRowToConnection(
  row: SocialChannelRow,
  platform: SocialPublishPlatform,
): SetupAppConnection | null {
  let accessToken: string | null = null;
  try {
    accessToken = row.access_token_encrypted
      ? decryptAccountsSecret(row.access_token_encrypted)
      : null;
  } catch {
    accessToken = null;
  }

  const pageId = row.page_id?.trim() || null;
  const igId = row.ig_business_account_id?.trim() || null;
  const metaStatus = row.meta_connection_status?.trim() || null;
  const needsReauth = metaNeedsReauth(
    metaStatus,
    row.channel_status,
    Boolean(accessToken?.trim()),
  );

  const externalAccountId =
    platform === "instagram"
      ? igId || pageId
      : pageId || igId;

  if (platform === "facebook" && !pageId && !igId) {
    return null;
  }
  if (platform === "instagram" && !igId) {
    return null;
  }

  const displayName =
    platform === "instagram"
      ? igId
        ? `Instagram ${igId}`
        : row.channel_name
      : pageId
        ? `Facebook Page ${pageId}`
        : row.channel_name;

  const statusRaw = metaStatus || row.channel_status || "active";

  return {
    id: `${row.channel_config_id}:${row.provider}`,
    organizationId: "",
    appKey: row.provider,
    provider: row.provider,
    status: needsReauth && !accessToken ? "disconnected" : statusRaw.trim() || "active",
    connectionKind: "social_channel",
    displayName,
    accountEmail: null,
    externalAccountId,
    scopes: row.granted_scopes,
    mcpUrl: null,
    oauthClientId: row.meta_app_id,
    accessToken,
    refreshToken: null,
    tokenExpiresAt: null,
    metadata: {
      channelConfigId: row.channel_config_id,
      pageId,
      page_id: pageId,
      igUserId: igId,
      ig_business_account_id: igId,
      ig_webhook_account_id: row.ig_webhook_account_id,
      meta_connection_status: metaStatus,
      meta_auth_type: row.meta_auth_type,
      meta_app_id: row.meta_app_id,
      source: "setup_social_configs",
    },
  };
}

/** All CRM-assigned social channel rows for an org (Meta + any other providers). */
export async function listCrmSocialChannelRows(
  organizationId: string,
): Promise<SocialChannelRow[]> {
  const orgId = organizationId?.trim();
  if (!orgId) return [];
  const { rows } = await accountQuery<SocialChannelRow>(
    CRM_SOCIAL_CHANNEL_SQL,
    [orgId],
  );
  return rows;
}

function pickRowForPlatform(
  rows: SocialChannelRow[],
  platform: SocialPublishPlatform,
): SocialChannelRow | null {
  if (platform === "linkedin") {
    return (
      rows.find((r) => normalizeProvider(r.provider).includes("linkedin")) ??
      null
    );
  }

  if (platform === "facebook") {
    return (
      rows.find((r) => {
        const p = normalizeProvider(r.provider);
        return p === "facebook" || p === "meta" || p === "fb";
      }) ?? null
    );
  }

  // instagram
  const igRow = rows.find((r) => normalizeProvider(r.provider) === "instagram");
  if (igRow?.ig_business_account_id?.trim()) return igRow;

  const metaRow = rows.find((r) => {
    const p = normalizeProvider(r.provider);
    return (
      (p === "facebook" || p === "meta" || p === "fb") &&
      Boolean(r.ig_business_account_id?.trim())
    );
  });
  if (metaRow) return metaRow;

  return igRow ?? null;
}

/**
 * Facebook / Instagram (and LinkedIn when stored on social configs) for CRM product.
 * Returns null when no matching setup_social_configs row or token unusable.
 */
export async function getCrmSocialChannelConnection(
  organizationId: string,
  platform: SocialPublishPlatform,
): Promise<SetupAppConnection | null> {
  const orgId = organizationId?.trim();
  if (!orgId) return null;

  const rows = await listCrmSocialChannelRows(orgId);
  const row = pickRowForPlatform(rows, platform);
  if (!row) return null;

  const conn = mapSocialRowToConnection(row, platform);
  if (!conn) return null;
  conn.organizationId = orgId;
  return conn;
}
