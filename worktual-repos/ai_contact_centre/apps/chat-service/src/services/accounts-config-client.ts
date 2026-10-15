import type { Logger } from "pino";

export type WebchatPublicConfig = {
  webchatId: string;
  title?: string;
  aliasTitle?: string;
  greetingMessage?: string;
  socketUrl?: string;
  routingQueueId?: string | null;
  organizationId?: string;
  updatedAt?: string;
};

type CacheEntry = {
  config: WebchatPublicConfig;
  etag?: string;
};

const configCache = new Map<string, CacheEntry>();

export class AccountsConfigClient {
  constructor(
    private readonly baseUrl: string | undefined,
    private readonly logger: Logger,
  ) {}

  async fetchWebchatConfig(webchatId: string): Promise<WebchatPublicConfig | null> {
    if (!this.baseUrl) {
      return null;
    }

    const cached = configCache.get(webchatId);
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/v1/public/webchat/${webchatId}/config`;

    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (cached?.etag) {
        headers["If-None-Match"] = cached.etag;
      }

      const response = await fetch(url, { headers });

      if (response.status === 304 && cached) {
        return cached.config;
      }

      if (!response.ok) {
        this.logger.warn(
          { webchatId, status: response.status },
          "accounts config fetch failed",
        );
        return cached?.config ?? null;
      }

      const body = (await response.json()) as { config?: WebchatPublicConfig };
      const config = body.config;
      if (!config) return cached?.config ?? null;
      const etag = response.headers.get("etag") ?? undefined;

      configCache.set(webchatId, { config, etag });
      return config;
    } catch (error) {
      this.logger.warn({ err: error, webchatId }, "accounts config fetch error");
      return cached?.config ?? null;
    }
  }
}
