import { createHmac, timingSafeEqual } from "node:crypto";

import type { MetaWhatsAppAppConfig } from "../config.js";
import type { WhatsAppRuntimeCredentials } from "../types/accounts-contract.js";
import type {
  MetaCreateTemplateComponent,
  MetaGetMessageTemplateInput,
  MetaListMessageTemplatesInput,
  MetaListTemplateApprovalStatusResult,
  MetaSendMessageResult,
  MetaSendTemplateInput,
  MetaSubmitTemplateApprovalInput,
  MetaSubmitTemplateApprovalResult,
  MetaTemplateApprovalStatus,
} from "../types/meta-whatsapp.js";

type FetchLike = typeof fetch;

export class MetaWhatsAppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly providerCode?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "MetaWhatsAppError";
  }
}

export class MetaWhatsAppClient {
  constructor(
    private readonly config: MetaWhatsAppAppConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  verifyWebhookSignature(signatureHeader: string | undefined, rawBody: Buffer): boolean {
    if (!this.config.appSecret || !signatureHeader?.startsWith("sha256=")) {
      return false;
    }

    const expected = createHmac("sha256", this.config.appSecret).update(rawBody).digest("hex");
    const received = signatureHeader.slice("sha256=".length);

    if (expected.length !== received.length) {
      return false;
    }

    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(received, "utf8"));
  }

  async sendTextMessage(
    credentials: WhatsAppRuntimeCredentials,
    to: string,
    body: string,
    previewUrl = false,
  ): Promise<MetaSendMessageResult> {
    return this.sendMessage(
      credentials,
      {
        messaging_product: "whatsapp",
        to: normalizeWhatsAppRecipient(to),
        type: "text",
        text: { body, preview_url: previewUrl },
      },
    );
  }

  async sendTemplateMessage(
    credentials: WhatsAppRuntimeCredentials,
    input: MetaSendTemplateInput,
  ): Promise<MetaSendMessageResult> {
    return this.sendMessage(
      credentials,
      {
        messaging_product: "whatsapp",
        to: normalizeWhatsAppRecipient(input.to),
        type: "template",
        template: {
          name: input.templateName,
          language: { code: input.languageCode },
          ...(input.components?.length ? { components: input.components } : {}),
        },
      },
    );
  }

