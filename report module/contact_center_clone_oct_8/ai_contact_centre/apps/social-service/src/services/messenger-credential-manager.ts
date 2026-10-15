import type { Logger } from "pino";

import type { AccountsApiConfig } from "../config.js";
import { isMetaOAuthError } from "../providers/meta-whatsapp.js";
import type {
  MessengerRuntimeCredentials,
  TokenRenewalReason,
} from "../types/accounts-contract.js";
import { AccountsApiError } from "./accounts-client.js";

export type MessengerCredentialSource = {
  getByPageId(
    pageId: string,
    provider?: "facebook" | "instagram",
  ): Promise<MessengerRuntimeCredentials>;
  getByIgBusinessAccountId(
    igBusinessAccountId: string,
  ): Promise<MessengerRuntimeCredentials>;
  getByInstagramWebhookAccountId?(
    webhookAccountId: string,
  ): Promise<MessengerRuntimeCredentials>;
  getByChannelConfigId(
    channelConfigId: string,
    provider: "facebook" | "instagram",
  ): Promise<MessengerRuntimeCredentials>;
  listConnectedInstagram?(limit?: number): Promise<MessengerRuntimeCredentials[]>;
  bindInstagramWebhookEntryId?(
    channelConfigId: string,
    webhookEntryId: string,
  ): Promise<void>;
  renew(
    channelConfigId: string,
    provider: "facebook" | "instagram",
    reason: TokenRenewalReason,
  ): Promise<MessengerRuntimeCredentials>;
  markNeedsReauth(
    channelConfigId: string,
    input: { reason: "meta_oauth_error"; providerErrorCode: number },
  ): Promise<void>;
};

type CachedCredentials = {
  credentials: MessengerRuntimeCredentials;
  cachedUntil: number;
};

export class MessengerCredentialManager {
  private readonly byChannel = new Map<string, CachedCredentials>();
  private readonly channelByPage = new Map<string, string>();
  private readonly channelByIg = new Map<string, string>();
  private readonly channelByInstagramWebhook = new Map<string, string>();
  private readonly renewals = new Map<string, Promise<MessengerRuntimeCredentials>>();

