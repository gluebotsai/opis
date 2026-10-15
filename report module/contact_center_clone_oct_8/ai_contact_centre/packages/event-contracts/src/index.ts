import { z } from "zod";

import { correlationIdSchema, entityIdSchema } from "./id-schema.js";

export {
  correlationIdSchema,
  entityIdSchema,
  isEntityId,
  jsonStringifyEntityPayload,
  parseEntityId,
  serializeEntityId,
  serializeEntityIdOptional,
} from "./id-schema.js";

export const channelTypeSchema = z.enum([
  "webchat",
  "email",
  "sms",
  "voice",
  "whatsapp",
  "instagram",
  "facebook",
]);

export const inboundMessageEventSchema = z.object({
  schema_version: z.literal("1.0"),
  event_id: correlationIdSchema,
  tenant_id: entityIdSchema,
  channel_type: channelTypeSchema,
  external_thread_id: z.string(),
  external_message_id: z.string(),
  customer_ref: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  body: z.string(),
  attachments: z
    .array(
      z.object({
        url: z.string().url(),
        mime_type: z.string(),
      }),
    )
    .optional(),
  metadata: z.record(z.unknown()).optional(),
  occurred_at: z.string().datetime(),
});

export type InboundMessageEvent = z.infer<typeof inboundMessageEventSchema>;

export const normalizedSocialInboundSchema = z.object({
  organizationId: entityIdSchema,
  channelConfigId: entityIdSchema,
  channelType: z.literal("whatsapp"),
  externalThreadId: z.string().min(1).max(128),
  externalMessageId: z.string().min(1).max(128),
  customerRef: z.string().min(1).max(128),
  customerName: z.string().optional().nullable(),
  body: z.string().min(1).max(4096),
  messageType: z.string().max(64).optional(),
  phoneNumberId: z.string().max(64).optional(),
  occurredAt: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});

export type NormalizedSocialInbound = z.infer<typeof normalizedSocialInboundSchema>;

export const dlqEnvelopeSchema = z.object({
  schema_version: z.literal("1.0"),
  original_topic: z.string(),
  original_payload: z.unknown(),
  error_message: z.string(),
  failed_at: z.string().datetime(),
  retry_count: z.number().int().nonnegative(),
});

export type DlqEnvelope = z.infer<typeof dlqEnvelopeSchema>;

export const EVENT_TOPICS = {
  CONVERSATION_CREATED: "cc.conversation.created",
  MESSAGE_RECEIVED: "cc.message.received",
  CONVERSATION_MESSAGE_CREATED: "cc.conversation.message.created",
  CONVERSATION_ASSIGNED: "cc.conversation.assigned",
  AGENT_PRESENCE_CHANGED: "cc.agent.presence.changed",
  QUEUE_STATS_UPDATED: "cc.queue.stats.updated",
  SLA_BREACHED: "cc.sla.breached",
  NLP_ENRICHMENT_COMPLETED: "nlp.enrichment.completed",
} as const;
