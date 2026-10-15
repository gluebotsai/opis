import { ccPrisma } from "@ai-contact-center/db-cc";
import { serializeEntityId } from "@ai-contact-center/event-contracts";

import type {
  DirectCredentialStoreConfig,
  MetaMessengerAppConfig,
} from "../config.js";
import {
  decryptStoredToken,
  encryptionKeyFromHex,
  StoredTokenDecryptError,
} from "../lib/ms-graph-crypto.js";
import type {
  MessengerRuntimeCredentials,
  NeedsReauthInput,
  TokenRenewalReason,
} from "../types/accounts-contract.js";
import { AccountsApiError } from "./accounts-client.js";
import type { MessengerCredentialSource } from "./messenger-credential-manager.js";

type SocialConfigRow = {
  channel_config_id: string;
  organization_id: string;
  provider: string;
  meta_connection_status: string;
  page_id: string | null;
  ig_business_account_id: string | null;
  ig_login_user_id: string | null;
  ig_login_scoped_id: string | null;
  ig_webhook_account_id: string | null;
  meta_auth_type: string | null;
  meta_app_id: string | null;
  granted_scopes: unknown;
  access_token_encrypted: string | null;
  token_expires_at: Date | null;
};

type MetaTokenExchangeResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; code?: number };
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export class DirectMessengerCredentialStore implements MessengerCredentialSource {
  private readonly encryptionKey: Buffer;

  constructor(
    config: DirectCredentialStoreConfig,
    private readonly metaConfig: MetaMessengerAppConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.encryptionKey = encryptionKeyFromHex(config.encryptionKey);
  }

  async getByPageId(
    pageId: string,
    provider: "facebook" | "instagram" = "facebook",
  ): Promise<MessengerRuntimeCredentials> {
    const rows = await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      return db.$queryRaw<SocialConfigRow[]>`
        SELECT
          sc.channel_config_id,
          cc.organization_id,
          sc.provider,
          sc.meta_connection_status,
          sc.page_id,
          sc.ig_business_account_id,
          sc.ig_login_user_id,
          sc.ig_login_scoped_id,
          sc.ig_webhook_account_id,
          sc.meta_auth_type,
          sc.meta_app_id,
          sc.granted_scopes,
          sc.access_token_encrypted,
          sc.token_expires_at
        FROM accounts.setup_social_configs sc
        INNER JOIN accounts.setup_channel_configs cc
          ON cc.id = sc.channel_config_id
        WHERE sc.page_id = ${pageId}
          AND sc.provider = ${provider}
        LIMIT 2
      `;
    });
    if (rows.length > 1) {
      throw new AccountsApiError(
        "ambiguous_configuration",
        `Multiple ${provider} configurations use this page ID`,
        409,
        false,
      );
    }
    return this.toRuntimeCredentials(rows[0], provider);
  }

  async getByIgBusinessAccountId(
    igBusinessAccountId: string,
  ): Promise<MessengerRuntimeCredentials> {
    const rows = await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      return db.$queryRaw<SocialConfigRow[]>`
        SELECT
          sc.channel_config_id,
          cc.organization_id,
          sc.provider,
          sc.meta_connection_status,
          sc.page_id,
          sc.ig_business_account_id,
          sc.ig_login_user_id,
          sc.ig_login_scoped_id,
          sc.ig_webhook_account_id,
          sc.meta_auth_type,
          sc.meta_app_id,
          sc.granted_scopes,
          sc.access_token_encrypted,
          sc.token_expires_at
        FROM accounts.setup_social_configs sc
        INNER JOIN accounts.setup_channel_configs cc
          ON cc.id = sc.channel_config_id
        WHERE sc.ig_business_account_id = ${igBusinessAccountId}
          AND sc.provider = 'instagram'
        LIMIT 2
      `;
    });
    if (rows.length > 1) {
      throw new AccountsApiError(
        "ambiguous_configuration",
        "Multiple Instagram configurations use this business account ID",
        409,
        false,
      );
    }
    return this.toRuntimeCredentials(rows[0], "instagram");
  }

  async getByInstagramWebhookAccountId(
    webhookAccountId: string,
  ): Promise<MessengerRuntimeCredentials> {
    const rows = await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      return db.$queryRaw<SocialConfigRow[]>`
        SELECT
          sc.channel_config_id,
          cc.organization_id,
          sc.provider,
          sc.meta_connection_status,
          sc.page_id,
          sc.ig_business_account_id,
          sc.ig_login_user_id,
          sc.ig_login_scoped_id,
          sc.ig_webhook_account_id,
          sc.meta_auth_type,
          sc.meta_app_id,
          sc.granted_scopes,
          sc.access_token_encrypted,
          sc.token_expires_at
        FROM accounts.setup_social_configs sc
        INNER JOIN accounts.setup_channel_configs cc
          ON cc.id = sc.channel_config_id
        WHERE sc.ig_webhook_account_id = ${webhookAccountId}
          AND sc.provider = 'instagram'
        LIMIT 2
      `;
    });
    if (rows.length > 1) {
      throw new AccountsApiError(
        "ambiguous_configuration",
        "Multiple Instagram configurations use this webhook account ID",
        409,
        false,
      );
    }
    return this.toRuntimeCredentials(rows[0], "instagram");
  }

  /**
   * List connected Instagram configs so webhook entry.id can be matched against
   * Instagram Login /me identity fields when My Account stored a different IG id.
   */
  async listConnectedInstagram(limit = 25): Promise<MessengerRuntimeCredentials[]> {
    const rows = await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      return db.$queryRaw<SocialConfigRow[]>`
        SELECT
          sc.channel_config_id,
          cc.organization_id,
          sc.provider,
          sc.meta_connection_status,
          sc.page_id,
          sc.ig_business_account_id,
          sc.ig_login_user_id,
          sc.ig_login_scoped_id,
          sc.ig_webhook_account_id,
          sc.meta_auth_type,
          sc.meta_app_id,
          sc.granted_scopes,
          sc.access_token_encrypted,
          sc.token_expires_at
        FROM accounts.setup_social_configs sc
        INNER JOIN accounts.setup_channel_configs cc
          ON cc.id = sc.channel_config_id
        WHERE sc.provider = 'instagram'
          AND sc.meta_connection_status = 'connected'
        ORDER BY sc.updated_at DESC
        LIMIT ${limit}
      `;
    });
    return rows
      .map((row) => {
        try {
          return this.toRuntimeCredentials(row, "instagram");
        } catch {
          return null;
        }
      })
      .filter((row): row is MessengerRuntimeCredentials => row !== null);
  }

  /**
   * Persist the webhook-facing id without overwriting Graph's business account id.
   */
  async bindInstagramWebhookEntryId(
    channelConfigId: string,
    webhookEntryId: string,
  ): Promise<void> {
    await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      await db.$executeRaw`
        UPDATE accounts.setup_social_configs
        SET ig_webhook_account_id = ${webhookEntryId}, updated_at = NOW()
        WHERE channel_config_id = ${channelConfigId}::bigint
          AND provider = 'instagram'
          AND ig_webhook_account_id IS DISTINCT FROM ${webhookEntryId}
      `;
    });
  }

  async getByChannelConfigId(
    channelConfigId: string,
    provider: "facebook" | "instagram",
  ): Promise<MessengerRuntimeCredentials> {
    const rows = await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      return db.$queryRaw<SocialConfigRow[]>`
        SELECT
          sc.channel_config_id,
          cc.organization_id,
          sc.provider,
          sc.meta_connection_status,
          sc.page_id,
          sc.ig_business_account_id,
          sc.ig_login_user_id,
          sc.ig_login_scoped_id,
          sc.ig_webhook_account_id,
          sc.meta_auth_type,
          sc.meta_app_id,
          sc.granted_scopes,
          sc.access_token_encrypted,
          sc.token_expires_at
        FROM accounts.setup_social_configs sc
        INNER JOIN accounts.setup_channel_configs cc
          ON cc.id = sc.channel_config_id
        WHERE sc.channel_config_id = ${channelConfigId}::bigint
          AND sc.provider = ${provider}
        LIMIT 1
      `;
    });
    return this.toRuntimeCredentials(rows[0], provider);
  }

  async renew(
    channelConfigId: string,
    provider: "facebook" | "instagram",
    _reason: TokenRenewalReason,
  ): Promise<MessengerRuntimeCredentials> {
    const current = await this.getByChannelConfigId(channelConfigId, provider);
    if (
      current.tokenExpiresAt &&
      Date.parse(current.tokenExpiresAt) <= Date.now()
    ) {
      await this.markNeedsReauth(channelConfigId, {
        reason: "meta_oauth_error",
        providerErrorCode: 190,
      });
      throw this.needsReauth(provider);
    }

    // Instagram Login long-lived tokens use graph.instagram.com refresh, not fb_exchange_token.
    if (
      provider === "instagram" &&
      (current.authType === "instagram_login" ||
        (!current.authType && current.accessToken.startsWith("IGAA")))
    ) {
      const url = new URL(
        `https://graph.instagram.com/${this.metaConfig.graphApiVersion}/refresh_access_token`,
      );
      url.searchParams.set("grant_type", "ig_refresh_token");
      url.searchParams.set("access_token", current.accessToken);
      const response = await this.fetcher(url, {
        headers: { Accept: "application/json" },
      });
      const body = (await response.json().catch(() => null)) as
        | MetaTokenExchangeResponse
        | null;
      if (!response.ok || !body?.access_token) {
        if (body?.error?.code === 190 || response.status === 401) {
          await this.markNeedsReauth(channelConfigId, {
            reason: "meta_oauth_error",
            providerErrorCode: body?.error?.code ?? 190,
          });
          throw this.needsReauth(provider);
        }
        throw new AccountsApiError(
          "token_renewal_failed",
          body?.error?.message ?? "Instagram token renewal failed",
          502,
          response.status >= 500 || response.status === 429,
        );
      }
      const expiresAt = body.expires_in
        ? new Date(Date.now() + body.expires_in * 1_000)
        : null;
      return {
        channelConfigId: current.channelConfigId,
        organizationId: current.organizationId,
        provider,
        connectionStatus: "connected",
        pageId: current.pageId,
        igBusinessAccountId: current.igBusinessAccountId,
        igWebhookAccountId: current.igWebhookAccountId,
        instagramLoginUserId: current.instagramLoginUserId,
        instagramLoginScopedId: current.instagramLoginScopedId,
        authType: current.authType,
        metaAppId: current.metaAppId,
        grantedScopes: current.grantedScopes,
        accessToken: body.access_token,
        tokenExpiresAt: expiresAt?.toISOString() ?? null,
      };
    }

    const appId =
      provider === "instagram"
        ? (this.metaConfig.instagramAppId ?? this.metaConfig.appId)
        : this.metaConfig.appId;
    const appSecret =
      provider === "instagram"
        ? (this.metaConfig.instagramAppSecret ?? this.metaConfig.appSecret)
        : this.metaConfig.appSecret;
    if (!appId || !appSecret) {
      throw new AccountsApiError(
        "token_renewal_unavailable",
        "Meta app ID and app secret are required to renew access tokens",
        503,
        false,
      );
    }

    const url = new URL(
      `https://graph.facebook.com/${this.metaConfig.graphApiVersion}/oauth/access_token`,
    );
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("client_secret", appSecret);
    url.searchParams.set("fb_exchange_token", current.accessToken);

    const response = await this.fetcher(url, {
      headers: { Accept: "application/json" },
    });
    const body = (await response.json().catch(() => null)) as
      | MetaTokenExchangeResponse
      | null;
    if (!response.ok || !body?.access_token) {
      if (body?.error?.code === 190 || response.status === 401) {
        await this.markNeedsReauth(channelConfigId, {
          reason: "meta_oauth_error",
          providerErrorCode: body?.error?.code ?? 190,
        });
        throw this.needsReauth(provider);
      }
      throw new AccountsApiError(
        "token_renewal_failed",
        body?.error?.message ?? "Meta token renewal failed",
        502,
        response.status >= 500 || response.status === 429,
      );
    }

    const expiresAt = body.expires_in
      ? new Date(Date.now() + body.expires_in * 1_000)
      : null;

    return {
      channelConfigId: current.channelConfigId,
      organizationId: current.organizationId,
      provider,
      connectionStatus: "connected",
      pageId: current.pageId,
      igBusinessAccountId: current.igBusinessAccountId,
      igWebhookAccountId: current.igWebhookAccountId,
      instagramLoginUserId: current.instagramLoginUserId,
      instagramLoginScopedId: current.instagramLoginScopedId,
      authType: current.authType,
      metaAppId: current.metaAppId,
      grantedScopes: current.grantedScopes,
      accessToken: body.access_token,
      tokenExpiresAt: expiresAt?.toISOString() ?? null,
    };
  }

  async markNeedsReauth(
    channelConfigId: string,
    _input: NeedsReauthInput,
  ): Promise<void> {
    await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      await db.$executeRaw`
        UPDATE accounts.setup_social_configs
        SET meta_connection_status = 'needs_reauth', updated_at = NOW()
        WHERE channel_config_id = ${channelConfigId}::bigint
          AND meta_connection_status = 'connected'
      `;
    });
  }

  private toRuntimeCredentials(
    row: SocialConfigRow | undefined,
    expectedProvider: "facebook" | "instagram",
  ): MessengerRuntimeCredentials {
    if (!row) {
      throw new AccountsApiError(
        "configuration_not_found",
        `${expectedProvider} configuration not found`,
        404,
        false,
      );
    }
    if (row.meta_connection_status !== "connected") {
      throw this.needsReauth(expectedProvider);
    }
    if (!row.access_token_encrypted) {
      throw new AccountsApiError(
        "invalid_configuration",
        `${expectedProvider} configuration is missing its access token`,
        422,
        false,
      );
    }
    const authType =
      row.meta_auth_type === "instagram_login" ||
      row.meta_auth_type === "facebook_page"
        ? row.meta_auth_type
        : null;
    const grantedScopes = stringArray(row.granted_scopes);
    if (
      expectedProvider === "instagram" &&
      row.meta_app_id &&
      this.metaConfig.instagramAppId &&
      row.meta_app_id !== this.metaConfig.instagramAppId
    ) {
      throw new AccountsApiError(
        "invalid_configuration",
        "Instagram OAuth token belongs to a different Meta app than the webhook",
        422,
        false,
      );
    }
    if (
      expectedProvider === "instagram" &&
      authType === "facebook_page" &&
      grantedScopes.length > 0 &&
      !grantedScopes.includes("instagram_manage_messages")
    ) {
      throw new AccountsApiError(
        "missing_messaging_permission",
        "Instagram Page token is missing instagram_manage_messages",
        422,
        false,
      );
    }
    if (
      expectedProvider === "instagram" &&
      authType === "instagram_login" &&
      grantedScopes.length > 0 &&
      !grantedScopes.includes("instagram_business_manage_messages")
    ) {
      throw new AccountsApiError(
        "missing_messaging_permission",
        "Instagram Login token is missing instagram_business_manage_messages",
        422,
        false,
      );
    }
    // Facebook always needs page_id. Instagram Login may still store page_id for
    // Page-linked accounts; if absent, fall back to ig_business_account_id so
    // runtime credentials remain usable for graph.instagram.com/me/messages.
    if (
      (expectedProvider === "facebook" ||
        (expectedProvider === "instagram" && authType === "facebook_page")) &&
      !row.page_id
    ) {
      throw new AccountsApiError(
        "invalid_configuration",
        "facebook configuration is missing its page ID",
        422,
        false,
      );
    }
    if (expectedProvider === "instagram" && !row.ig_business_account_id && !row.page_id) {
      throw new AccountsApiError(
        "invalid_configuration",
        "Instagram configuration is missing ig_business_account_id and page_id",
        422,
        false,
      );
    }

    return {
      channelConfigId: serializeEntityId(row.channel_config_id),
      organizationId: serializeEntityId(row.organization_id),
      provider: expectedProvider,
      connectionStatus: "connected",
      pageId: row.page_id ?? row.ig_business_account_id ?? "",
      igBusinessAccountId: row.ig_business_account_id,
      igWebhookAccountId: row.ig_webhook_account_id,
      instagramLoginUserId: row.ig_login_user_id,
      instagramLoginScopedId: row.ig_login_scoped_id,
      authType,
      metaAppId: row.meta_app_id,
      grantedScopes,
      accessToken: this.decrypt(row.access_token_encrypted, expectedProvider),
      tokenExpiresAt: row.token_expires_at?.toISOString() ?? null,
    };
  }

  private decrypt(value: string, provider: "facebook" | "instagram"): string {
    try {
      return decryptStoredToken(value, this.encryptionKey);
    } catch (error) {
      const decryptCode =
        error instanceof StoredTokenDecryptError ? error.code : "unknown";
      throw new AccountsApiError(
        "token_decryption_failed",
        `Stored ${provider} access token could not be decrypted with MS_TOKEN_ENCRYPTION_KEY`,
        500,
        false,
        { decryptCode },
      );
    }
  }

  private needsReauth(provider: "facebook" | "instagram"): AccountsApiError {
    return new AccountsApiError(
      "needs_reauth",
      `The ${provider} connection must be reconnected`,
      422,
      false,
    );
  }
}
