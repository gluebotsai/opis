/**
 * Org-level product connectors (Semrush, social, research APIs).
 *
 * Reads: Onboarding internal API when PRODUCT_MCP_CONNECTORS_TOKEN is set
 * (`GET …/internal/connected-apps/{app_key}/credentials?organization_id=`).
 * Legacy fallback: accounts.setup_app_connections SELECT only when
 * ONBOARDING_ALLOW_SETUP_APP_CONNECTIONS_FALLBACK=true.
 *
 * Token writeback after Semrush refresh still UPDATEs setup_app_connections
 * only when legacy fallback is allowed; otherwise onboarding owns persistence.
 */

import { accountQuery } from "@/dao/db/account-pool";
import {
  decryptAccountsSecret,
  encryptAccountsSecret,
} from "@/service/account/accounts-token-crypto";
import {
  allowSetupAppConnectionsFallback,
  isOnboardingConnectorsConfigured,
} from "@/service/onboarding/connected-apps-config";
import {
  fetchConnectedAppCredentials,
  fetchConnectedAppCredentialsFirst,
  type OnboardingConnectedAppCredentials,
} from "@/service/onboarding/connected-apps-credentials";

function shouldUseLegacySetupAppConnectionsDb(): boolean {
  return (
    !isOnboardingConnectorsConfigured() ||
    allowSetupAppConnectionsFallback()
  );
}

function mapOnboardingCredentials(
  c: OnboardingConnectedAppCredentials,
): SetupAppConnection {
  return {
    id: `${c.organizationId}:${c.appKey}`,
    organizationId: c.organizationId,
    appKey: c.appKey,
    provider: c.provider,
    status: c.status,
    connectionKind: c.connectionKind,
    displayName: c.name,
    accountEmail: c.accountEmail,
    externalAccountId: c.externalAccountId,
    scopes: c.scopes,
    mcpUrl: c.mcpUrl,
    oauthClientId: c.oauthClientId,
    accessToken: c.accessToken,
    refreshToken: c.refreshToken,
    tokenExpiresAt: c.expiresAt,
    metadata: c.metadata,
  };
}

async function listSetupAppConnectionRowsFromDb(
  organizationId: string,
  limit = 80,
): Promise<Row[]> {
  const orgId = organizationId?.trim();
  if (!orgId) return [];
  const { rows } = await accountQuery<Row>(
    `SELECT
       id::text,
       organization_id::text,
       app_key,
       provider,
       status,
       connection_kind,
       display_name,
       account_email,
       external_account_id,
       scopes,
       mcp_url,
       oauth_client_id,
       access_token_encrypted,
       refresh_token_encrypted,
       token_expires_at,
       metadata
     FROM accounts.setup_app_connections
     WHERE organization_id = $1::bigint
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT $2`,
    [orgId, limit],
  );
  return rows;
}

export type SetupAppConnection = {
  id: string;
  organizationId: string;
  appKey: string | null;
  provider: string | null;
  status: string | null;
  connectionKind: string | null;
  displayName: string | null;
  accountEmail: string | null;
  externalAccountId: string | null;
  scopes: string | null;
  mcpUrl: string | null;
  oauthClientId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  metadata: Record<string, unknown> | null;
};

type Row = {
  id: string;
  organization_id: string;
  app_key: string | null;
  provider: string | null;
  status: string | null;
  connection_kind: string | null;
  display_name: string | null;
  account_email: string | null;
  external_account_id: string | null;
  scopes: string | null;
  mcp_url: string | null;
  oauth_client_id: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: Date | null;
  metadata: unknown;
};

function isSemrushRow(r: Row): boolean {
  const hay = [
    r.provider,
    r.app_key,
    r.connection_kind,
    r.display_name,
    r.mcp_url,
  ]
    .map((v) => (v || "").toLowerCase())
    .join(" ");
  return (
    hay.includes("semrush") ||
    (hay.includes("mcp") && Boolean(r.mcp_url?.includes("semrush")))
  );
}

