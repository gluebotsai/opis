import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { withOrganizationContext, withStaffContext } from "../lib/rls.js";
import {
  getOrganizationDetails,
  resolveDefaultActiveWebchatId,
  resolveWebchatContext,
} from "../services/organization-context.js";
import {
  addMessageAttachmentMetadata,
  appendConversationMessage,
  appendMessageSchema,
  attachmentMetadataSchema,
  endConversation,
  endConversationSchema,
  getConversation,
  handoffSchema,
  initiateHandoff,
  listConversationMessages,
  markWebchatSessionDisconnected,
  messageReceiptSchema,
  recordMessageReceipt,
  resumeWebchatSession,
  startConversation,
  startConversationSchema,
} from "../services/conversations.js";
import { scheduleConversationMessageSentiment } from "../services/sentiment-analysis.js";
import {
  endNlpConversation,
  ensureNlpConversation,
  listNlpTurns,
  recordNlpTurn,
  recordNlpTurnSchema,
} from "../services/nlp-conversations.js";
import {
  getSessionMemory,
  upsertConversationMemory,
  upsertConversationMemorySchema,
} from "../services/conversation-memory.js";
import {
  extractKnowledgeDocumentText,
  listOrganizationKnowledge,
} from "../services/knowledge-documents.js";
import {
  getContactOmniChannelSummary,
  listContactChannelSummaries,
  upsertOmniChannelSummary,
  upsertOmniChannelSummarySchema,
} from "../services/omni-channel-summary.js";
import { listActiveCopilotTurns } from "../services/copilot-turns.js";
import {
  agentMemoryScopeSchema,
  readAgentMemory,
  upsertAgentMemory,
  upsertAgentMemorySchema,
} from "../services/agent-memory.js";
import {
  recordAgentAudit,
  recordAgentAuditSchema,
} from "../services/agent-audit.js";
import { getSipCredentialSession, restoreSipRegistrarPayload } from "../services/sip-registration.js";
import { getContact } from "../services/contacts.js";
import { resolveContactByIdentifiers } from "../services/contact-interactions.js";
import { createProactiveCallbackTask } from "../services/agent-tasks.js";
import {
  enrichContactFromConversation,
  enrichConversationContactSchema,
  hasEnrichableContactData,
  resolveConversationIdForEnrich,
  maybeEnrichContactFromCustomerMessage,
  mergeContactCaptureSources,
  resolveConversationContact,
} from "../services/contact-identity.js";
import { projectInteractionEvent } from "../services/cdp-projection.js";
import { deliverPersistedMessageToWebchat } from "../services/chat-delivery.js";
import {
  ingestInboundEmailConversation,
  ingestInboundEmailSchema,
} from "../services/email-conversations.js";
import {
  ingestInboundSocialConversation,
  ingestInboundSocialSchema,
} from "../services/social-conversations.js";
import {
  emitContactEnriched,
  emitConversationEnded,
  emitConversationQueued,
  emitConversationRejected,
  emitConversationReopened,
  emitMessageReceiptUpdated,
  emitMessageCreated,
  emitTransferCancelled,
  emitTypingUpdated,
} from "../services/realtime.js";
import {
  clearPendingOfferExpiration,
  notifyConversationRouted,
} from "../services/offer-lifecycle.js";
import { entityIdSchema } from "../lib/id-schema.js";
import {
  commitEmailBotDecision,
  commitEmailBotDecisionSchema,
  claimDueEmailDeliveries,
  updateEmailDelivery,
  updateEmailDeliverySchema,
} from "../services/email-bot-decisions.js";

