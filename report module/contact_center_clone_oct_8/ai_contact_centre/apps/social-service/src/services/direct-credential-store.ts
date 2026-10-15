import { serializeEntityId } from "@ai-contact-center/event-contracts";
import { ccPrisma } from "@ai-contact-center/db-cc";

import type {
  MetaWhatsAppAppConfig,
  DirectCredentialStoreConfig,
} from "../config.js";
import {
  decryptStoredToken,
  encryptionKeyFromHex,
  StoredTokenDecryptError,
} from "../lib/ms-graph-crypto.js";
import type {
  NeedsReauthInput,
  TokenRenewalReason,
  WhatsAppRuntimeCredentials,
} from "../types/accounts-contract.js";
import { AccountsApiError } from "./accounts-client.js";
import type { WhatsAppCredentialSource } from "./credential-manager.js";

type SocialConfigRow = {
  channel_config_id: string;
  organization_id: string;
  provider: string;
  meta_connection_status: string;
  phone_number_id: string | null;
  waba_id: string | null;
  access_token_encrypted: string | null;
  token_expires_at: Date | null;
};

type MetaTokenExchangeResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; code?: number };
};

export class DirectWhatsAppCredentialStore implements WhatsAppCredentialSource {
  private readonly encryptionKey: Buffer;

  constructor(
    config: DirectCredentialStoreConfig,
    private readonly metaConfig: MetaWhatsAppAppConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.encryptionKey = encryptionKeyFromHex(config.encryptionKey);
  }

  async getByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppRuntimeCredentials> {
    const rows = await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      return db.$queryRaw<SocialConfigRow[]>`
        SELECT
          sc.channel_config_id,
          cc.organization_id,
          sc.provider,
          sc.meta_connection_status,
          sc.phone_number_id,
          sc.waba_id,
          sc.access_token_encrypted,
          sc.token_expires_at
        FROM accounts.setup_social_configs sc
        INNER JOIN accounts.setup_channel_configs cc
          ON cc.id = sc.channel_config_id
        WHERE sc.phone_number_id = ${phoneNumberId}
          AND sc.provider = 'whatsapp'
        LIMIT 2
      `;
    });
    if (rows.length > 1) {
      throw new AccountsApiError(
        "ambiguous_configuration",
        "Multiple WhatsApp configurations use this phone number ID",
        409,
        false,
      );
    }
    return this.toRuntimeCredentials(rows[0]);
  }

  async getByChannelConfigId(
    channelConfigId: string,
  ): Promise<WhatsAppRuntimeCredentials> {
    const rows = await ccPrisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
      return db.$queryRaw<SocialConfigRow[]>`
        SELECT
          sc.channel_config_id,
          cc.organization_id,
          sc.provider,
          sc.meta_connection_status,
          sc.phone_number_id,
          sc.waba_id,
          sc.access_token_encrypted,
          sc.token_expires_at
        FROM accounts.setup_social_configs sc
        INNER JOIN accounts.setup_channel_configs cc
          ON cc.id = sc.channel_config_id
        WHERE sc.channel_config_id = ${channelConfigId}::bigint
          AND sc.provider = 'whatsapp'
        LIMIT 1
      `;
    });
    return this.toRuntimeCredentials(rows[0]);
  }

  async renew(
    channelConfigId: string,
    _reason: TokenRenewalReason,
  ): Promise<WhatsAppRuntimeCredentials> {
    const current = await this.getByChannelConfigId(channelConfigId);
    if (
      current.tokenExpiresAt &&
      Date.parse(current.tokenExpiresAt) <= Date.now()
    ) {
      await this.markNeedsReauth(channelConfigId, {
        reason: "meta_oauth_error",
        providerErrorCode: 190,
      });
      throw this.needsReauth();
    }
    if (!this.metaConfig.appId || !this.metaConfig.appSecret) {
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
    url.searchParams.set("client_id", this.metaConfig.appId);
    url.searchParams.set("client_secret", this.metaConfig.appSecret);
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
        throw this.needsReauth();
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
      provider: "whatsapp",
      connectionStatus: "connected",
      phoneNumberId: current.phoneNumberId,
      wabaId: current.wabaId,
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
  ): WhatsAppRuntimeCredentials {
    if (!row) {
      throw new AccountsApiError(
        "configuration_not_found",
        "WhatsApp configuration not found",
        404,
        false,
      );
    }
    if (row.meta_connection_status !== "connected") throw this.needsReauth();
    if (!row.phone_number_id || !row.access_token_encrypted) {
      throw new AccountsApiError(
        "invalid_configuration",
        "WhatsApp configuration is missing its phone number or access token",
        422,
        false,
      );
    }

    return {
      channelConfigId: serializeEntityId(row.channel_config_id),
      organizationId: serializeEntityId(row.organization_id),
      provider: "whatsapp",
      connectionStatus: "connected",
      phoneNumberId: row.phone_number_id,
      wabaId: row.waba_id,
      accessToken: this.decrypt(row.access_token_encrypted),
      tokenExpiresAt: row.token_expires_at?.toISOString() ?? null,
    };
  }

  private decrypt(value: string): string {
    try {
      return decryptStoredToken(value, this.encryptionKey);
    } catch (error) {
      const decryptCode =
        error instanceof StoredTokenDecryptError ? error.code : "unknown";
      throw new AccountsApiError(
        "token_decryption_failed",
        "Stored WhatsApp access token could not be decrypted with MS_TOKEN_ENCRYPTION_KEY",
        500,
        false,
        { decryptCode },
      );
    }
  }

  private needsReauth(): AccountsApiError {
    return new AccountsApiError(
      "needs_reauth",
      "The WhatsApp connection must be reconnected",
      422,
      false,
    );
  }
}

export {
  decryptStoredToken,
  encryptStoredToken,
  StoredTokenDecryptError,
} from "../lib/ms-graph-crypto.js";
