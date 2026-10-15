import { entityIdSchema } from "@ai-contact-center/event-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Logger } from "pino";

import { isInternalRequestAuthorized } from "../lib/internal-auth.js";
import { mapServiceError } from "../lib/route-errors.js";
import type { MetaWhatsAppClient } from "../providers/meta-whatsapp.js";
import type { WhatsAppCredentialManager } from "../services/credential-manager.js";

const createTemplateButtonSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("QUICK_REPLY"),
    text: z.string().min(1).max(25),
  }),
  z.object({
    type: z.literal("URL"),
    text: z.string().min(1).max(25),
    url: z.string().url(),
  }),
  z.object({
    type: z.literal("PHONE_NUMBER"),
    text: z.string().min(1).max(25),
    phone_number: z.string().min(3),
  }),
]);

const createTemplateComponentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("BODY"),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("FOOTER"),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("HEADER"),
    format: z.enum(["TEXT", "IMAGE", "VIDEO", "DOCUMENT"]).default("TEXT"),
    text: z.string().optional(),
    example: z
      .object({
        header_handle: z.array(z.string()).optional(),
        header_text: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("BUTTONS"),
    buttons: z.array(createTemplateButtonSchema).min(1).max(3),
  }),
]);

const submitTemplateApprovalSchema = z.object({
  channelConfigId: entityIdSchema,
  name: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[a-z0-9_]+$/, "Template name must use lowercase letters, numbers, and underscores"),
  language: z.string().min(2),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  allowCategoryChange: z.boolean().optional(),
  components: z.array(createTemplateComponentSchema).min(1),
});

const fetchTemplateApprovalStatusSchema = z
  .object({
    channelConfigId: entityIdSchema,
    templateName: z.string().min(1).optional(),
    templateId: z.string().min(1).optional(),
    language: z.string().min(2).optional(),
    status: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.templateName || value.templateId), {
    message: "templateName or templateId is required",
  });

const booleanQuerySchema = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return value === true || value === "true" || value === "1";
  });

const listTemplatesSchema = z.object({
  channelConfigId: entityIdSchema,
  templateName: z.string().min(1).optional(),
  language: z.string().min(2).optional(),
  status: z.string().min(1).optional(),
  return_template: booleanQuerySchema,
});

const getTemplateSchema = z
  .object({
    channelConfigId: entityIdSchema,
    templateName: z.string().min(1).optional(),
    templateId: z.string().min(1).optional(),
    language: z.string().min(2).optional(),
    status: z.string().min(1).optional(),
    return_template: booleanQuerySchema,
  })
  .refine((value) => Boolean(value.templateName || value.templateId), {
    message: "templateName or templateId is required",
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

export function registerWhatsAppTemplateApprovalRoutes(
  app: FastifyInstance,
  client: MetaWhatsAppClient,
  credentials: WhatsAppCredentialManager,
  internalServiceKey: string | null,
  logger: Logger,
): void {
  app.post("/internal/v1/whatsapp/templates/submit-approval", async (request, reply) => {
    if (!isInternalRequestAuthorized(request, internalServiceKey)) {
      return unauthorized(reply);
    }

    try {
      const payload = submitTemplateApprovalSchema.parse(request.body);
      const result = await credentials.executeByChannel(
        payload.channelConfigId,
        (runtimeCredentials) =>
          client.submitMessageTemplateForApproval(runtimeCredentials, {
            name: payload.name,
            language: payload.language,
            category: payload.category,
            allowCategoryChange: payload.allowCategoryChange,
            components: payload.components,
          }),
      );

      logger.info(
        {
          channelConfigId: payload.channelConfigId,
          templateName: payload.name,
          templateId: result.id,
          status: result.status,
        },
        "whatsapp template submitted for approval",
      );

      return {
        submitted: true,
        channelConfigId: payload.channelConfigId,
        templateId: result.id,
        templateName: payload.name,
        status: result.status,
        category: result.category,
      };
    } catch (error) {
      return mapServiceError(reply, error);
    }
  });

  app.get("/internal/v1/whatsapp/templates/approval-status", async (request, reply) => {
    if (!isInternalRequestAuthorized(request, internalServiceKey)) {
      return unauthorized(reply);
    }

    try {
      const payload = fetchTemplateApprovalStatusSchema.parse(request.query);
      const result = await credentials.executeByChannel(
        payload.channelConfigId,
        (runtimeCredentials) =>
          client.getMessageTemplateApprovalStatus(runtimeCredentials, {
            templateName: payload.templateName,
            templateId: payload.templateId,
            language: payload.language,
            status: payload.status,
          }),
      );

      logger.info(
        {
          channelConfigId: payload.channelConfigId,
          templateName: payload.templateName ?? null,
          templateId: payload.templateId ?? null,
          count: result.data.length,
        },
        "whatsapp template approval status fetched",
      );

      return {
        channelConfigId: payload.channelConfigId,
        templates: result.data,
      };
    } catch (error) {
      return mapServiceError(reply, error);
    }
  });

  app.get("/internal/v1/whatsapp/templates/detail", async (request, reply) => {
    if (!isInternalRequestAuthorized(request, internalServiceKey)) {
      return unauthorized(reply);
    }

    try {
      const payload = getTemplateSchema.parse(request.query);
      const returnTemplate = payload.return_template ?? true;
      const template = await credentials.executeByChannel(
        payload.channelConfigId,
        (runtimeCredentials) =>
          client.getMessageTemplate(runtimeCredentials, {
            templateName: payload.templateName,
            templateId: payload.templateId,
            language: payload.language,
            status: payload.status,
            returnTemplate,
          }),
      );

      if (!template) {
        return reply.status(404).send({
          error: {
            code: "template_not_found",
            message: "WhatsApp template not found",
            retryable: false,
          },
        });
      }

      logger.info(
        {
          channelConfigId: payload.channelConfigId,
          templateName: payload.templateName ?? null,
          templateId: payload.templateId ?? null,
          language: payload.language ?? null,
          returnTemplate,
        },
        "whatsapp template fetched",
      );

      return {
        channelConfigId: payload.channelConfigId,
        template,
      };
    } catch (error) {
      return mapServiceError(reply, error);
    }
  });

  app.get("/internal/v1/whatsapp/templates", async (request, reply) => {
    if (!isInternalRequestAuthorized(request, internalServiceKey)) {
      return unauthorized(reply);
    }

    try {
      const payload = listTemplatesSchema.parse(request.query);
      const returnTemplate = Boolean(payload.return_template);
      const result = await credentials.executeByChannel(
        payload.channelConfigId,
        (runtimeCredentials) =>
          client.listMessageTemplates(runtimeCredentials, {
            templateName: payload.templateName,
            language: payload.language,
            status: payload.status,
            returnTemplate,
          }),
      );

      logger.info(
        {
          channelConfigId: payload.channelConfigId,
          templateName: payload.templateName ?? null,
          language: payload.language ?? null,
          status: payload.status ?? null,
          returnTemplate,
          count: result.data.length,
        },
        "whatsapp templates listed",
      );

      return {
        channelConfigId: payload.channelConfigId,
        count: result.data.length,
        templates: result.data,
      };
    } catch (error) {
      return mapServiceError(reply, error);
    }
  });
}