function scheduleDeferredCustomerContactEnrichment(
  app: FastifyInstance,
  organizationId: string,
  conversationId: string,
  input: { messageId: string; body: string; botActive: boolean },
): void {
  if (input.botActive) return;

  void withOrganizationContext(app.prisma, organizationId, async (db) => {
    const enrichment = await maybeEnrichContactFromCustomerMessage(
      db,
      organizationId,
      conversationId,
      {
        messageId: input.messageId,
        body: input.body,
        botActive: false,
      },
    );
    if (
      enrichment &&
      enrichment.outcome !== "no_change" &&
      enrichment.outcome !== "confirmation_required" &&
      !enrichment.idempotentReplay
    ) {
      emitContactEnriched(organizationId, conversationId, enrichment);
    }
  }).catch((error) => {
    app.log.warn(
      { err: error, conversationId, messageId: input.messageId },
      "deferred customer contact enrichment failed",
    );
  });
}

function requireTenantId(
  app: FastifyInstance,
  request: { tenantId?: string },
): string {
  if (!request.tenantId) {
    throw app.httpErrors.unauthorized("Missing tenant context");
  }
  return request.tenantId;
}

function handleRouteError(app: FastifyInstance, error: unknown): never {
  if (error instanceof z.ZodError) {
    throw app.httpErrors.badRequest(error.issues[0]?.message ?? "Invalid payload");
  }
  if (
    typeof error === "object" &&
    error &&
    "status" in error &&
    typeof (error as { status: number }).status === "number"
  ) {
    const status = (error as { status: number }).status;
    const message = error instanceof Error ? error.message : "Request failed";
    if (status === 404) throw app.httpErrors.notFound(message);
    if (status === 409) throw app.httpErrors.conflict(message);
    if (status === 400) throw app.httpErrors.badRequest(message);
    if (status === 403) throw app.httpErrors.forbidden(message);
  }
  throw error;
}

