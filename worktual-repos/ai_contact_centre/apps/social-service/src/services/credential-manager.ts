import type { Logger } from "pino";

import type { AccountsApiConfig } from "../config.js";
import { isMetaOAuthError } from "../providers/meta-whatsapp.js";
import type { WhatsAppRuntimeCredentials } from "../types/accounts-contract.js";
import { AccountsApiError } from "./accounts-client.js";

export type WhatsAppCredentialSource = {
  getByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppRuntimeCredentials>;
  getByChannelConfigId(channelConfigId: string): Promise<WhatsAppRuntimeCredentials>;
  renew(
    channelConfigId: string,
    reason: "expiring_soon" | "provider_auth_failure",
  ): Promise<WhatsAppRuntimeCredentials>;
  markNeedsReauth(
    channelConfigId: string,
    input: { reason: "meta_oauth_error"; providerErrorCode: number },
  ): Promise<void>;
};

type CachedCredentials = {
  credentials: WhatsAppRuntimeCredentials;
  cachedUntil: number;
};

export class WhatsAppCredentialManager {
  private readonly byChannel = new Map<string, CachedCredentials>();
  private readonly channelByPhone = new Map<string, string>();
  private readonly renewals = new Map<string, Promise<WhatsAppRuntimeCredentials>>();

  constructor(
    private readonly accounts: WhatsAppCredentialSource,
    private readonly config: Pick<
      AccountsApiConfig,
      "renewalWindowMs" | "credentialCacheTtlMs"
    >,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  async getByChannelConfigId(channelConfigId: string): Promise<WhatsAppRuntimeCredentials> {
    const cached = this.readCached(channelConfigId);
    const credentials =
      cached ?? (await this.accounts.getByChannelConfigId(channelConfigId));
    return this.prepare(credentials);
  }

  async getByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppRuntimeCredentials> {
    const channelConfigId = this.channelByPhone.get(phoneNumberId);
    if (channelConfigId) {
      const cached = this.readCached(channelConfigId);
      if (cached) return this.prepare(cached);
    }

    const credentials = await this.accounts.getByPhoneNumberId(phoneNumberId);
    return this.prepare(credentials);
  }

  async executeByChannel<T>(
    channelConfigId: string,
    operation: (credentials: WhatsAppRuntimeCredentials) => Promise<T>,
  ): Promise<T> {
    const credentials = await this.getByChannelConfigId(channelConfigId);
    return this.executeWithRetry(credentials, operation);
  }

  async executeByPhoneNumber<T>(
    phoneNumberId: string,
    operation: (credentials: WhatsAppRuntimeCredentials) => Promise<T>,
  ): Promise<T> {
    const credentials = await this.getByPhoneNumberId(phoneNumberId);
    return this.executeWithRetry(credentials, operation);
  }

  evict(channelConfigId: string): void {
    const cached = this.byChannel.get(channelConfigId);
    if (cached) this.channelByPhone.delete(cached.credentials.phoneNumberId);
    this.byChannel.delete(channelConfigId);
  }

  private async prepare(
    credentials: WhatsAppRuntimeCredentials,
  ): Promise<WhatsAppRuntimeCredentials> {
    if (this.isExpiringSoon(credentials)) {
      return this.renew(credentials.channelConfigId, "expiring_soon");
    }
    this.cache(credentials);
    return credentials;
  }

  private async executeWithRetry<T>(
    credentials: WhatsAppRuntimeCredentials,
    operation: (credentials: WhatsAppRuntimeCredentials) => Promise<T>,
  ): Promise<T> {
    try {
      return await operation(credentials);
    } catch (error) {
      if (!isMetaOAuthError(error)) throw error;

      this.evict(credentials.channelConfigId);
      this.logger.warn(
        {
          channelConfigId: credentials.channelConfigId,
          providerCode: error.providerCode,
        },
        "meta access token rejected; attempting one renewal",
      );

      let renewed: WhatsAppRuntimeCredentials;
      try {
        renewed = await this.renew(
          credentials.channelConfigId,
          "provider_auth_failure",
        );
      } catch (renewError) {
        if (
          renewError instanceof AccountsApiError &&
          renewError.code === "needs_reauth"
        ) {
          throw renewError;
        }
        throw renewError;
      }

      try {
        return await operation(renewed);
      } catch (retryError) {
        if (!isMetaOAuthError(retryError)) throw retryError;

        this.evict(credentials.channelConfigId);
        try {
          await this.accounts.markNeedsReauth(credentials.channelConfigId, {
            reason: "meta_oauth_error",
            providerErrorCode: retryError.providerCode ?? 190,
          });
        } catch (markError) {
          this.logger.error(
            { err: markError, channelConfigId: credentials.channelConfigId },
            "failed to mark whatsapp connection as needing reauthentication",
          );
        }
        throw new AccountsApiError(
          "needs_reauth",
          "The WhatsApp connection must be reconnected",
          422,
          false,
        );
      }
    }
  }

  private renew(
    channelConfigId: string,
    reason: "expiring_soon" | "provider_auth_failure",
  ): Promise<WhatsAppRuntimeCredentials> {
    const existing = this.renewals.get(channelConfigId);
    if (existing) return existing;

    const renewal = this.accounts
      .renew(channelConfigId, reason)
      .then((credentials) => {
        this.cache(credentials);
        return credentials;
      })
      .finally(() => {
        this.renewals.delete(channelConfigId);
      });
    this.renewals.set(channelConfigId, renewal);
    return renewal;
  }

  private isExpiringSoon(credentials: WhatsAppRuntimeCredentials): boolean {
    if (!credentials.tokenExpiresAt) return false;
    const expiresAt = Date.parse(credentials.tokenExpiresAt);
    return !Number.isFinite(expiresAt) ||
      expiresAt - this.now() <= this.config.renewalWindowMs;
  }

  private cache(credentials: WhatsAppRuntimeCredentials): void {
    const expiresAt = credentials.tokenExpiresAt
      ? Date.parse(credentials.tokenExpiresAt)
      : Number.POSITIVE_INFINITY;
    const safeExpiry = Number.isFinite(expiresAt)
      ? Math.max(this.now(), expiresAt - this.config.renewalWindowMs)
      : Number.POSITIVE_INFINITY;
    const cachedUntil = Math.min(
      this.now() + this.config.credentialCacheTtlMs,
      safeExpiry,
    );
    this.byChannel.set(credentials.channelConfigId, {
      credentials,
      cachedUntil,
    });
    this.channelByPhone.set(
      credentials.phoneNumberId,
      credentials.channelConfigId,
    );
  }

  private readCached(channelConfigId: string): WhatsAppRuntimeCredentials | null {
    const cached = this.byChannel.get(channelConfigId);
    if (!cached) return null;
    if (cached.cachedUntil <= this.now()) {
      this.evict(channelConfigId);
      return null;
    }
    return cached.credentials;
  }
}
