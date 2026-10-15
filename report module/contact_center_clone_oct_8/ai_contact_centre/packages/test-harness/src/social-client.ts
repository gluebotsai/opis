import { createHmac } from "node:crypto";

import type { E2eServiceConfig } from "./e2e-config.js";

export class SocialClient {
  constructor(private readonly config: E2eServiceConfig) {}

  signWebhookBody(rawBody: string): string {
    const digest = createHmac("sha256", this.config.metaAppSecret).update(rawBody).digest("hex");
    return `sha256=${digest}`;
  }

  buildInboundWebhookPayload(input: {
    phoneNumberId: string;
    from: string;
    messageId: string;
    body: string;
    timestamp?: string;
  }) {
    const ts = input.timestamp ?? String(Math.floor(Date.now() / 1000));
    return {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-test",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "15550001111",
                  phone_number_id: input.phoneNumberId,
                },
                contacts: [{ profile: { name: "E2E Customer" }, wa_id: input.from }],
                messages: [
                  {
                    from: input.from,
                    id: input.messageId,
                    timestamp: ts,
                    type: "text",
                    text: { body: input.body },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  async postWhatsAppWebhook(payload: unknown) {
    const rawBody = JSON.stringify(payload);
    const response = await fetch(`${this.config.socialServiceUrl}/webhooks/whatsapp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": this.signWebhookBody(rawBody),
      },
      body: rawBody,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `WhatsApp webhook failed (${response.status}): ${JSON.stringify(body)}`,
      );
    }
    return body;
  }
}
