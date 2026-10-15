import { ccPrisma } from "@ai-contact-center/db-cc";
import { serializeEntityIdOptional } from "@ai-contact-center/event-contracts/id-schema";

import type { ChatServiceConfig } from "../config.js";
import {
  decryptStoredToken,
  encryptStoredToken,
  encryptionKeyFromHex,
} from "../lib/ms-graph-crypto.js";

/** Setup channel product id for CCaaS Gmail ingest/watch (see knowledge/setup/channels-email.md). */
export const CCAAS_EMAIL_PRODUCT_ID = "contact-center";

export type GmailRuntimeCredentials = {
  /** setup_channel_configs.id — canonical mailbox identity for cc-core policy and ingest */
  connectionId: string;
  oauthConnectionId: string;
  organizationId: string;
  accountEmail: string;
  ccaasHandler: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date | null;
};

export function mapEmailChannelRow(
  row: EmailChannelRow,
  encryptionKey: Buffer,
): GmailRuntimeCredentials {
  if (!row.access_token_encrypted || !row.refresh_token_encrypted || !row.account_email) {
    throw new Error("Email channel is missing encrypted tokens or account email");
  }

  return {
    connectionId: serializeEntityIdOptional(row.channel_config_id)!,
    oauthConnectionId: serializeEntityIdOptional(row.oauth_connection_id)!,
    organizationId: serializeEntityIdOptional(row.organization_id)!,
    accountEmail: row.account_email,
    ccaasHandler: row.ccaas_handler,
    accessToken: decryptStoredToken(row.access_token_encrypted, encryptionKey),
    refreshToken: decryptStoredToken(row.refresh_token_encrypted, encryptionKey),
    tokenExpiresAt: row.expires_at,
  };
}

export type EmailChannelRow = {
  channel_config_id: string;
  organization_id: string;
  oauth_connection_id: string;
  ccaas_handler: string | null;
  account_email: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  expires_at: Date | null;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};


export class GmailCredentialStore {
  private readonly encryptionKey: Buffer;
  private readonly cache = new Map<string, GmailRuntimeCredentials>();

  constructor(private readonly config: ChatServiceConfig) {
    if (!config.tokenEncryptionKey) {
      throw new Error("MS_TOKEN_ENCRYPTION_KEY is required for Gmail credential store");
    }
    this.encryptionKey = encryptionKeyFromHex(config.tokenEncryptionKey);
  }