  async sendInteractiveButtonMessage(
    credentials: WhatsAppRuntimeCredentials,
    to: string,
    input: {
      body: string;
      buttons: Array<{ id: string; title: string }>;
    },
  ): Promise<MetaSendMessageResult> {
    return this.sendMessage(
      credentials,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizeWhatsAppRecipient(to),
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: input.body },
          action: {
            buttons: input.buttons.map((button) => ({
              type: "reply",
              reply: { id: button.id, title: button.title },
            })),
          },
        },
      },
    );
  }

  async markMessageAsRead(
    credentials: WhatsAppRuntimeCredentials,
    messageId: string,
  ): Promise<void> {
    await this.sendMessage(
      credentials,
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      },
    );
  }

  async submitMessageTemplateForApproval(
    credentials: WhatsAppRuntimeCredentials,
    input: MetaSubmitTemplateApprovalInput,
  ): Promise<MetaSubmitTemplateApprovalResult> {
    const wabaId = requireWabaId(credentials);
    return this.graphRequest<MetaSubmitTemplateApprovalResult>(
      credentials,
      `/${wabaId}/message_templates`,
      {
        method: "POST",
        body: {
          name: input.name,
          language: input.language,
          category: input.category,
          ...(input.allowCategoryChange !== undefined
            ? { allow_category_change: input.allowCategoryChange }
            : {}),
          components: normalizeCreateTemplateComponents(input.components),
        },
      },
    );
  }

  async getMessageTemplateApprovalStatus(
    credentials: WhatsAppRuntimeCredentials,
    input: MetaGetMessageTemplateInput,
  ): Promise<MetaListTemplateApprovalStatusResult> {
    if (input.templateId) {
      const template = await this.graphRequest<Record<string, unknown>>(
        credentials,
        `/${input.templateId}`,
        {
          query: {
            fields: templateGraphFields(Boolean(input.returnTemplate)),
          },
        },
      );
      let templates = [
        normalizeTemplateApprovalStatus(template, Boolean(input.returnTemplate)),
      ];
      if (input.language) {
        templates = templates.filter((template) => template.language === input.language);
      }
      if (input.status) {
        templates = templates.filter(
          (template) => template.status.toUpperCase() === input.status!.toUpperCase(),
        );
      }
      return { data: templates };
    }

    return this.listMessageTemplates(credentials, {
      templateName: input.templateName,
      language: input.language,
      status: input.status,
      returnTemplate: input.returnTemplate,
    });
  }

  /** Fetch a single WABA message template (optionally with full components). */
  async getMessageTemplate(
    credentials: WhatsAppRuntimeCredentials,
    input: MetaGetMessageTemplateInput,
  ): Promise<MetaTemplateApprovalStatus | null> {
    const result = await this.getMessageTemplateApprovalStatus(credentials, {
      ...input,
      returnTemplate: input.returnTemplate ?? true,
    });
    return result.data[0] ?? null;
  }

  /** List WABA message templates from Meta (all pages). */
  async listMessageTemplates(
    credentials: WhatsAppRuntimeCredentials,
    input: MetaListMessageTemplatesInput = {},
  ): Promise<MetaListTemplateApprovalStatusResult> {
    const wabaId = requireWabaId(credentials);
    const returnTemplate = Boolean(input.returnTemplate);
    const query = new URLSearchParams({
      fields: templateGraphFields(returnTemplate),
    });
    if (input.templateName) {
      query.set("name", input.templateName);
    }

    let nextUrl: string | null =
      `https://graph.facebook.com/${this.config.graphApiVersion}` +
      `/${wabaId}/message_templates?${query.toString()}`;
    const templates: MetaTemplateApprovalStatus[] = [];

    while (nextUrl) {
      const response = await this.fetcher(nextUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          Accept: "application/json",
        },
      });

      const body = (await response.json().catch(() => null)) as
        | {
            data?: Array<Record<string, unknown>>;
            paging?: { next?: string };
            error?: { message?: string; code?: number };
          }
        | null;

      if (!response.ok) {
        const providerCode = body?.error?.code;
        throw new MetaWhatsAppError(
          body?.error?.message ?? "Meta WhatsApp API request failed",
          response.status,
          providerCode,
          body,
        );
      }

      templates.push(
        ...(body?.data ?? []).map((template) =>
          normalizeTemplateApprovalStatus(template, returnTemplate),
        ),
      );
      nextUrl = body?.paging?.next ?? null;
    }

    let filtered = templates;
    if (input.language) {
      filtered = filtered.filter((template) => template.language === input.language);
    }
    if (input.status) {
      const status = input.status.toUpperCase();
      filtered = filtered.filter((template) => template.status.toUpperCase() === status);
    }

    return { data: filtered };
  }

  private async sendMessage(
    credentials: WhatsAppRuntimeCredentials,
    payload: Record<string, unknown>,
  ): Promise<MetaSendMessageResult> {
    const url =
      `https://graph.facebook.com/${this.config.graphApiVersion}` +
      `/${credentials.phoneNumberId}/messages`;

    const response = await this.fetcher(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => null)) as
      | MetaSendMessageResult
      | { error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } };

    if (!response.ok) {
      const providerCode =
        body && typeof body === "object" && "error" in body ? body.error?.code : undefined;
      const errorMessage =
        body && typeof body === "object" && "error" in body
          ? body.error?.message ?? "Meta WhatsApp API request failed"
          : "Meta WhatsApp API request failed";
      throw new MetaWhatsAppError(errorMessage, response.status, providerCode, body);
    }

    return body as MetaSendMessageResult;
  }

  private async graphRequest<T>(
    credentials: WhatsAppRuntimeCredentials,
    path: string,
    options: {
      method?: "GET" | "POST";
      body?: Record<string, unknown>;
      query?: Record<string, string | undefined>;
    } = {},
  ): Promise<T> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value) query.set(key, value);
    }
    const queryString = query.toString();
    const url =
      `https://graph.facebook.com/${this.config.graphApiVersion}` +
      path +
      (queryString ? `?${queryString}` : "");

    const response = await this.fetcher(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });

    const body = (await response.json().catch(() => null)) as
      | T
      | { error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } };

    if (!response.ok) {
      const providerCode =
        body && typeof body === "object" && "error" in body ? body.error?.code : undefined;
      const errorMessage =
        body && typeof body === "object" && "error" in body
          ? body.error?.message ?? "Meta WhatsApp API request failed"
          : "Meta WhatsApp API request failed";
      throw new MetaWhatsAppError(errorMessage, response.status, providerCode, body);
    }

    return body as T;
  }
}

