import type { AccountsApiConfig } from "../config.js";
import {
  accountsErrorEnvelopeSchema,
  type NeedsReauthInput,
  type TokenRenewalReason,
  type WhatsAppRuntimeCredentials,
  whatsappRuntimeCredentialsSchema,
} from "../types/accounts-contract.js";

type FetchLike = typeof fetch;

export class AccountsApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AccountsApiError";
  }
}

export class AccountsClient {
  constructor(
    private readonly config: AccountsApiConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  getByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppRuntimeCredentials> {
    return this.request(
      `/internal/v1/social/whatsapp/configs/by-phone-number/${encodeURIComponent(phoneNumberId)}`,
    );
  }

  getByChannelConfigId(channelConfigId: string): Promise<WhatsAppRuntimeCredentials> {
    return this.request(
      `/internal/v1/social/whatsapp/configs/${encodeURIComponent(channelConfigId)}`,
    );
  }

  renew(
    channelConfigId: string,
    reason: TokenRenewalReason,
  ): Promise<WhatsAppRuntimeCredentials> {
    return this.request(
      `/internal/v1/social/whatsapp/configs/${encodeURIComponent(channelConfigId)}/renew`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      },
    );
  }

  async markNeedsReauth(channelConfigId: string, input: NeedsReauthInput): Promise<void> {
    await this.request(
      `/internal/v1/social/whatsapp/configs/${encodeURIComponent(channelConfigId)}/needs-reauth`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      false,
    );
  }

  private async request<T extends boolean = true>(
    path: string,
    init: RequestInit = {},
    expectCredentials: T = true as T,
  ): Promise<T extends true ? WhatsAppRuntimeCredentials : void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await this.fetcher(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-internal-service-key": this.config.serviceKey,
          ...init.headers,
        },
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        const parsed = accountsErrorEnvelopeSchema.safeParse(body);
        throw new AccountsApiError(
          parsed.success ? parsed.data.error.code : "accounts_request_failed",
          parsed.success ? parsed.data.error.message : "Accounts API request failed",
          response.status,
          parsed.success ? parsed.data.error.retryable : response.status >= 500,
          body,
        );
      }

      if (!expectCredentials) {
        return undefined as T extends true ? WhatsAppRuntimeCredentials : void;
      }

      const parsed = whatsappRuntimeCredentialsSchema.safeParse(body);
      if (!parsed.success) {
        throw new AccountsApiError(
          "invalid_accounts_response",
          "Accounts API returned invalid WhatsApp credentials",
          502,
          false,
          parsed.error.flatten(),
        );
      }
      return parsed.data as T extends true ? WhatsAppRuntimeCredentials : void;
    } catch (error) {
      if (error instanceof AccountsApiError) throw error;
      const timedOut = error instanceof Error && error.name === "AbortError";
      throw new AccountsApiError(
        "accounts_unavailable",
        timedOut ? "Accounts API request timed out" : "Accounts API is unavailable",
        503,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
