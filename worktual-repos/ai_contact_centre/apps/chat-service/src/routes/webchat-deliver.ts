import { entityIdSchema } from "@ai-contact-center/event-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Logger } from "pino";

import type { WebchatConnectionRegistry } from "../websocket/webchat-connection-registry.js";
import type { OutboundFrame, OutboundMessageFrame } from "../types/webchat-frames.js";
import { runWebchatNlpTurn } from "../services/nlp-client.js";

const deliverSchema = z.object({
  conversationId: entityIdSchema,
  body: z.string().min(1),
  messageId: entityIdSchema.optional(),
  senderType: z.enum(["agent", "system"]).default("agent"),
  agent_name: z.string().trim().min(1).max(200).optional(),
  webchatId: z.string().regex(/^wc_[a-f0-9]{32}$/i).optional(),
  visitorId: z.string().min(1).optional(),
  attachments: z
    .array(
      z.object({
        externalId: z.string().optional(),
        storageKey: z.string().min(1),
        fileName: z.string().min(1),
        contentType: z.string().min(1),
        byteSize: z.number().int().nonnegative(),
        checksumSha256: z.string().optional(),
        downloadUrl: z
          .string()
          .url()
          .refine((url) => /^https?:\/\//i.test(url))
          .optional(),
      }),
    )
    .optional(),
});

const eventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.enum(["typing.started", "typing.stopped"]),
    conversationId: entityIdSchema,
  }),
  z.object({
    type: z.enum(["receipt.delivered", "receipt.read"]),
    conversationId: entityIdSchema,
    messageId: entityIdSchema,
    occurredAt: z.string().datetime(),
  }),
  z.object({
    type: z.literal("session.ended"),
    conversationId: entityIdSchema,
    reason: z.string().min(1).max(128),
  }),
]);

function isAuthorized(request: { headers: Record<string, unknown> }): boolean {
  const serviceKey = process.env.INTERNAL_SERVICE_KEY;
  const headerKey = request.headers["x-internal-service-key"];
  return !(serviceKey && headerKey !== serviceKey && process.env.NODE_ENV === "production");
}

export function registerWebchatDeliverRoute(
  app: FastifyInstance,
  registry: WebchatConnectionRegistry,
  logger: Logger,
): void {
  app.post("/internal/v1/webchat/deliver", async (request, reply) => {
    if (!isAuthorized(request)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const payload = deliverSchema.parse(request.body);
    let connection = registry.getByConversation(payload.conversationId);
    if (!connection && payload.webchatId && payload.visitorId) {
      connection = registry.getBySession(payload.webchatId, payload.visitorId);
    }
    if (!connection && payload.webchatId) {
      connection = registry.getByWebchatId(payload.webchatId);
    }
    if (!connection) {
      return reply.status(404).send({ error: "No active webchat connection for conversation" });
    }

    const frame: OutboundMessageFrame = {
      type: "message",
      from: payload.senderType,
      text: payload.body,
      messageId: payload.messageId,
      ...(payload.senderType === "agent" && payload.agent_name
        ? { agent_name: payload.agent_name }
        : {}),
      attachments: payload.attachments,
      stub: false,
    };

    connection.ws.send(JSON.stringify(frame));
    logger.info(
      {
        conversationId: payload.conversationId,
        webchatId: connection.webchatId,
        visitorId: connection.visitorId,
        senderType: payload.senderType,
        agent_name: payload.agent_name,
      },
      "webchat message delivered",
    );

    const organizationId = request.headers["x-tenant-id"];
    if (payload.senderType === "agent" && typeof organizationId === "string" && organizationId) {
      void runWebchatNlpTurn({
        organizationId,
        conversationId: payload.conversationId,
        message: payload.body,
        tenantContext: {},
        transcript: [],
        from: "agent",
        agentName: payload.agent_name,
      }).catch((error) => {
        logger.warn(
          { err: error, conversationId: payload.conversationId },
          "webchat agent turn ingest failed",
        );
      });
    }

    return { delivered: true, conversationId: payload.conversationId };
  });

  app.post("/internal/v1/webchat/event", async (request, reply) => {
    if (!isAuthorized(request)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const payload = eventSchema.parse(request.body);
    const connection = registry.getByConversation(payload.conversationId);
    if (!connection || connection.ws.readyState !== connection.ws.OPEN) {
      return reply.status(404).send({ error: "No active webchat connection for conversation" });
    }

    const frame: OutboundFrame =
      payload.type === "typing.started" || payload.type === "typing.stopped"
        ? { type: payload.type, from: "agent" }
        : payload.type === "session.ended"
          ? { type: "session.ended", reason: payload.reason }
          : "messageId" in payload
            ? {
              type: payload.type,
              messageId: payload.messageId,
              occurredAt: payload.occurredAt,
              }
            : { type: payload.type, from: "agent" };
    connection.ws.send(JSON.stringify(frame));
    return { delivered: true, conversationId: payload.conversationId, type: payload.type };
  });
}
