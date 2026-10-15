import { entityIdSchema } from "@ai-contact-center/event-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Logger } from "pino";

import { isInternalRequestAuthorized } from "../lib/internal-auth.js";
import { mapServiceError } from "../lib/route-errors.js";
import type { MetaWhatsAppClient } from "../providers/meta-whatsapp.js";
import type { WhatsAppCredentialManager } from "../services/credential-manager.js";

const sendTextSchema = z.object({
  channelConfigId: entityIdSchema,
  to: z.string().min(8),
  body: z.string().min(1).max(4096),
  previewUrl: z.boolean().default(false),
});

const templateParameterSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1) }),
  z.object({
    type: z.literal("currency"),
    currency: z.object({
      fallback_value: z.string(),
      code: z.string(),
      amount_1000: z.number().int(),
    }),
  }),
  z.object({
    type: z.literal("date_time"),
    date_time: z.object({ fallback_value: z.string() }),
  }),
  z.object({ type: z.literal("image"), image: z.object({ link: z.string().url() }) }),
  z.object({ type: z.literal("document"), document: z.object({ link: z.string().url() }) }),
  z.object({ type: z.literal("video"), video: z.object({ link: z.string().url() }) }),
  z.object({ type: z.literal("payload"), payload: z.string() }),
]);

const templateComponentSchema = z.object({
  type: z.enum(["header", "body", "button"]),
  sub_type: z.enum(["quick_reply", "url"]).optional(),
  index: z.union([z.string(), z.number()]).optional(),
  parameters: z.array(templateParameterSchema).optional(),
});

const sendTemplateSchema = z.object({
  channelConfigId: entityIdSchema,
  to: z.string().min(8),
  templateName: z.string().min(1),
  languageCode: z.string().min(2).default("en_US"),
  components: z.array(templateComponentSchema).optional(),
});

const markReadSchema = z.object({
  channelConfigId: entityIdSchema,
});

function unauthorized(reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  return reply.status(401).send({
    error: {
      code: "unauthorized",
      message: "Unauthorized",
      retryable: false,
    },
  });
}

export function registerWhatsAppMessageRoutes(
  app: FastifyInstance,
  client: MetaWhatsAppClient,
  credentials: WhatsAppCredentialManager,
  internalServiceKey: string | null,
  logger: Logger,
): void {
  app.post("/internal/v1/whatsapp/messages", async (request, reply) => {
    if (!isInternalRequestAuthorized(request, internalServiceKey)) {
      return unauthorized(reply);
    }

    try {
      const payload = sendTextSchema.parse(request.body);
      const result = await credentials.executeByChannel(
        payload.channelConfigId,
        (runtimeCredentials) =>
          client.sendTextMessage(
            runtimeCredentials,
            payload.to,
            payload.body,
            payload.previewUrl,
          ),
      );

      logger.info(
        {
          channelConfigId: payload.channelConfigId,
          messageId: result.messages[0]?.id,
        },
        "whatsapp text message sent",
      );

      return {
        sent: true,
        providerMessageId: result.messages[0]?.id ?? null,
        channelConfigId: payload.channelConfigId,
      };
    } catch (error) {
      return mapServiceError(reply, error);
    }
  });

  app.post("/internal/v1/whatsapp/templates", async (request, reply) => {
    if (!isInternalRequestAuthorized(request, internalServiceKey)) {
      return unauthorized(reply);
    }

    try {
      const payload = sendTemplateSchema.parse(request.body);
      const result = await credentials.executeByChannel(
        payload.channelConfigId,
        (runtimeCredentials) =>
          client.sendTemplateMessage(runtimeCredentials, {
            to: payload.to,
            templateName: payload.templateName,
            languageCode: payload.languageCode,
            components: payload.components,
          }),
      );

      logger.info(
        {
          channelConfigId: payload.channelConfigId,
          templateName: payload.templateName,
          messageId: result.messages[0]?.id,
        },
        "whatsapp template message sent",
      );

      return {
        sent: true,
        providerMessageId: result.messages[0]?.id ?? null,
        channelConfigId: payload.channelConfigId,
      };
    } catch (error) {
      logger.error(
        {
          err: error,
          channelConfigId:
            typeof request.body === "object" && request.body && "channelConfigId" in request.body
              ? (request.body as { channelConfigId?: string }).channelConfigId
              : null,
          templateName:
            typeof request.body === "object" && request.body && "templateName" in request.body
              ? (request.body as { templateName?: string }).templateName
              : null,
          languageCode:
            typeof request.body === "object" && request.body && "languageCode" in request.body
              ? (request.body as { languageCode?: string }).languageCode
              : null,
        },
        "whatsapp template send failed",
      );
      return mapServiceError(reply, error);
    }
  });

  app.post(
    "/internal/v1/whatsapp/messages/:providerMessageId/read",
    async (request, reply) => {
      if (!isInternalRequestAuthorized(request, internalServiceKey)) {
        return unauthorized(reply);
      }

      try {
        const payload = markReadSchema.parse(request.body);
        const { providerMessageId } = request.params as {
          providerMessageId: string;
        };
        if (!providerMessageId) {
          return reply.status(400).send({
            error: {
              code: "invalid_request",
              message: "providerMessageId is required",
              retryable: false,
            },
          });
        }

        await credentials.executeByChannel(
          payload.channelConfigId,
          (runtimeCredentials) =>
            client.markMessageAsRead(runtimeCredentials, providerMessageId),
        );
        return {
          updated: true,
          channelConfigId: payload.channelConfigId,
          providerMessageId,
        };
      } catch (error) {
        return mapServiceError(reply, error);
      }
    }
  );
}