  async listConnected(): Promise<GmailRuntimeCredentials[]> {
    const rows = await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      return db.$queryRaw<EmailChannelRow[]>`
        SELECT
          cc.id AS channel_config_id,
          cc.organization_id,
          ec.oauth_connection_id,
          ec.ccaas_handler,
          COALESCE(NULLIF(trim(ec.sender_email), ''), oauth.account_email) AS account_email,
          oauth.access_token_encrypted,
          oauth.refresh_token_encrypted,
          oauth.expires_at
        FROM accounts.setup_channel_configs cc
        INNER JOIN accounts.setup_email_configs ec
          ON ec.channel_config_id = cc.id
        INNER JOIN accounts.mail_oauth_connections oauth
          ON oauth.id = ec.oauth_connection_id
        WHERE cc.channel_type = 'email'
          AND cc.status = 'active'
          AND cc.product_ids @> '["contact-center"]'::jsonb
          AND ec.third_party_mode = 'oauth'
          AND ec.oauth_provider = 'google'
          AND oauth.needs_reauth = false
          AND oauth.account_email IS NOT NULL
      `;
    });

    const credentials: GmailRuntimeCredentials[] = [];
    for (const row of rows) {
      try {
        credentials.push(this.toRuntimeCredentials(row));
      } catch {
        // Skip rows that cannot be decrypted.
      }
    }
    return credentials;
  }

  async getByAccountEmail(accountEmail: string): Promise<GmailRuntimeCredentials | null> {
    const normalized = accountEmail.trim().toLowerCase();
    const cached = [...this.cache.values()].find(
      (item) => item.accountEmail.toLowerCase() === normalized,
    );
    if (cached) return this.ensureFreshToken(cached);

    const rows = await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      return db.$queryRaw<EmailChannelRow[]>`
        SELECT
          cc.id AS channel_config_id,
          cc.organization_id,
          ec.oauth_connection_id,
          ec.ccaas_handler,
          COALESCE(NULLIF(trim(ec.sender_email), ''), oauth.account_email) AS account_email,
          oauth.access_token_encrypted,
          oauth.refresh_token_encrypted,
          oauth.expires_at
        FROM accounts.setup_channel_configs cc
        INNER JOIN accounts.setup_email_configs ec
          ON ec.channel_config_id = cc.id
        INNER JOIN accounts.mail_oauth_connections oauth
          ON oauth.id = ec.oauth_connection_id
        WHERE cc.channel_type = 'email'
          AND cc.status = 'active'
          AND cc.product_ids @> '["contact-center"]'::jsonb
          AND ec.third_party_mode = 'oauth'
          AND ec.oauth_provider = 'google'
          AND oauth.needs_reauth = false
          AND oauth.account_email IS NOT NULL
          AND (
            lower(oauth.account_email) = lower(${accountEmail})
            OR lower(COALESCE(ec.sender_email, '')) = lower(${accountEmail})
          )
        ORDER BY cc.updated_at DESC
        LIMIT 1
      `;
    });

    if (rows.length === 0) return null;
    const runtime = this.toRuntimeCredentials(rows[0]!);
    this.cacheRuntime(runtime);
    return this.ensureFreshToken(runtime);
  }

  async getByOrganizationId(organizationId: string): Promise<GmailRuntimeCredentials | null> {
    const cached = this.cache.get(`org:${organizationId}`);
    if (cached) return this.ensureFreshToken(cached);

    const rows = await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      return db.$queryRaw<EmailChannelRow[]>`
        SELECT
          cc.id AS channel_config_id,
          cc.organization_id,
          ec.oauth_connection_id,
          ec.ccaas_handler,
          COALESCE(NULLIF(trim(ec.sender_email), ''), oauth.account_email) AS account_email,
          oauth.access_token_encrypted,
          oauth.refresh_token_encrypted,
          oauth.expires_at
        FROM accounts.setup_channel_configs cc
        INNER JOIN accounts.setup_email_configs ec
          ON ec.channel_config_id = cc.id
        INNER JOIN accounts.mail_oauth_connections oauth
          ON oauth.id = ec.oauth_connection_id
        WHERE cc.channel_type = 'email'
          AND cc.status = 'active'
          AND cc.product_ids @> '["contact-center"]'::jsonb
          AND ec.third_party_mode = 'oauth'
          AND ec.oauth_provider = 'google'
          AND oauth.needs_reauth = false
          AND oauth.account_email IS NOT NULL
          AND cc.organization_id = ${organizationId}::bigint
        LIMIT 2
      `;
    });

    if (rows.length !== 1) return null;
    const runtime = this.toRuntimeCredentials(rows[0]!);
    this.cacheRuntime(runtime);
    return this.ensureFreshToken(runtime);
  }

  async getByConnectionId(connectionId: string): Promise<GmailRuntimeCredentials | null> {
    const cached = this.cache.get(connectionId);
    if (cached) return this.ensureFreshToken(cached);

    const rows = await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      return db.$queryRaw<EmailChannelRow[]>`
        SELECT
          cc.id AS channel_config_id,
          cc.organization_id,
          ec.oauth_connection_id,
          ec.ccaas_handler,
          COALESCE(NULLIF(trim(ec.sender_email), ''), oauth.account_email) AS account_email,
          oauth.access_token_encrypted,
          oauth.refresh_token_encrypted,
          oauth.expires_at
        FROM accounts.setup_channel_configs cc
        INNER JOIN accounts.setup_email_configs ec
          ON ec.channel_config_id = cc.id
        INNER JOIN accounts.mail_oauth_connections oauth
          ON oauth.id = ec.oauth_connection_id
        WHERE cc.id = ${connectionId}::bigint
          AND cc.channel_type = 'email'
          AND cc.status = 'active'
          AND ec.third_party_mode = 'oauth'
          AND ec.oauth_provider = 'google'
          AND oauth.needs_reauth = false
          AND oauth.account_email IS NOT NULL
        LIMIT 1
      `;
    });

    if (!rows[0]) return null;
    const runtime = this.toRuntimeCredentials(rows[0]);
    this.cacheRuntime(runtime);
    return this.ensureFreshToken(runtime);
  }

  private cacheRuntime(runtime: GmailRuntimeCredentials): void {
    this.cache.set(runtime.connectionId, runtime);
    this.cache.set(`org:${runtime.organizationId}`, runtime);
    this.cache.set(runtime.accountEmail.toLowerCase(), runtime);
  }

  private toRuntimeCredentials(row: EmailChannelRow): GmailRuntimeCredentials {
    return mapEmailChannelRow(row, this.encryptionKey);
  }

  private async ensureFreshToken(
    credentials: GmailRuntimeCredentials,
  ): Promise<GmailRuntimeCredentials> {
    const expiresAt = credentials.tokenExpiresAt?.getTime() ?? 0;
    if (expiresAt - Date.now() > 60_000) {
      return credentials;
    }
    if (!this.config.gmailOAuth) {
      return credentials;
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.gmailOAuth.clientId,
        client_secret: this.config.gmailOAuth.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const body = (await response.json()) as GoogleTokenResponse;
    if (!response.ok || !body.access_token) {
      throw new Error(body.error_description ?? body.error ?? "Failed to refresh Gmail token");
    }

    const refreshed: GmailRuntimeCredentials = {
      ...credentials,
      accessToken: body.access_token,
      tokenExpiresAt: body.expires_in
        ? new Date(Date.now() + body.expires_in * 1000)
        : new Date(Date.now() + 3_600_000),
    };

    await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      await db.$executeRaw`
        UPDATE accounts.mail_oauth_connections
        SET
          access_token_encrypted = ${encryptStoredToken(refreshed.accessToken, this.encryptionKey)},
          expires_at = ${refreshed.tokenExpiresAt},
          updated_at = NOW()
        WHERE id = ${credentials.oauthConnectionId}::bigint
      `;
    });

    this.cacheRuntime(refreshed);
    return refreshed;
  }
}
