import { createHmac, timingSafeEqual } from "node:crypto";

import type { MetaMessengerAppConfig } from "../config.js";
import type { MessengerRuntimeCredentials } from "../types/accounts-contract.js";
import type { MetaMessengerSendResult } from "../types/meta-messenger.js";
import { MetaWhatsAppError } from "./meta-whatsapp.js";

type FetchLike = typeof fetch;

type InstagramIdentity = {
  id?: string;
  user_id?: string;
  username?: string;
};

type InstagramMessageLookup = {
  id?: string;
  message?: string;
  from?: { id?: string; username?: string };
};

function usesInstagramLogin(credentials: MessengerRuntimeCredentials): boolean {
  if (credentials.provider !== "instagram") return false;
  if (credentials.authType) return credentials.authType === "instagram_login";
  // Backward compatibility for rows created before meta_auth_type existed.
  return (
    credentials.accessToken.startsWith("IGAA") ||
    credentials.accessToken.startsWith("IGAAD")
  );
}

export class MetaMessengerClient {
  constructor(
    private readonly config: MetaMessengerAppConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  verifyWebhookSignature(
    signatureHeader: string | undefined,
    rawBody: Buffer,
    appSecret?: string | null,
  ): boolean {
    const secret = appSecret ?? this.config.appSecret;
    if (!secret || !signatureHeader?.startsWith("sha256=")) {
      return false;
    }

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const received = signatureHeader.slice("sha256=".length);
    if (expected.length !== received.length) return false;
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(received, "utf8"));
  }

  appSecretForChannel(channelType: "facebook" | "instagram"): string | null {
    if (channelType === "instagram") {
      return this.config.instagramAppSecret ?? this.config.appSecret;
    }
    return this.config.appSecret;
  }

  async sendTextMessage(
    credentials: MessengerRuntimeCredentials,
    to: string,
    body: string,
  ): Promise<MetaMessengerSendResult> {
    return this.sendMessage(credentials, {
      messaging_product: credentials.provider === "instagram" ? "instagram" : undefined,
      recipient: { id: to },
      message: { text: body },
    });
  }

  async sendQuickReplyMessage(
    credentials: MessengerRuntimeCredentials,
    to: string,
    input: {
      body: string;
      buttons: Array<{ title: string; payload: string }>;
    },
  ): Promise<MetaMessengerSendResult> {
    return this.sendMessage(credentials, {
      messaging_product: credentials.provider === "instagram" ? "instagram" : undefined,
      recipient: { id: to },
      message: {
        text: input.body,
        quick_replies: input.buttons.map((button) => ({
          content_type: "text",
          title: button.title,
          payload: button.payload,
        })),
      },
    });
  }

  /**
   * Resolve Instagram Login /me identity fields used to match webhook entry.id.
   */
  async fetchInstagramIdentity(
    credentials: MessengerRuntimeCredentials,
  ): Promise<InstagramIdentity | null> {
    if (credentials.provider !== "instagram") return null;
    const url =
      `https://graph.instagram.com/${this.config.graphApiVersion}` +
      `/me?fields=id,username,user_id`;
    const response = await this.fetcher(url, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        Accept: "application/json",
      },
    });
    const body = (await response.json().catch(() => null)) as
      | (InstagramIdentity & { error?: { message?: string; code?: number } })
      | null;
    if (!response.ok || !body || body.error) return null;
    return { id: body.id, user_id: body.user_id, username: body.username };
  }

  /**
   * Best-effort lookup for Meta's broken Instagram payloads that only include
   * message_edit.mid (no sender/text).
   */
  async fetchInstagramMessageByMid(
    credentials: MessengerRuntimeCredentials,
    mid: string,
  ): Promise<InstagramMessageLookup | null> {
    if (credentials.provider !== "instagram" || !mid) return null;
    const hosts = usesInstagramLogin(credentials)
      ? ["graph.instagram.com", "graph.facebook.com"]
      : ["graph.facebook.com", "graph.instagram.com"];

    for (const host of hosts) {
      const url =
        `https://${host}/${this.config.graphApiVersion}/` +
        `${encodeURIComponent(mid)}?fields=id,message,from`;
      const response = await this.fetcher(url, {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          Accept: "application/json",
        },
      });
      const body = (await response.json().catch(() => null)) as
        | (InstagramMessageLookup & { error?: { message?: string; code?: number } })
        | null;
      if (response.ok && body && !body.error) {
        return { id: body.id, message: body.message, from: body.from };
      }
    }
    return null;
  }

  private messagesUrl(credentials: MessengerRuntimeCredentials): string {
    if (
      credentials.provider === "instagram" &&
      usesInstagramLogin(credentials)
    ) {
      // Instagram Login tokens (IGAA...) must use graph.instagram.com, not Page id.
      return (
        `https://graph.instagram.com/${this.config.graphApiVersion}/me/messages`
      );
    }
    return (
      `https://graph.facebook.com/${this.config.graphApiVersion}` +
      `/${credentials.pageId}/messages`
    );
  }

  private async sendMessage(
    credentials: MessengerRuntimeCredentials,
    payload: Record<string, unknown>,
  ): Promise<MetaMessengerSendResult> {
    const cleaned = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );
    // Instagram Login /me/messages does not accept messaging_product.
    if (
      credentials.provider === "instagram" &&
      usesInstagramLogin(credentials)
    ) {
      delete cleaned.messaging_product;
    }

    const response = await this.fetcher(this.messagesUrl(credentials), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(cleaned),
    });

    const body = (await response.json().catch(() => null)) as
      | MetaMessengerSendResult
      | { error?: { message?: string; code?: number } };

    if (!response.ok) {
      const providerCode =
        body && typeof body === "object" && "error" in body ? body.error?.code : undefined;
      const errorMessage =
        body && typeof body === "object" && "error" in body
          ? body.error?.message ?? "Meta Messenger API request failed"
          : "Meta Messenger API request failed";
      throw new MetaWhatsAppError(errorMessage, response.status, providerCode, body);
    }

    return body as MetaMessengerSendResult;
  }
}