export function isMetaOAuthError(error: unknown): error is MetaWhatsAppError {
  return error instanceof MetaWhatsAppError && error.providerCode === 190;
}

export function normalizeWhatsAppRecipient(value: string): string {
  return value.replace(/\D/g, "");
}

function requireWabaId(credentials: WhatsAppRuntimeCredentials): string {
  if (!credentials.wabaId) {
    throw new MetaWhatsAppError(
      "WhatsApp Business Account ID is not configured for this channel",
      400,
    );
  }
  return credentials.wabaId;
}

function normalizeCreateTemplateComponents(
  components: MetaCreateTemplateComponent[],
): Array<Record<string, unknown>> {
  return components.map((component) => {
    switch (component.type) {
      case "BODY":
        return { type: "BODY", text: component.text };
      case "FOOTER":
        return { type: "FOOTER", text: component.text };
      case "HEADER":
        return {
          type: "HEADER",
          format: component.format ?? "TEXT",
          ...(component.text ? { text: component.text } : {}),
          ...(component.example ? { example: component.example } : {}),
        };
      case "BUTTONS":
        return {
          type: "BUTTONS",
          buttons: component.buttons.map((button) => {
            switch (button.type) {
              case "QUICK_REPLY":
                return { type: "QUICK_REPLY", text: button.text };
              case "URL":
                return { type: "URL", text: button.text, url: button.url };
              case "PHONE_NUMBER":
                return {
                  type: "PHONE_NUMBER",
                  text: button.text,
                  phone_number: button.phone_number,
                };
            }
          }),
        };
    }
  });
}

const TEMPLATE_STATUS_FIELDS = "id,name,status,language,category,rejected_reason";
const TEMPLATE_FULL_FIELDS = `${TEMPLATE_STATUS_FIELDS},components`;

function templateGraphFields(returnTemplate: boolean): string {
  return returnTemplate ? TEMPLATE_FULL_FIELDS : TEMPLATE_STATUS_FIELDS;
}

function normalizeTemplateApprovalStatus(
  template: Record<string, unknown>,
  returnTemplate = false,
): MetaTemplateApprovalStatus {
  const normalized: MetaTemplateApprovalStatus = {
    id: String(template.id ?? ""),
    name: String(template.name ?? ""),
    language: String(template.language ?? ""),
    status: String(template.status ?? "UNKNOWN"),
    category: template.category ? String(template.category) : null,
    rejectedReason: template.rejected_reason
      ? String(template.rejected_reason)
      : null,
  };

  if (returnTemplate) {
    normalized.components = Array.isArray(template.components) ? template.components : null;
  }

  return normalized;
}

export function createMetaWhatsAppClient(
  config: MetaWhatsAppAppConfig,
  log?: { info: (payload: Record<string, unknown>, message: string) => void },
): MetaWhatsAppClient {
  if (process.env.WHATSAPP_E2E_STUB === "true") {
    const stubFetcher: FetchLike = async (_url, init) => {
      log?.info(
        { body: init?.body ? String(init.body).slice(0, 500) : null },
        "whatsapp e2e stub outbound",
      );
      return new Response(
        JSON.stringify({
          messaging_product: "whatsapp",
          contacts: [{ input: "stub", wa_id: "stub" }],
          messages: [{ id: `wamid.stub.${Date.now()}` }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    return new MetaWhatsAppClient(config, stubFetcher);
  }
  return new MetaWhatsAppClient(config);
}
