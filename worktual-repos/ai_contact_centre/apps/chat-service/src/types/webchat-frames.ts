import { entityIdSchema } from "@ai-contact-center/event-contracts";
import { z } from "zod";

export const WEBCHAT_ID_PATTERN = /^wc_[a-f0-9]{32}$/i;

export const webchatIdSchema = z
  .string()
  .regex(WEBCHAT_ID_PATTERN, "webchatId must be wc_ followed by 32 hex characters");

export const visitorIdSchema = z.string().min(1, "visitorId is required");

const frameBaseSchema = z.object({
  webchatId: webchatIdSchema,
  visitorId: visitorIdSchema,
});

export const attachmentMetadataSchema = z.object({
  externalId: z.string().max(128).optional(),
  storageKey: z.string().min(1).max(2048),
  fileName: z.string().min(1).max(512),
  contentType: z.string().min(1).max(255),
  byteSize: z.number().int().nonnegative(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  downloadUrl: z
    .string()
    .url()
    .max(4096)
    .refine((url) => /^https?:\/\//i.test(url), "downloadUrl must use http or https")
    .optional(),
});

export const sessionStartFrameSchema = frameBaseSchema.extend({
  type: z.literal("session.start"),
  pageUrl: z.string().optional(),
  consent: z.object({ accepted: z.boolean() }).optional(),
  prechatAnswers: z.record(z.string()).optional(),
});

export const messageFrameSchema = frameBaseSchema
  .extend({
    type: z.literal("message"),
    text: z.string().min(1).optional(),
    attachments: z.array(attachmentMetadataSchema).max(10).optional(),
    pageUrl: z.string().optional(),
  })
  .refine((frame) => Boolean(frame.text || frame.attachments?.length), {
    message: "message requires text or attachment metadata",
  });

export const sessionEndFrameSchema = frameBaseSchema.extend({
  type: z.literal("session.end"),
  reason: z.string().min(1).max(128).optional().default("customer_ended"),
});

export const typingStartedFrameSchema = frameBaseSchema.extend({
  type: z.literal("typing.started"),
});

export const typingStoppedFrameSchema = frameBaseSchema.extend({
  type: z.literal("typing.stopped"),
});

export const receiptDeliveredFrameSchema = frameBaseSchema.extend({
  type: z.literal("receipt.delivered"),
  messageId: entityIdSchema,
  occurredAt: z.string().datetime().optional(),
});

export const receiptReadFrameSchema = frameBaseSchema.extend({
  type: z.literal("receipt.read"),
  messageId: entityIdSchema,
  occurredAt: z.string().datetime().optional(),
});

export const pingFrameSchema = frameBaseSchema.extend({
  type: z.literal("ping"),
});

export const presenceBindFrameSchema = frameBaseSchema.extend({
  type: z.literal("presence.bind"),
});

export const inboundFrameSchema = z.union([
  sessionStartFrameSchema,
  messageFrameSchema,
  sessionEndFrameSchema,
  typingStartedFrameSchema,
  typingStoppedFrameSchema,
  receiptDeliveredFrameSchema,
  receiptReadFrameSchema,
  pingFrameSchema,
  presenceBindFrameSchema,
]);

export type SessionStartFrame = z.infer<typeof sessionStartFrameSchema>;
export type MessageFrame = z.infer<typeof messageFrameSchema>;
export type InboundFrame = z.infer<typeof inboundFrameSchema>;

export type SessionReadyFrame = {
  type: "session.ready";
  webchatId: string;
  visitorId: string;
  conversationId?: string;
  resumed?: boolean;
  messages?: Array<{
    from: "user" | "bot" | "agent" | "system";
    text: string;
    at: string;
    agent_name?: string;
  }>;
  stub?: boolean;
};

export type SystemFrame = {
  type: "system";
  text: string;
};

export type OutboundMessageFrame = {
  type: "message";
  from: "bot" | "agent" | "system" | "user";
  text: string;
  messageId?: string;
  agent_name?: string;
  attachments?: z.infer<typeof attachmentMetadataSchema>[];
  stub?: boolean;
};

export type WidgetPopupFrame = {
  type: "widget.popup";
  webchatId: string;
  visitorId: string;
  openMode?: "bubble" | "panel";
  autoSessionStart?: boolean;
  text?: string;
  reason?: string;
};

export type PresenceBoundFrame = {
  type: "presence.bound";
  webchatId: string;
  visitorId: string;
};

export type OutboundFrame =
  | SessionReadyFrame
  | SystemFrame
  | OutboundMessageFrame
  | WidgetPopupFrame
  | PresenceBoundFrame
  | { type: "session.ended"; reason: string }
  | { type: "typing.started" | "typing.stopped"; from: "agent" }
  | {
      type: "receipt.sent" | "receipt.delivered" | "receipt.read";
      messageId: string;
      occurredAt: string;
    };

export function parseInboundFrame(data: unknown): InboundFrame {
  return inboundFrameSchema.parse(data);
}

export function isValidWebchatId(webchatId: string): boolean {
  return WEBCHAT_ID_PATTERN.test(webchatId);
}