  constructor(
    private readonly accounts: MessengerCredentialSource,
    private readonly config: Pick<
      AccountsApiConfig,
      "renewalWindowMs" | "credentialCacheTtlMs"
    >,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  async getByChannelConfigId(
    channelConfigId: string,
    provider: "facebook" | "instagram",
  ): Promise<MessengerRuntimeCredentials> {
    const cached = this.readCached(channelConfigId);
    if (cached && cached.provider === provider) {
      return this.prepare(cached);
    }
    const credentials = await this.accounts.getByChannelConfigId(
      channelConfigId,
      provider,
    );
    return this.prepare(credentials);
  }

  async getByPageId(
    pageId: string,
    provider: "facebook" | "instagram" = "facebook",
  ): Promise<MessengerRuntimeCredentials> {
    const channelConfigId = this.channelByPage.get(`${provider}:${pageId}`);
    if (channelConfigId) {
      const cached = this.readCached(channelConfigId);
      if (cached && cached.provider === provider) return this.prepare(cached);
    }
    return this.prepare(await this.accounts.getByPageId(pageId, provider));
  }

  async getByIgBusinessAccountId(
    igBusinessAccountId: string,
  ): Promise<MessengerRuntimeCredentials> {
    const channelConfigId = this.channelByIg.get(igBusinessAccountId);
    if (channelConfigId) {
      const cached = this.readCached(channelConfigId);
      if (cached) return this.prepare(cached);
    }
    return this.prepare(
      await this.accounts.getByIgBusinessAccountId(igBusinessAccountId),
    );
  }

  /**
   * Resolve Instagram webhook entry.id when My Account stored Graph IG id / app-scoped id
   * that does not equal Meta's messaging webhook entry.id.
   */
  async resolveInstagramWebhookEntry(
    entryId: string,
    identityMatcher: (
      credentials: MessengerRuntimeCredentials,
    ) => Promise<{ id?: string; user_id?: string } | null>,
  ): Promise<MessengerRuntimeCredentials> {
    const cachedChannelId = this.channelByInstagramWebhook.get(entryId);
    if (cachedChannelId) {
      const cached = this.readCached(cachedChannelId);
      if (cached?.provider === "instagram") return this.prepare(cached);
    }

    if (this.accounts.getByInstagramWebhookAccountId) {
      try {
        return this.prepare(
          await this.accounts.getByInstagramWebhookAccountId(entryId),
        );
      } catch (webhookError) {
        if (
          !(webhookError instanceof AccountsApiError) ||
          webhookError.code !== "configuration_not_found"
        ) {
          throw webhookError;
        }
      }
    }

    try {
      return await this.getByIgBusinessAccountId(entryId);
    } catch (directError) {
      if (
        !(directError instanceof AccountsApiError) ||
        directError.code !== "configuration_not_found"
      ) {
        throw directError;
      }
    }

    try {
      return await this.getByPageId(entryId, "instagram");
    } catch (pageError) {
      if (
        !(pageError instanceof AccountsApiError) ||
        pageError.code !== "configuration_not_found"
      ) {
        throw pageError;
      }
    }

    if (!this.accounts.listConnectedInstagram) {
      throw new AccountsApiError(
        "configuration_not_found",
        "instagram configuration not found",
        404,
        false,
      );
    }

    const candidates = await this.accounts.listConnectedInstagram(25);
    let matchedCandidate: MessengerRuntimeCredentials | null = null;
    let matchReason: "identity" | "sole_connected" | null = null;

    for (const candidate of candidates) {
      const identity = await identityMatcher(candidate);
      if (!identity) continue;
      const matched =
        identity.id === entryId ||
        identity.user_id === entryId ||
        candidate.igWebhookAccountId === entryId ||
        candidate.instagramLoginUserId === entryId ||
        candidate.instagramLoginScopedId === entryId ||
        candidate.igBusinessAccountId === entryId ||
        candidate.pageId === entryId;
      if (!matched) continue;
      matchedCandidate = candidate;
      matchReason = "identity";
      break;
    }

    // Meta Instagram Messaging often sends a webhook entry.id that matches neither
    // Graph IG business account id nor Instagram Login /me ids. When only one
    // connected Instagram config exists, bind that webhook id to it.
    if (!matchedCandidate && candidates.length === 1) {
      matchedCandidate = candidates[0]!;
      matchReason = "sole_connected";
      this.logger.warn(
        {
          entryId,
          channelConfigId: matchedCandidate.channelConfigId,
          storedIgBusinessAccountId: matchedCandidate.igBusinessAccountId,
        },
        "resolved instagram webhook entry id via sole connected config",
      );
    }

    if (!matchedCandidate || !matchReason) {
      throw new AccountsApiError(
        "configuration_not_found",
        "instagram configuration not found",
        404,
        false,
      );
    }

    try {
      await this.accounts.bindInstagramWebhookEntryId?.(
        matchedCandidate.channelConfigId,
        entryId,
      );
    } catch (bindError) {
      this.logger.warn(
        {
          err: bindError,
          channelConfigId: matchedCandidate.channelConfigId,
          entryId,
        },
        "failed to bind instagram webhook entry id",
      );
    }

    const resolved = {
      ...matchedCandidate,
      igWebhookAccountId: entryId,
    };
    this.channelByInstagramWebhook.set(entryId, resolved.channelConfigId);
    return this.prepare(resolved);
  }

  async executeByChannel<T>(
    channelConfigId: string,
    provider: "facebook" | "instagram",
    operation: (credentials: MessengerRuntimeCredentials) => Promise<T>,
  ): Promise<T> {
    const credentials = await this.getByChannelConfigId(channelConfigId, provider);
    return this.executeWithRetry(credentials, operation);
  }

  evict(channelConfigId: string): void {
    const cached = this.byChannel.get(channelConfigId);
    if (cached) {
      this.channelByPage.delete(
        `${cached.credentials.provider}:${cached.credentials.pageId}`,
      );
      if (cached.credentials.igBusinessAccountId) {
        this.channelByIg.delete(cached.credentials.igBusinessAccountId);
      }
      if (cached.credentials.igWebhookAccountId) {
        this.channelByInstagramWebhook.delete(
          cached.credentials.igWebhookAccountId,
        );
      }
    }
    this.byChannel.delete(channelConfigId);
  }

  private async prepare(
    credentials: MessengerRuntimeCredentials,
  ): Promise<MessengerRuntimeCredentials> {
    if (this.isExpiringSoon(credentials)) {
      return this.renew(
        credentials.channelConfigId,
        credentials.provider,
        "expiring_soon",
      );
    }
    this.cache(credentials);
    return credentials;
  }

  private async executeWithRetry<T>(
    credentials: MessengerRuntimeCredentials,
    operation: (credentials: MessengerRuntimeCredentials) => Promise<T>,
  ): Promise<T> {
    try {
      return await operation(credentials);
    } catch (error) {
      if (!isMetaOAuthError(error)) throw error;

      this.evict(credentials.channelConfigId);
      this.logger.warn(
        {
          channelConfigId: credentials.channelConfigId,
          provider: credentials.provider,
          providerCode: error.providerCode,
        },
        "meta messenger access token rejected; attempting one renewal",
      );

      let renewed: MessengerRuntimeCredentials;
      try {
        renewed = await this.renew(
          credentials.channelConfigId,
          credentials.provider,
          "provider_auth_failure",
        );
      } catch (renewError) {
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
            "failed to mark messenger connection as needing reauthentication",
          );
        }
        throw new AccountsApiError(
          "needs_reauth",
          `The ${credentials.provider} connection must be reconnected`,
          422,
          false,
        );
      }
    }
  }

  private renew(
    channelConfigId: string,
    provider: "facebook" | "instagram",
    reason: TokenRenewalReason,
  ): Promise<MessengerRuntimeCredentials> {
    const key = `${provider}:${channelConfigId}`;
    const existing = this.renewals.get(key);
    if (existing) return existing;

    const renewal = this.accounts
      .renew(channelConfigId, provider, reason)
      .then((credentials) => {
        this.cache(credentials);
        return credentials;
      })
      .finally(() => {
        this.renewals.delete(key);
      });
    this.renewals.set(key, renewal);
    return renewal;
  }

  private isExpiringSoon(credentials: MessengerRuntimeCredentials): boolean {
    if (!credentials.tokenExpiresAt) return false;
    const expiresAt = Date.parse(credentials.tokenExpiresAt);
    return (
      !Number.isFinite(expiresAt) ||
      expiresAt - this.now() <= this.config.renewalWindowMs
    );
  }

  private cache(credentials: MessengerRuntimeCredentials): void {
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
    this.channelByPage.set(
      `${credentials.provider}:${credentials.pageId}`,
      credentials.channelConfigId,
    );
    if (credentials.igBusinessAccountId) {
      this.channelByIg.set(
        credentials.igBusinessAccountId,
        credentials.channelConfigId,
      );
    }
    if (credentials.igWebhookAccountId) {
      this.channelByInstagramWebhook.set(
        credentials.igWebhookAccountId,
        credentials.channelConfigId,
      );
    }
  }

  private readCached(channelConfigId: string): MessengerRuntimeCredentials | null {
    const cached = this.byChannel.get(channelConfigId);
    if (!cached) return null;
    if (cached.cachedUntil <= this.now()) {
      this.evict(channelConfigId);
      return null;
    }
    return cached.credentials;
  }
}