function mapRow(r: Row): SetupAppConnection {
  let metadata: Record<string, unknown> | null = null;
  if (r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata)) {
    metadata = r.metadata as Record<string, unknown>;
  }
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  try {
    accessToken = r.access_token_encrypted
      ? decryptAccountsSecret(r.access_token_encrypted)
      : null;
  } catch {
    accessToken = null;
  }
  try {
    refreshToken = r.refresh_token_encrypted
      ? decryptAccountsSecret(r.refresh_token_encrypted)
      : null;
  } catch {
    refreshToken = null;
  }
  return {
    id: r.id,
    organizationId: r.organization_id,
    appKey: r.app_key,
    provider: r.provider,
    status: r.status,
    connectionKind: r.connection_kind,
    displayName: r.display_name,
    accountEmail: r.account_email,
    externalAccountId: r.external_account_id,
    scopes: r.scopes,
    mcpUrl: r.mcp_url,
    oauthClientId: r.oauth_client_id,
    accessToken,
    refreshToken,
    tokenExpiresAt: r.token_expires_at
      ? new Date(r.token_expires_at)
      : null,
    metadata,
  };
}

const SEMRUSH_APP_KEYS = ["semrush", "semrush_mcp", "semrush-mcp"] as const;

/** Active Semrush MCP connection for an org (most recently updated). */
export async function getSemrushAppConnection(
  organizationId: string,
): Promise<SetupAppConnection | null> {
  const orgId = organizationId?.trim();
  if (!orgId) return null;
  if (isOnboardingConnectorsConfigured()) {
    const hit = await fetchConnectedAppCredentialsFirst(
      orgId,
      SEMRUSH_APP_KEYS,
    );
    if (hit) return mapOnboardingCredentials(hit);
  }
  if (!shouldUseLegacySetupAppConnectionsDb()) return null;
  const rows = await listSetupAppConnectionRowsFromDb(orgId, 40);
  const active = rows.filter((r) =>
    ["active", "connected", "ok"].includes(
      (r.status || "active").toLowerCase(),
    ),
  );
  const hit = active.find(isSemrushRow) ?? null;
  return hit ? mapRow(hit) : null;
}