export async function registerInternalRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireInternalService);
    const prefix = "/internal/v1";

    scoped.get(`${prefix}/agent-memory`, async (request) => {
      const query = agentMemoryScopeSchema.parse(request.query ?? {});
      request.tenantId = query.organizationId;
      const memories = await withOrganizationContext(
        app.prisma,
        query.organizationId,
        (db) => readAgentMemory(db, query),
      );
      return { memories };
    });

    scoped.put(`${prefix}/agent-memory`, async (request) => {
      const body = upsertAgentMemorySchema.parse(request.body ?? {});
      request.tenantId = body.organizationId;
      const memory = await withOrganizationContext(
        app.prisma,
        body.organizationId,
        (db) => upsertAgentMemory(db, body),
      );
      return { memory };
    });

    scoped.get(`${prefix}/sip-session`, async (request) => {
      const query = z
        .object({
          userId: z.string().min(1),
        })
        .parse(request.query ?? {});
      const organizationId = requireTenantId(app, request);
      const session = await getSipCredentialSession(app.prisma, organizationId, query.userId);
      if (!session) {
        throw app.httpErrors.notFound("SIP credentials are not configured for this user");
      }
      return session;
    });

    scoped.post(`${prefix}/sip-session/restore`, async (request) => {
      const query = z
        .object({
          userId: z.string().min(1),
        })
        .parse(request.query ?? {});
      const organizationId = requireTenantId(app, request);
      await restoreSipRegistrarPayload(app.prisma, organizationId, query.userId);
      const session = await getSipCredentialSession(app.prisma, organizationId, query.userId);
      if (!session) {
        throw app.httpErrors.notFound("SIP credentials are not configured for this user");
      }
      return { ok: true, redisKey: session.redisKey, redisRegistered: session.redisRegistered };
    });

    scoped.post(`${prefix}/agent-audit`, async (request) => {
      const body = recordAgentAuditSchema.parse(request.body ?? {});
      request.tenantId = body.organizationId;
      await withOrganizationContext(app.prisma, body.organizationId, (db) =>
        recordAgentAudit(db, body),
      );
      return { ok: true };
    });

    scoped.get(`${prefix}/organizations/:organizationId/webchat/default`, async (request) => {
      const { organizationId } = request.params as { organizationId: string };
      request.tenantId = organizationId;
      const resolved = await withStaffContext(app.prisma, async (db) =>
        resolveDefaultActiveWebchatId(db, organizationId),
      );
      if (!resolved) {
        throw app.httpErrors.notFound("No active webchat for organization");
      }
      return resolved;
    });

    scoped.get(`${prefix}/webchat/:webchatId/context`, async (request) => {
      const { webchatId } = request.params as { webchatId: string };
      const context = await withStaffContext(app.prisma, async (db) =>
        resolveWebchatContext(db, webchatId),
      );
      if (!context) {
        throw app.httpErrors.notFound("Webchat configuration not found");
      }
      request.tenantId = context.organizationId;
      return { context };
    });

    scoped.post(`${prefix}/webchat/:webchatId/sessions/resume`, async (request) => {
      const { webchatId } = request.params as { webchatId: string };
      const body = z
        .object({
          visitorId: z.string().min(1),
          organizationId: entityIdSchema.optional(),
        })
        .parse(request.body ?? {});

      const webchatContext = await withStaffContext(app.prisma, async (db) =>
        resolveWebchatContext(db, webchatId),
      );
      if (!webchatContext) {
        throw app.httpErrors.notFound("Webchat configuration not found");
      }
      const organizationId = body.organizationId ?? webchatContext.organizationId;
      request.tenantId = organizationId;

      const resumed = await withOrganizationContext(app.prisma, organizationId, (db) =>
        resumeWebchatSession(db, organizationId, {
          webchatId,
          visitorId: body.visitorId,
        }),
      );
      if (!resumed) {
        return { resumed: false as const, conversation: null, messages: [] };
      }
      return resumed;
    });

    scoped.post(`${prefix}/conversations/:id/session/disconnect`, async (request) => {
      const { id } = request.params as { id: string };
      const body = z
        .object({
          organizationId: entityIdSchema,
          graceSeconds: z.number().int().positive().max(3600).optional(),
        })
        .parse(request.body ?? {});
      request.tenantId = body.organizationId;
      await withOrganizationContext(app.prisma, body.organizationId, (db) =>
        markWebchatSessionDisconnected(db, body.organizationId, id, {
          graceSeconds: body.graceSeconds,
        }),
      );
      return { ok: true };
    });

    scoped.post(`${prefix}/conversations`, async (request) => {
      try {
        const body = startConversationSchema.parse(request.body);
        const webchatContext = await withStaffContext(app.prisma, async (db) =>
          resolveWebchatContext(db, body.webchatId),
        );
        if (!webchatContext) {
          throw app.httpErrors.notFound("Webchat configuration not found");
        }

        const organizationId = webchatContext.organizationId;
        const queueId = body.queueId ?? webchatContext.routingQueueId;

        const result = await withOrganizationContext(app.prisma, organizationId, async (db) => {
          const started = await startConversation(
            db,
            organizationId,
            {
              ...body,
              queueId,
              nlpEnabled: body.nlpEnabled ?? webchatContext.nlpEnabled,
              liveAgentEnabled: body.liveAgentEnabled ?? webchatContext.liveAgentEnabled,
            },
            { deferSideEffects: true },
          );
          const greetingMessage =
            body.greetingBody && started.conversation.botActive !== false
              ? (
                  await appendConversationMessage(
                    db,
                    organizationId,
                    started.conversation.id,
                    {
                      senderType: "bot",
                      body: body.greetingBody,
                      direction: "outbound",
                      visibility: "customer",
                    },
                    { deferProjection: true },
                  )
                ).message
              : null;
          return { ...started, greetingMessage };
        });

        void withOrganizationContext(app.prisma, organizationId, async (db) => {
          await projectInteractionEvent(db, organizationId, {
            conversationId: result.conversation.id,
            eventType: "conversation.started",
            metadata: {
              webchatId: body.webchatId,
              visitorId: body.visitorId,
              channel: "webchat",
            },
          });
          if (body.nlpEnabled ?? webchatContext.nlpEnabled) {
            await ensureNlpConversation(
              db,
              organizationId,
              result.conversation.id,
              "webchat_bot",
            );
          }
          if (result.greetingMessage) {
            await projectInteractionEvent(db, organizationId, {
              conversationId: result.conversation.id,
              messageId: result.greetingMessage.id,
              eventType: "message.created",
              metadata: { senderType: "bot", direction: "outbound" },
            });
          }
        }).catch((error) => {
          app.log.warn({ error, conversationId: result.conversation.id }, "Deferred webchat projection failed");
        });

        return result;
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.get(`${prefix}/conversations/:id`, async (request) => {
      const organizationId = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      const conversation = await withOrganizationContext(app.prisma, organizationId, (db) =>
        getConversation(db, organizationId, id),
      );
      if (!conversation) {
        throw app.httpErrors.notFound("Conversation not found");
      }
      const messages = await withOrganizationContext(app.prisma, organizationId, (db) =>
        listConversationMessages(db, organizationId, id),
      );
      return { conversation, messages };
    });

    scoped.get(`${prefix}/conversations/:id/state`, async (request) => {
      const organizationId = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      const state = await withOrganizationContext(app.prisma, organizationId, async (db) => {
        const conversation = await getConversation(db, organizationId, id);
        if (!conversation) {
          return { conversation: null, contact: null };
        }
        const contact = await resolveConversationContact(db, organizationId, conversation);
        return { conversation, contact };
      });
      const { conversation, contact } = state;
      if (!conversation) {
        throw app.httpErrors.notFound("Conversation not found");
      }
      return { conversation, contact };
    });

    scoped.post(`${prefix}/conversations/:id/messages`, async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = appendMessageSchema.parse(request.body);
        const deferContactEnrichment =
          payload.senderType === "customer" && payload.direction === "inbound";
        const { message, reopened } = await withOrganizationContext(app.prisma, organizationId, (db) =>
          appendConversationMessage(db, organizationId, id, payload, {
            deferProjection: true,
            deferContactEnrichment,
          }),
        );
        emitMessageCreated(organizationId, id, message);
        if (payload.senderType === "customer" || payload.senderType === "agent") {
          scheduleConversationMessageSentiment(
            app.prisma,
            organizationId,
            id,
            message.id,
            payload.senderType,
            payload.body,
          );
        }
        if (deferContactEnrichment) {
          const conversation = await withOrganizationContext(app.prisma, organizationId, (db) =>
            getConversation(db, organizationId, id),
          );
          if (conversation) {
            scheduleDeferredCustomerContactEnrichment(app, organizationId, id, {
              messageId: message.id,
              body: payload.body,
              botActive: conversation.botActive,
            });
          }
        }
        if (reopened) {
          const conversation = await withOrganizationContext(app.prisma, organizationId, (db) =>
            getConversation(db, organizationId, id),
          );
          if (conversation) {
            emitConversationReopened(organizationId, conversation);
          }
        }
        void withOrganizationContext(app.prisma, organizationId, async (db) => {
          await projectInteractionEvent(db, organizationId, {
            conversationId: id,
            messageId: message.id,
            eventType: "message.created",
            metadata: {
              senderType: payload.senderType,
              direction: payload.direction,
            },
          });
          if (reopened) {
            await projectInteractionEvent(db, organizationId, {
              conversationId: id,
              eventType: "conversation.reopened",
              metadata: { reason: "customer_message" },
            });
          }
        }).catch((error) => {
          app.log.warn({ error, conversationId: id }, "Deferred message projection failed");
        });
        return { message, reopened };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/receipts`, async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = messageReceiptSchema.parse(request.body);
        const receipt = await withOrganizationContext(app.prisma, organizationId, (db) =>
          recordMessageReceipt(db, organizationId, id, payload),
        );
        emitMessageReceiptUpdated(organizationId, id, receipt);
        return { receipt };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/messages/:messageId/attachments`, async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const { id, messageId } = request.params as { id: string; messageId: string };
        const payload = attachmentMetadataSchema.parse(request.body);
        const attachment = await withOrganizationContext(app.prisma, organizationId, (db) =>
          addMessageAttachmentMetadata(db, organizationId, id, messageId, payload),
        );
        return { attachment };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/typing`, async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = z
          .object({
            participant: z.literal("visitor"),
            active: z.boolean(),
          })
          .parse(request.body);
        const conversation = await withOrganizationContext(app.prisma, organizationId, (db) =>
          getConversation(db, organizationId, id),
        );
        if (!conversation) throw Object.assign(new Error("Conversation not found"), { status: 404 });
        emitTypingUpdated(organizationId, id, payload.participant, payload.active);
        return { accepted: true };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/handoff`, async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = handoffSchema.parse(request.body);
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          initiateHandoff(db, organizationId, id, payload, {
            deferSideEffects: true,
          }),
        );
        if (result.assignment) {
          notifyConversationRouted(app, organizationId, result.conversation, result.assignment.userId);
        } else if (result.queued) {
          emitConversationQueued(organizationId, result.conversation);
        }
        if (result.systemMessage) {
          emitMessageCreated(organizationId, id, result.systemMessage);
          await withOrganizationContext(app.prisma, organizationId, (db) =>
            deliverPersistedMessageToWebchat(db, {
              organizationId,
              conversationId: id,
              body: result.systemMessage!.body,
              messageId: result.systemMessage!.id,
              senderType: "system",
              webchatId: result.conversation.webchatId,
              visitorId: result.conversation.visitorId,
            }),
          );
        }
        void withOrganizationContext(app.prisma, organizationId, async (db) => {
          await endNlpConversation(db, organizationId, id, payload.reason);
          if (result.systemMessage) {
            await projectInteractionEvent(db, organizationId, {
              conversationId: id,
              messageId: result.systemMessage.id,
              eventType: "message.created",
              metadata: { senderType: "system", direction: "outbound" },
            });
          }
          await projectInteractionEvent(db, organizationId, {
            conversationId: id,
            eventType: result.assignment ? "conversation.assigned" : "conversation.queued",
            metadata: {
              reason: payload.reason,
              queueId: result.conversation.queueId,
              agentId: result.assignment?.agentId ?? null,
            },
          });
        }).catch((error) => {
          app.log.warn({ error, conversationId: id }, "Deferred handoff projection failed");
        });
        return result;
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/end`, async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = endConversationSchema.parse(request.body);
        if (payload.actor === "agent") {
          throw Object.assign(new Error("Agent endings use the authenticated workspace endpoint"), {
            status: 400,
          });
        }
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          endConversation(db, organizationId, null, id, payload),
        );
        // Customer left while an offer was ringing: cancel the timer and clear
        // the offer from the agent's workspace.
        await clearPendingOfferExpiration(app, organizationId, id);
        for (const releasedUserId of result.releasedOfferUserIds) {
          emitConversationRejected(organizationId, result.conversation, releasedUserId);
        }
        if (result.cancelledTransfer) {
          emitTransferCancelled(
            organizationId,
            result.cancelledTransfer,
            result.releasedOfferUserIds[0] ?? null,
            result.conversation,
          );
        }
        emitConversationEnded(organizationId, result.conversation);
        return { conversation: result.conversation };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/nlp-turns`, async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = recordNlpTurnSchema.parse(request.body);
        const turn = await withOrganizationContext(app.prisma, organizationId, (db) =>
          recordNlpTurn(db, organizationId, id, payload),
        );
        return { turn };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.get(`${prefix}/conversations/:id/nlp-turns`, async (request) => {
      const organizationId = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      const turns = await withOrganizationContext(app.prisma, organizationId, (db) =>
        listNlpTurns(db, organizationId, id),
      );
      return { turns };
    });

    scoped.get(`${prefix}/conversations/:id/memory`, async (request) => {
      const organizationId = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      const query = request.query as { turnLimit?: string };
      const turnLimit = query.turnLimit ? Number.parseInt(query.turnLimit, 10) : undefined;
      const memory = await withOrganizationContext(app.prisma, organizationId, (db) =>
        getSessionMemory(db, organizationId, id, { turnLimit }),
      );
      return memory;
    });

    scoped.put(`${prefix}/conversations/:id/memory`, async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = upsertConversationMemorySchema.parse(request.body);
        const memory = await withOrganizationContext(app.prisma, organizationId, (db) =>
          upsertConversationMemory(db, organizationId, id, payload),
        );
        return { memory };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.get(`${prefix}/contacts/:contactId/channel-summaries`, async (request) => {
      const organizationId = requireTenantId(app, request);
      const { contactId } = request.params as { contactId: string };
      return withOrganizationContext(app.prisma, organizationId, async (db) => {
        const [channelSummaries, omni] = await Promise.all([
          listContactChannelSummaries(db, organizationId, contactId),
          getContactOmniChannelSummary(db, organizationId, contactId),
        ]);
        return {
          channelSummaries,
          omniChannelSummary: omni.omniChannelSummary,
        };
      });
    });

    scoped.get(`${prefix}/contacts/resolve`, async (request) => {
      const organizationId = requireTenantId(app, request);
      const query = request.query as { email?: string; phone?: string };
      const resolved = await withOrganizationContext(app.prisma, organizationId, (db) =>
        resolveContactByIdentifiers(db, organizationId, {
          email: query.email,
          phone: query.phone,
        }),
      );
      if (!resolved) {
        throw app.httpErrors.notFound("Contact not found");
      }
      const contact = await withOrganizationContext(app.prisma, organizationId, (db) =>
        getContact(db, organizationId, resolved.contactId),
      );
      return { contactId: resolved.contactId, contact };
    });

    scoped.post(`${prefix}/conversations/:id/bot-callback`, async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = z
          .object({
            summary: z.string().min(1).max(2000),
            notes: z.string().max(4000).optional(),
            preferredTime: z.string().max(200).optional(),
            assignedUserId: z.string().min(1),
          })
          .parse(request.body);
        const task = await withOrganizationContext(app.prisma, organizationId, (db) =>
          createProactiveCallbackTask(db, organizationId, {
            assignedUserId: payload.assignedUserId,
            conversationId: id,
            summary: payload.summary,
            notes: payload.notes,
            dueAt: payload.preferredTime,
          }),
        );
        return { taskId: String(task.id) };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.put(`${prefix}/contacts/:contactId/omni-channel-summary`, async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const { contactId } = request.params as { contactId: string };
        const payload = upsertOmniChannelSummarySchema.parse(request.body);
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          upsertOmniChannelSummary(db, organizationId, contactId, payload.omniChannelSummary),
        );
        return { contactId, omniChannelSummary: payload.omniChannelSummary };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.get(`${prefix}/organizations/:id/details`, async (request) => {
      const organizationId = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      if (id !== organizationId) {
        throw app.httpErrors.forbidden("Tenant header does not match organization");
      }
      const details = await withOrganizationContext(app.prisma, organizationId, (db) =>
        getOrganizationDetails(db, organizationId),
      );
      if (!details) {
        throw app.httpErrors.notFound("Organization not found");
      }
      return details;
    });

    scoped.get(`${prefix}/organizations/:id/knowledge`, async (request) => {
      const organizationId = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      if (id !== organizationId) {
        throw app.httpErrors.forbidden("Tenant header does not match organization");
      }
      const documents = await withOrganizationContext(app.prisma, organizationId, (db) =>
        listOrganizationKnowledge(db, organizationId),
      );
      return {
        documents: documents.map((doc) => ({
          documentId: doc.documentId,
          title: doc.title,
          fileName: doc.fileName,
          text: doc.text,
          tokenEstimate: doc.tokenEstimate,
        })),
      };
    });

    scoped.post(`${prefix}/organizations/:id/knowledge/documents/:documentId/extract`, async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const { id, documentId } = request.params as { id: string; documentId: string };
        if (id !== organizationId) {
          throw app.httpErrors.forbidden("Tenant header does not match organization");
        }
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          extractKnowledgeDocumentText(db, organizationId, documentId),
        );
        return { result };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/contact/enrich`, async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const conversationId = await withOrganizationContext(app.prisma, organizationId, (db) =>
          resolveConversationIdForEnrich(db, organizationId, id),
        );
        if (!conversationId) {
          throw app.httpErrors.notFound("Conversation not found");
        }
        const payload = enrichConversationContactSchema.parse(request.body);
        const enrichInput = mergeContactCaptureSources({
          customerText: payload.customerText,
          importantFacts: payload.importantFacts,
          contactEntities: payload.contactEntities,
        });
        const mergedEnrich = {
          email: payload.email ?? enrichInput.email,
          phone: payload.phone ?? enrichInput.phone,
          firstName: payload.firstName ?? enrichInput.firstName,
          lastName: payload.lastName ?? enrichInput.lastName,
          displayName: payload.displayName ?? enrichInput.displayName,
          company: payload.company ?? enrichInput.company,
          city: payload.city ?? enrichInput.city,
          country: payload.country ?? enrichInput.country,
          sourceMessageId: payload.sourceMessageId,
          confirmedFields: payload.confirmedFields,
        };
        if (!hasEnrichableContactData(mergedEnrich)) {
          return { result: null };
        }
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          enrichContactFromConversation(db, organizationId, conversationId, mergedEnrich),
        );
        if (!result) {
          throw app.httpErrors.notFound("Conversation not found");
        }
        if (
          result.outcome !== "no_change" &&
          result.outcome !== "confirmation_required" &&
          !result.idempotentReplay
        ) {
          emitContactEnriched(organizationId, conversationId, result);
        }
        return { result };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.get(`${prefix}/copilot/sessions/active`, async (request) => {
      const organizationId = requireTenantId(app, request);
      const query = request.query as { userId?: string; conversationId?: string; limit?: string };
      if (!query.userId) {
        throw app.httpErrors.badRequest("userId is required");
      }
      const limit = query.limit ? Number.parseInt(query.limit, 10) : 20;
      const turns = await withOrganizationContext(app.prisma, organizationId, (db) =>
        listActiveCopilotTurns(
          db,
          organizationId,
          query.userId!,
          query.conversationId ?? null,
          limit,
        ),
      );
      return { turns };
    });

    scoped.post(`${prefix}/social/conversations`, async (request) => {
      try {
        const payload = ingestInboundSocialSchema.parse(request.body);
        const headerTenant = request.headers["x-tenant-id"];
        if (typeof headerTenant === "string" && headerTenant !== payload.organizationId) {
          throw app.httpErrors.forbidden("Tenant header does not match payload organization");
        }
        request.tenantId = payload.organizationId;

        const result = await withOrganizationContext(
          app.prisma,
          payload.organizationId,
          async (db) => ingestInboundSocialConversation(db, payload),
        );

        if (!result.duplicate) {
          emitMessageCreated(payload.organizationId, result.conversation.id, result.message);
          scheduleConversationMessageSentiment(
            app.prisma,
            payload.organizationId,
            result.conversation.id,
            result.message.id,
            result.message.senderType,
            result.message.body,
          );
        }
        if (!result.duplicate && result.assignment) {
          notifyConversationRouted(
            app,
            payload.organizationId,
            result.conversation,
            result.assignment.userId,
          );
        } else if (!result.duplicate && result.queued) {
          emitConversationQueued(payload.organizationId, result.conversation);
          if (!result.conversation.queueId) {
            app.log.warn(
              {
                organizationId: payload.organizationId,
                conversationId: result.conversation.id,
                channel: result.conversation.channel,
              },
              "social conversation queued without a channel-enabled queue",
            );
          }
        }

        if (!result.duplicate && !result.conversation.botActive) {
          scheduleDeferredCustomerContactEnrichment(
            app,
            payload.organizationId,
            result.conversation.id,
            {
              messageId: result.message.id,
              body: payload.body,
              botActive: false,
            },
          );
        }

        return {
          conversationId: result.conversation.id,
          messageId: result.message.id,
          created: result.created,
          duplicate: result.duplicate,
          botEligible: result.botEligible,
          policy: result.policy,
          conversation: result.conversation,
        };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/email/conversations`, async (request) => {
      try {
        const payload = ingestInboundEmailSchema.parse(request.body);
        const headerTenant = request.headers["x-tenant-id"];
        if (typeof headerTenant === "string" && headerTenant !== payload.organizationId) {
          throw app.httpErrors.forbidden("Tenant header does not match payload organization");
        }
        request.tenantId = payload.organizationId;

        const result = await withOrganizationContext(
          app.prisma,
          payload.organizationId,
          async (db) => ingestInboundEmailConversation(db, payload),
        );

        if (!result.duplicate) {
          emitMessageCreated(payload.organizationId, result.conversation.id, result.message);
          scheduleConversationMessageSentiment(
            app.prisma,
            payload.organizationId,
            result.conversation.id,
            result.message.id,
            result.message.senderType,
            result.message.body,
          );
        }
        if (!result.duplicate && result.assignment) {
          notifyConversationRouted(
            app,
            payload.organizationId,
            result.conversation,
            result.assignment.userId,
          );
        } else if (!result.duplicate && result.queued) {
          emitConversationQueued(payload.organizationId, result.conversation);
          if (!result.conversation.queueId) {
            app.log.warn(
              {
                organizationId: payload.organizationId,
                conversationId: result.conversation.id,
              },
              "email conversation queued without an email-enabled queue",
            );
          }
        }

        return {
          conversationId: result.conversation.id,
          messageId: result.message.id,
          created: result.created,
          duplicate: result.duplicate,
          conversation: result.conversation,
          automation: result.automation,
        };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/email/conversations/:id/bot-decision`, async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const { id } = z.object({ id: entityIdSchema }).parse(request.params);
        const payload = commitEmailBotDecisionSchema.parse(request.body);
        return await withOrganizationContext(app.prisma, organizationId, (db) =>
          commitEmailBotDecision(db, organizationId, id, payload),
        );
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/email/deliveries/claim`, async (request) => {
      const body = z.object({ limit: z.number().int().min(1).max(50).default(10) }).parse(
        request.body ?? {},
      );
      const deliveries = await withStaffContext(app.prisma, (db) =>
        claimDueEmailDeliveries(db, body.limit),
      );
      return { deliveries };
    });

    scoped.patch(`${prefix}/email/deliveries/:id`, async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const { id } = z.object({ id: entityIdSchema }).parse(request.params);
        const payload = updateEmailDeliverySchema.parse(request.body);
        const updated = await withOrganizationContext(app.prisma, organizationId, (db) =>
          updateEmailDelivery(db, organizationId, id, payload),
        );
        if (!updated) throw app.httpErrors.notFound("Email delivery not found");
        return { updated: true };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/sql`, async (request) => {
      try {
        const organizationId = requireTenantId(app, request);
        const { sql, description } = z
          .object({
            sql: z.string(),
            description: z.string().optional(),
          })
          .parse(request.body);

        return await withOrganizationContext(app.prisma, organizationId, async (db) => {
          const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(sql);
          return {
            success: true,
            description,
            rowCount: Array.isArray(rows) ? rows.length : 0,
            rows,
          };
        });
      } catch (error) {
        handleRouteError(app, error);
      }
    });
  });
}