/** Orgs that have at least one Semrush-like connection (for daily sweep). */
export async function listOrgIdsWithSemrushConnections(
  limit = 200,
): Promise<string[]> {
  if (
    isOnboardingConnectorsConfigured() &&
    !allowSetupAppConnectionsFallback()
  ) {
    console.info(
      "[setup-app-connections] Semrush org sweep skipped: onboarding credentials API has no org list; pass organizationId to bootstrap or enable ONBOARDING_ALLOW_SETUP_APP_CONNECTIONS_FALLBACK for legacy discovery.",
    );
    return [];
  }
  const { rows } = await accountQuery<{ organization_id: string }>(
    `SELECT DISTINCT organization_id::text AS organization_id
     FROM accounts.setup_app_connections
     WHERE lower(coalesce(status, 'active')) IN ('active', 'connected', 'ok')
       AND (
         lower(coalesce(provider, '')) LIKE '%semrush%'
         OR lower(coalesce(app_key, '')) LIKE '%semrush%'
         OR lower(coalesce(mcp_url, '')) LIKE '%semrush%'
       )
     ORDER BY organization_id
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.organization_id);
}

/** Write refreshed OAuth tokens back (existing columns only). */
export async function updateSetupAppConnectionTokens(input: {
  connectionId: string;
  organizationId: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  mcpUrl?: string | null;
}): Promise<boolean> {
  if (isOnboardingConnectorsConfigured() && !allowSetupAppConnectionsFallback()) {
    console.warn(
      "[setup-app-connections] Semrush token writeback skipped (onboarding owns credentials; connectionId=%s).",
      input.connectionId,
    );
    return false;
  }
  const accessEnc = encryptAccountsSecret(input.accessToken);
  const refreshEnc =
    input.refreshToken != null && input.refreshToken !== ""
      ? encryptAccountsSecret(input.refreshToken)
      : null;
  const { rows } = await accountQuery<{ id: string }>(
    `UPDATE accounts.setup_app_connections
     SET access_token_encrypted = $3,
         refresh_token_encrypted = COALESCE($4, refresh_token_encrypted),
         token_expires_at = COALESCE($5, token_expires_at),
         mcp_url = COALESCE($6, mcp_url),
         updated_at = NOW()
     WHERE id = $1::bigint
       AND organization_id = $2::bigint
     RETURNING id::text AS id`,
    [
      input.connectionId,
      input.organizationId,
      accessEnc,
      refreshEnc,
      input.tokenExpiresAt ?? null,
      input.mcpUrl ?? null,
    ],
  );
  return rows.length > 0;
}

export const SOCIAL_PUBLISH_PLATFORMS = [
  "linkedin",
  "facebook",
  "instagram",
] as const;
export type SocialPublishPlatform = (typeof SOCIAL_PUBLISH_PLATFORMS)[number];

const SOCIAL_APP_KEYS: Record<SocialPublishPlatform, readonly string[]> = {
  linkedin: ["linkedin"],
  facebook: ["facebook", "meta"],
  instagram: ["instagram"],
};

function socialStatusFromConnection(
  platform: SocialPublishPlatform,
  conn: SetupAppConnection | null,
): SocialConnectionStatus {
  if (!conn) {
    return {
      platform,
      connected: false,
      needsReauth: false,
      connectionId: null,
      displayName: null,
      accountEmail: null,
    };
  }
  const status = (conn.status || "").toLowerCase();
  const metaStatus = String(
    conn.metadata?.meta_connection_status ?? "",
  ).toLowerCase();
  const needsReauth =
    status.includes("reauth") ||
    metaStatus.includes("reauth") ||
    status === "expired" ||
    metaStatus === "expired" ||
    status === "disconnected" ||
    metaStatus === "disconnected" ||
    !conn.accessToken ||
    (platform === "linkedin" &&
      Boolean(conn.scopes?.trim()) &&
      !(conn.scopes || "").toLowerCase().includes("w_member_social"));
  const connected =
    !needsReauth &&
    (["active", "connected", "ok", ""].includes(status) ||
      ["active", "connected", "ok"].includes(metaStatus));
  return {
    platform,
    connected,
    needsReauth,
    connectionId: conn.id,
    displayName: conn.displayName,
    accountEmail: conn.accountEmail,
  };
}

function socialHay(r: Row): string {
  return [
    r.provider,
    r.app_key,
    r.connection_kind,
    r.display_name,
    r.mcp_url,
  ]
    .map((v) => (v || "").toLowerCase())
    .join(" ");
}

function isSocialPlatformRow(r: Row, platform: SocialPublishPlatform): boolean {
  const hay = socialHay(r);
  if (platform === "linkedin") return hay.includes("linkedin");
  if (platform === "instagram") {
    return hay.includes("instagram") || hay.includes("ig_user");
  }
  return hay.includes("facebook") || hay.includes("meta");
}

function metadataRecord(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

function rowHasInstagramUser(r: Row): boolean {
  if (isSocialPlatformRow(r, "instagram")) return true;
  const meta = metadataRecord(r.metadata);
  if (!meta) return false;
  return Boolean(
    meta.igUserId ||
      meta.instagram_user_id ||
      meta.instagramUserId ||
      meta.ig_user_id,
  );
}

export type SocialConnectionStatus = {
  platform: SocialPublishPlatform;
  connected: boolean;
  needsReauth: boolean;
  connectionId: string | null;
  displayName: string | null;
  accountEmail: string | null;
};

/** Org-level LinkedIn / Facebook / Instagram credentials. */
export async function getSocialAppConnection(
  organizationId: string,
  platform: SocialPublishPlatform,
): Promise<SetupAppConnection | null> {
  const orgId = organizationId?.trim();
  if (!orgId) return null;

  if (platform === "facebook" || platform === "instagram") {
    const { getCrmSocialChannelConnection } = await import(
      "@/dao/account/setup-social-channel"
    );
    const fromAccountsSocial = await getCrmSocialChannelConnection(
      orgId,
      platform,
    );
    if (fromAccountsSocial) return fromAccountsSocial;
  }

  if (isOnboardingConnectorsConfigured()) {
    const keys = SOCIAL_APP_KEYS[platform];
    const hit = await fetchConnectedAppCredentialsFirst(orgId, keys);
    if (hit) return mapOnboardingCredentials(hit);
    if (platform === "instagram") {
      const fb = await fetchConnectedAppCredentialsFirst(orgId, [
        "facebook",
        "meta",
      ]);
      if (fb && onboardingRowHasInstagramUser(fb)) {
        return mapOnboardingCredentials(fb);
      }
    }
  }
  if (!shouldUseLegacySetupAppConnectionsDb()) return null;
  const rows = await listSetupAppConnectionRowsFromDb(orgId, 80);
  const hit =
    rows.find(
      (r) =>
        isSocialPlatformRow(r, platform) &&
        ["active", "connected", "ok"].includes(
          (r.status || "active").toLowerCase(),
        ),
    ) ??
    rows.find((r) => isSocialPlatformRow(r, platform)) ??
    (platform === "instagram"
      ? rows.find(
          (r) =>
            isSocialPlatformRow(r, "facebook") && rowHasInstagramUser(r),
        )
      : null) ??
    null;
  return hit ? mapRow(hit) : null;
}

function onboardingRowHasInstagramUser(
  c: OnboardingConnectedAppCredentials,
): boolean {
  const meta = c.metadata;
  if (!meta) return false;
  return Boolean(
    meta.igUserId ||
      meta.instagram_user_id ||
      meta.instagramUserId ||
      meta.ig_user_id,
  );
}

export async function listSocialPublishingStatus(
  organizationId: string,
): Promise<SocialConnectionStatus[]> {
  const orgId = organizationId?.trim();
  if (!orgId) {
    return SOCIAL_PUBLISH_PLATFORMS.map((platform) => ({
      platform,
      connected: false,
      needsReauth: false,
      connectionId: null,
      displayName: null,
      accountEmail: null,
    }));
  }
  return Promise.all(
    SOCIAL_PUBLISH_PLATFORMS.map(async (platform) => {
      const conn = await getSocialAppConnection(orgId, platform);
      return socialStatusFromConnection(platform, conn);
    }),
  );
}

export const RESEARCH_APP_PROVIDERS = [
  "apollo",
  "zoominfo",
  "lusha",
  "builtwith",
] as const;

export type ResearchAppProvider = (typeof RESEARCH_APP_PROVIDERS)[number];

const RESEARCH_APP_KEYS: Record<ResearchAppProvider, readonly string[]> = {
  apollo: ["apollo"],
  zoominfo: ["zoominfo"],
  lusha: ["lusha"],
  builtwith: ["builtwith"],
};

export type ResearchAppConnectionStatus = {
  provider: ResearchAppProvider;
  connected: boolean;
  needsReauth: boolean;
  connectionId: string | null;
  displayName: string | null;
  accountEmail: string | null;
  /** Decrypted API / access token when present — never expose to the browser. */
  apiKey: string | null;
};

function isResearchProviderRow(r: Row, provider: ResearchAppProvider): boolean {
  const hay = [r.provider, r.app_key, r.connection_kind, r.display_name]
    .map((v) => (v || "").toLowerCase())
    .join(" ");
  if (provider === "zoominfo") {
    return hay.includes("zoominfo") || hay.includes("zoom_info");
  }
  if (provider === "builtwith") {
    return hay.includes("builtwith") || hay.includes("built_with");
  }
  return hay.includes(provider);
}

/** Org research API connections (Apollo, ZoomInfo, Lusha, BuiltWith). */
export async function listResearchAppConnectionStatus(
  organizationId: string,
  options?: { includeSecrets?: boolean },
): Promise<ResearchAppConnectionStatus[]> {
  const orgId = organizationId?.trim();
  const includeSecrets = Boolean(options?.includeSecrets);
  if (!orgId) {
    return RESEARCH_APP_PROVIDERS.map((provider) => ({
      provider,
      connected: false,
      needsReauth: false,
      connectionId: null,
      displayName: null,
      accountEmail: null,
      apiKey: null,
    }));
  }
  if (isOnboardingConnectorsConfigured()) {
    const fromApi = await Promise.all(
      RESEARCH_APP_PROVIDERS.map(async (provider) => {
        const hit = await fetchConnectedAppCredentialsFirst(
          orgId,
          RESEARCH_APP_KEYS[provider],
        );
        if (!hit) {
          return {
            provider,
            connected: false,
            needsReauth: false,
            connectionId: null,
            displayName: null,
            accountEmail: null,
            apiKey: null,
          };
        }
        const conn = mapOnboardingCredentials(hit);
        const status = (conn.status || "").toLowerCase();
        const apiKey = conn.accessToken;
        const needsReauth =
          status.includes("reauth") ||
          status === "expired" ||
          status === "disconnected" ||
          !apiKey;
        const connected =
          !needsReauth &&
          ["active", "connected", "ok", ""].includes(status);
        return {
          provider,
          connected,
          needsReauth,
          connectionId: conn.id,
          displayName: conn.displayName,
          accountEmail: conn.accountEmail,
          apiKey: includeSecrets ? apiKey : null,
        };
      }),
    );
    if (!shouldUseLegacySetupAppConnectionsDb()) {
      return fromApi;
    }
    const rows = await listSetupAppConnectionRowsFromDb(orgId, 80);
    return RESEARCH_APP_PROVIDERS.map((provider) => {
      const apiRow = fromApi.find((r) => r.provider === provider);
      if (apiRow?.connected) return apiRow;
      const row = rows.find((r) => isResearchProviderRow(r, provider));
      if (!row) return apiRow ?? {
        provider,
        connected: false,
        needsReauth: false,
        connectionId: null,
        displayName: null,
        accountEmail: null,
        apiKey: null,
      };
      const status = (row.status || "").toLowerCase();
      let apiKey: string | null = null;
      if (row.access_token_encrypted) {
        try {
          apiKey = decryptAccountsSecret(row.access_token_encrypted);
        } catch {
          apiKey = null;
        }
      }
      const needsReauth =
        status.includes("reauth") ||
        status === "expired" ||
        status === "disconnected" ||
        !apiKey;
      const connected =
        !needsReauth &&
        ["active", "connected", "ok", ""].includes(status);
      return {
        provider,
        connected,
        needsReauth,
        connectionId: row.id,
        displayName: row.display_name,
        accountEmail: row.account_email,
        apiKey: includeSecrets ? apiKey : null,
      };
    });
  }
  const rows = await listSetupAppConnectionRowsFromDb(orgId, 80);
  return RESEARCH_APP_PROVIDERS.map((provider) => {
    const row = rows.find((r) => isResearchProviderRow(r, provider));
    if (!row) {
      return {
        provider,
        connected: false,
        needsReauth: false,
        connectionId: null,
        displayName: null,
        accountEmail: null,
        apiKey: null,
      };
    }
    const status = (row.status || "").toLowerCase();
    let apiKey: string | null = null;
    if (row.access_token_encrypted) {
      try {
        apiKey = decryptAccountsSecret(row.access_token_encrypted);
      } catch {
        apiKey = null;
      }
    }
    const needsReauth =
      status.includes("reauth") ||
      status === "expired" ||
      status === "disconnected" ||
      !apiKey;
    const connected =
      !needsReauth &&
      ["active", "connected", "ok", ""].includes(status);
    return {
      provider,
      connected,
      needsReauth,
      connectionId: row.id,
      displayName: row.display_name,
      accountEmail: row.account_email,
      apiKey: includeSecrets ? apiKey : null,
    };
  });
}
