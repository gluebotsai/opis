import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { z } from "zod";

import { isCallChannel } from "../lib/channels.js";
import { jsonStringifyEntityPayload } from "../lib/id-schema.js";
import { withOrganizationContext } from "../lib/rls.js";
import { getConversationMemory, getSessionMemory } from "../services/conversation-memory.js";
import {
  assertContactConversationReadAccess,
  getContactCrossChannelSummary,
  listContactInteractions,
} from "../services/contact-interactions.js";
import { getContact } from "../services/contacts.js";
import {
  enrichContactFromConversation,
  ensureNamedCallContact,
  mergeContactCaptureSources,
} from "../services/contact-identity.js";
import {
  getContactOmniChannelSummary,
  scheduleOmniChannelSummaryRefresh,
} from "../services/omni-channel-summary.js";
import { listCustomerOrders } from "../services/customer-orders.js";
import { listCustomerTickets } from "../services/customer-tickets.js";
import {
  buildAgentSessionTranscript,
  filterAgentSessionMessages,
  mapContextMessage,
  suggestWrapUpFromNlp,
} from "../services/wrap-up-suggest.js";
import {
  getLatestConversationSentiment,
  scheduleConversationMessageSentiment,
  scheduleSessionSentimentOnDisposition,
  summarizeSessionSentimentForDisposition,
} from "../services/sentiment-analysis.js";
import { scheduleFollowUpExtractionOnConversationEnd } from "../services/follow-up-extraction.js";
import {
  acceptConversationOffer,
  cancelWarmTransfer,
  completeTransferSchema,
  completeWarmTransfer,
  addMessageAttachmentMetadata,
  assertWorkspaceConversationAccess,
  attachmentMetadataSchema,
  endConversation,
  endConversationSchema,
  getConversation,
  interactionsQuerySchema,
  listConversationMessages,
  listConversationMessagesPaginated,
  listConversationTransferTargets,
  listDispositions,
  listQuerySchema,
  listVisitorInteractions,
  enrichConversationsWithPendingOffer,
  enrichWorkspaceConversationPresentation,
  formatQueueDisplayLabel,
  listWorkspaceConversations,
  resolveQueueDisplayNames,
  messagesQuerySchema,
  messageReceiptSchema,
  recordMessageReceipt,
  rejectConversationOffer,
  resolveConversation,
  saveConversationDisposition,
  saveDispositionSchema,
  sendAgentReply,
  transferConversation,
  transferConversationSchema,
  transferTargetsQuerySchema,
} from "../services/conversations.js";
import {
  emitConversationAccepted,
  emitConversationDispositionSaved,
  emitConversationEnded,
  emitConversationQueued,
  emitConversationRejected,
  emitConversationResolved,
  emitConversationTransferAccepted,
  emitConversationTransferred,
  emitMessageCreated,
  emitMessageReceiptUpdated,
  emitPresenceUpdatedForAgent,
  emitTypingUpdated,
  emitTransferAccepted,
  emitTransferCancelled,
  emitTransferCompleted,
  emitTransferOffered,
  emitTransferRejected,
} from "../services/realtime.js";
import { getAgentPresenceForUser } from "../services/presence.js";
import {
  deliverPersistedMessageToWebchat,
  deliverRealtimeEventToWebchat,
} from "../services/chat-delivery.js";
import { deliverPersistedMessageToEmail } from "../services/email-delivery.js";
import {
  deliverPersistedMessageToSocial,
  deliverPersistedMessageToWhatsApp,
} from "../services/social-delivery.js";
import {
  linkCopilotTurnToMessage,
  listActiveCopilotTurns,
  recordCopilotTurn,
  recordCopilotTurnSchema,
} from "../services/copilot-turns.js";
import {
  clearPendingOfferExpiration,
  notifyConversationRouted,
} from "../services/offer-lifecycle.js";
import {
  createCommonNote,
  createConversationNote,
  createWorkspaceNoteSchema,
  listCommonNotes,
  listVisitorNotes,
} from "../services/workspace-notes.js";
import { entityIdSchema } from "../lib/id-schema.js";
import {
  ensureVoiceCallForUser,
  finalizeVoiceCallForUser,
  getActiveVoiceCallForUser,
  publishVoiceCallControlForConversation,
} from "../services/umn-call-session.js";
import {
  inviteVoiceConsultTransfer,
  markVoiceConsultAnswered,
  publishVoiceTransferAction,
  rejectVoiceConsultTransfer,
  voiceTransferActionSchema,
  voiceTransferInviteSchema,
} from "../services/umn-voice-transfer.js";
import {
  publishSupervisorListen,
  publishSupervisorListenCancel,
  publishSupervisorMonitorSwitch,
} from "../services/umn-voice-supervisor.js";
import {
  supervisorActionSchema,
  supervisorForceClose,
  supervisorReassign,
  supervisorTakeover,
} from "../services/supervisor-actions.js";

function requireTenantId(
  app: FastifyInstance,
  request: { tenantId?: string; userId?: string },
): { organizationId: string; userId: string } {
  if (!request.tenantId || !request.userId) {
    throw app.httpErrors.unauthorized("Missing tenant or user context");
  }
  return { organizationId: request.tenantId, userId: request.userId };
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
    if (status === 403) throw app.httpErrors.forbidden(message);
    if (status === 400) throw app.httpErrors.badRequest(message);
  }
  throw error;
}

/** Workspace assignment check, or contact-linked read when `contactId` is provided. */
async function assertConversationReadAccess(
  app: FastifyInstance,
  organizationId: string,
  userId: string,
  conversationId: string,
  role: string | null | undefined,
  contactId: string | null | undefined,
): Promise<void> {
  const linkedContactId = contactId?.trim() || null;
  await withOrganizationContext(app.prisma, organizationId, async (db) => {
    if (linkedContactId) {
      await assertContactConversationReadAccess(
        db,
        organizationId,
        linkedContactId,
        conversationId,
      );
      return;
    }
    await assertWorkspaceConversationAccess(db, organizationId, userId, conversationId, role);
  });
}

const replySchema = z.object({
  body: z.string().min(1),
  copilotTurnId: entityIdSchema.optional(),
});

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const prefix = joinApiV1(apiV1Base, "/workspace");

    scoped.get(`${prefix}/conversations`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const query = listQuerySchema.parse(request.query);
      const { conversations, contactsById, hasMore } = await withOrganizationContext(
        app.prisma,
        organizationId,
        async (db) => {
          const listed = await listWorkspaceConversations(db, organizationId, userId, query);
          const withOffers = await enrichConversationsWithPendingOffer(
            db,
            organizationId,
            userId,
            listed.conversations,
          );
          const enriched = await enrichWorkspaceConversationPresentation(
            db,
            organizationId,
            withOffers,
          );
          const contacts = new Map<string, Awaited<ReturnType<typeof getContact>>>();
          const withNamedContacts = await Promise.all(
            enriched.map(async (conversation) => {
              if (!isCallChannel(conversation.channel) || !conversation.visitorId) {
                return conversation;
              }
              const contact = await ensureNamedCallContact(db, organizationId, conversation);
              if (!contact) return conversation;
              contacts.set(contact.id, contact);
              if (contact.id === conversation.contactId) return conversation;
              return { ...conversation, contactId: contact.id };
            }),
          );
          const contactIds = [
            ...new Set(
              withNamedContacts
                .map((conversation) => conversation.contactId)
                .filter((contactId): contactId is string => Boolean(contactId)),
            ),
          ].filter((contactId) => !contacts.has(contactId));
          const loaded = await Promise.all(
            contactIds.map(async (contactId) => {
              const contact = await getContact(db, organizationId, contactId);
              return contact ? ([contactId, contact] as const) : null;
            }),
          );
          for (const entry of loaded) {
            if (entry) contacts.set(entry[0], entry[1]);
          }
          return {
            conversations: withNamedContacts,
            contactsById: contacts,
            hasMore: listed.hasMore,
          };
        },
        { timeoutMs: 60_000 },
      );
      return {
        conversations: conversations.map((conversation) => ({
          ...conversation,
          contact: conversation.contactId
            ? contactsById.get(conversation.contactId) ?? null
            : null,
        })),
        hasMore,
      };
    });

    scoped.get(`${prefix}/dispositions`, async (request) => {
      const { organizationId } = requireTenantId(app, request);
      const dispositions = await withOrganizationContext(app.prisma, organizationId, (db) =>
        listDispositions(db, organizationId),
      );
      return { dispositions };
    });

    scoped.get(`${prefix}/conversations/:id/wrap-up-suggest`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      await withOrganizationContext(app.prisma, organizationId, (db) =>
        assertWorkspaceConversationAccess(db, organizationId, userId, id, request.userRole),
      );
      // Load DB data in a short txn; NLP must not hold an interactive transaction open.
      const loaded = await withOrganizationContext(app.prisma, organizationId, async (db) => {
        const conversation = await getConversation(db, organizationId, id);
        if (!conversation) {
          throw app.httpErrors.notFound("Conversation not found");
        }
        const [messages, dispositions] = await Promise.all([
          listConversationMessages(db, organizationId, id),
          listDispositions(db, organizationId),
        ]);
        return {
          conversation,
          transcript: buildAgentSessionTranscript(messages, conversation.assignedAt),
          dispositions,
        };
      });
      const suggestion = await suggestWrapUpFromNlp({
        organizationId,
        conversation: loaded.conversation,
        transcript: loaded.transcript,
        dispositions: loaded.dispositions,
      });
      return { suggestion, transcriptCount: loaded.transcript.length };
    });

    scoped.get(`${prefix}/conversations/:id/messages`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      const query = messagesQuerySchema.parse(request.query);
      const contactId = (request.query as { contactId?: string }).contactId;
      try {
        await assertConversationReadAccess(
          app,
          organizationId,
          userId,
          id,
          request.userRole,
          contactId,
        );
      } catch (error) {
        handleRouteError(app, error);
      }
      const page = await withOrganizationContext(app.prisma, organizationId, (db) =>
        listConversationMessagesPaginated(db, organizationId, id, query),
      );
      return page;
    });

    scoped.get(`${prefix}/visitors/:visitorId/interactions`, async (request) => {
      const { organizationId } = requireTenantId(app, request);
      const { visitorId } = request.params as { visitorId: string };
      const query = interactionsQuerySchema.parse(request.query);
      const page = await withOrganizationContext(app.prisma, organizationId, (db) =>
        listVisitorInteractions(db, organizationId, visitorId, query),
      );
      const queueNames = await withOrganizationContext(app.prisma, organizationId, (db) =>
        resolveQueueDisplayNames(
          db,
          organizationId,
          page.interactions.map((interaction) => interaction.queueId),
        ),
      );
      return {
        interactions: page.interactions.map((interaction) => ({
          id: interaction.id,
          conversationId: interaction.conversationId,
          messageId: interaction.messageId,
          channel: interaction.channel === "webchat" ? "chat" : interaction.channel,
          queue: formatQueueDisplayLabel(
            interaction.queueId,
            interaction.queueId ? queueNames.get(interaction.queueId) : null,
          ),
          subject: interaction.subject ?? "Webchat conversation",
          summary: interaction.summary,
          occurredAt: interaction.occurredAt,
        })),
        total: page.total,
        offset: page.offset,
        hasMore: page.hasMore,
      };
    });

    scoped.get(`${prefix}/conversations/:id`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      const includeMessages =
        (request.query as { includeMessages?: string }).includeMessages === "true";
      const contactId = (request.query as { contactId?: string }).contactId;
      try {
        await assertConversationReadAccess(
          app,
          organizationId,
          userId,
          id,
          request.userRole,
          contactId,
        );
      } catch (error) {
        handleRouteError(app, error);
      }
      const conversation = await withOrganizationContext(app.prisma, organizationId, async (db) => {
        const row = await getConversation(db, organizationId, id);
        if (!row) return null;
        const [withOffer] = await enrichConversationsWithPendingOffer(db, organizationId, userId, [
          row,
        ]);
        const [enriched] = await enrichWorkspaceConversationPresentation(db, organizationId, [
          withOffer ?? row,
        ]);
        const presented = enriched ?? withOffer ?? row;
        if (!isCallChannel(presented.channel) || !presented.visitorId) return presented;
        const named = await ensureNamedCallContact(db, organizationId, presented);
        if (!named || named.id === presented.contactId) return presented;
        return { ...presented, contactId: named.id };
      });
      if (!conversation) {
        throw app.httpErrors.notFound("Conversation not found");
      }
      const botMemory = await withOrganizationContext(app.prisma, organizationId, (db) =>
        getConversationMemory(db, organizationId, id),
      );
      const contact =
        conversation.contactId
          ? await withOrganizationContext(app.prisma, organizationId, (db) =>
              getContact(db, organizationId, conversation.contactId!),
            )
          : null;
      const messages = includeMessages
        ? await withOrganizationContext(app.prisma, organizationId, (db) =>
            listConversationMessages(db, organizationId, id),
          )
        : [];
      return {
        conversation,
        contact,
        messages,
        botMemory: botMemory
          ? {
              rollingSummary: botMemory.rollingSummary,
              extractedFacts: botMemory.extractedFacts,
            }
          : null,
        sentiment: await withOrganizationContext(app.prisma, organizationId, (db) =>
          getLatestConversationSentiment(db, organizationId, id),
        ),
      };
    });

    scoped.get(`${prefix}/conversations/:id/sentiment`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      try {
        await assertConversationReadAccess(
          app,
          organizationId,
          userId,
          id,
          request.userRole,
          undefined,
        );
      } catch (error) {
        handleRouteError(app, error);
      }
      const sentiment = await withOrganizationContext(app.prisma, organizationId, (db) =>
        getLatestConversationSentiment(db, organizationId, id),
      );
      return { sentiment };
    });

    scoped.post(`${prefix}/conversations/:id/sentiment/session`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          assertWorkspaceConversationAccess(db, organizationId, userId, id, request.userRole),
        );
        const sentiment = await summarizeSessionSentimentForDisposition(
          app.prisma,
          organizationId,
          id,
        );
        return { sentiment };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.get(`${prefix}/contacts/:contactId/interactions`, async (request) => {
      const { organizationId } = requireTenantId(app, request);
      const { contactId } = request.params as { contactId: string };
      const query = interactionsQuerySchema.parse(request.query);
      const page = await withOrganizationContext(app.prisma, organizationId, (db) =>
        listContactInteractions(db, organizationId, contactId, {
          offset: query.offset,
          limit: query.limit,
        }),
      );
      const queueNames = await withOrganizationContext(app.prisma, organizationId, (db) =>
        resolveQueueDisplayNames(
          db,
          organizationId,
          page.interactions.map((interaction) => interaction.queueId),
        ),
      );
      return {
        interactions: page.interactions.map((interaction) => ({
          id: interaction.id,
          conversationId: interaction.conversationId,
          messageId: interaction.messageId ?? "",
          channel: interaction.channel === "webchat" ? "chat" : interaction.channel,
          queue: formatQueueDisplayLabel(
            interaction.queueId,
            interaction.queueId ? queueNames.get(interaction.queueId) : null,
          ),
          subject: interaction.subject ?? "Conversation",
          summary: interaction.summary,
          occurredAt: interaction.occurredAt,
          createdAt: interaction.createdAt,
          endedAt: interaction.endedAt,
          resolvedAt: interaction.resolvedAt,
          endReason: interaction.endReason,
          dispositionCode: interaction.dispositionCode,
          resolutionCode: interaction.resolutionCode,
          handoffReason: interaction.handoffReason,
          status: interaction.status,
          agentConnected: interaction.agentConnected,
          direction: interaction.direction,
          botMemory: interaction.botMemory,
        })),
        total: page.total,
        offset: page.offset,
        hasMore: page.hasMore,
      };
    });

    scoped.get(`${prefix}/contacts/:contactId/orders`, async (request) => {
      const { organizationId } = requireTenantId(app, request);
      const { contactId } = request.params as { contactId: string };
      const orders = await withOrganizationContext(app.prisma, organizationId, (db) =>
        listCustomerOrders(db, organizationId, contactId),
      );
      return { orders };
    });

    scoped.get(`${prefix}/contacts/:contactId/tickets`, async (request) => {
      const { organizationId } = requireTenantId(app, request);
      const { contactId } = request.params as { contactId: string };
      const tickets = await withOrganizationContext(app.prisma, organizationId, (db) =>
        listCustomerTickets(db, organizationId, contactId),
      );
      return { tickets };
    });

    scoped.get(`${prefix}/contacts/:contactId/omni-channel-summary`, async (request) => {
      const { organizationId } = requireTenantId(app, request);
      const { contactId } = request.params as { contactId: string };
      const summary = await withOrganizationContext(app.prisma, organizationId, (db) =>
        getContactOmniChannelSummary(db, organizationId, contactId),
      );
      return summary;
    });

    scoped.get(`${prefix}/conversations/:id/context`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const { id } = request.params as { id: string };
      await withOrganizationContext(app.prisma, organizationId, (db) =>
        assertWorkspaceConversationAccess(db, organizationId, userId, id, request.userRole),
      );
      const conversation = await withOrganizationContext(app.prisma, organizationId, (db) =>
        getConversation(db, organizationId, id),
      );
      if (!conversation) {
        throw app.httpErrors.notFound("Conversation not found");
      }
      const { messages, botMemory, contact, crossChannelSummary, sessionMemory } =
        await withOrganizationContext(app.prisma, organizationId, async (db) => {
          const loadedMessages = await listConversationMessages(db, organizationId, id);
          const loadedBotMemory = await getConversationMemory(db, organizationId, id);
          const loadedSessionMemory = await getSessionMemory(db, organizationId, id).catch(
            () => null,
          );
          let loadedContact =
            conversation.contactId
              ? await getContact(db, organizationId, conversation.contactId)
              : null;
          if (conversation.contactId && !loadedContact?.city?.trim()) {
            const customerTexts = loadedMessages
              .filter((message) => message.senderType === "customer")
              .map((message) => message.body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim())
              .filter(Boolean);
            const enrichInput = mergeContactCaptureSources({
              customerText: customerTexts.join("\n"),
              importantFacts: loadedBotMemory?.extractedFacts ?? [],
            });
            if (enrichInput.city || enrichInput.country) {
              const enriched = await enrichContactFromConversation(
                db,
                organizationId,
                id,
                enrichInput,
              );
              loadedContact = enriched?.contact ?? loadedContact;
            }
          }
          const loadedCrossChannelSummary =
            conversation.contactId
              ? await getContactCrossChannelSummary(
                  db,
                  organizationId,
                  conversation.contactId,
                  5,
                  userId,
                )
              : [];
          return {
            messages: loadedMessages,
            botMemory: loadedBotMemory,
            sessionMemory: loadedSessionMemory,
            contact: loadedContact,
            crossChannelSummary: loadedCrossChannelSummary,
          };
        });
      const visibleMessages = messages
        .filter((message) => message.visibility === "customer")
        .slice(-50);
      const agentSessionMessages = filterAgentSessionMessages(
        messages,
        conversation.assignedAt,
      ).slice(-50);
      const liveAgentConnected =
        conversation.lifecycleState === "connected" ||
        conversation.status === "active" ||
        Boolean(conversation.assignedAt);
      return {
        context: {
          conversation,
          messages: visibleMessages.map(mapContextMessage),
          agentSession: {
            liveAgentConnected,
            assignedAt: conversation.assignedAt,
            messages: agentSessionMessages.map(mapContextMessage),
            transcript: buildAgentSessionTranscript(messages, conversation.assignedAt),
          },
          customer: {
            visitorId: conversation.visitorId,
            webchatId: conversation.webchatId,
            contactId: conversation.contactId,
            contact,
          },
          crossChannelSummary,
          botMemory: botMemory
            ? {
                rollingSummary: botMemory.rollingSummary,
                extractedFacts: botMemory.extractedFacts,
              }
            : null,
          sessionMemory: sessionMemory
            ? {
                longTermSummary: sessionMemory.longTermSummary,
                extractedFacts: sessionMemory.extractedFacts,
                botTranscript: sessionMemory.transcript,
              }
            : null,
        },
      };
    });

    scoped.get(`${prefix}/copilot/turns`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const query = z
          .object({
            conversationId: entityIdSchema,
            limit: z.coerce.number().int().min(1).max(50).optional().default(20),
            surface: z.string().max(64).optional(),
          })
          .parse(request.query);
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          assertWorkspaceConversationAccess(
            db,
            organizationId,
            userId,
            query.conversationId,
            request.userRole,
          ),
        );
        const turns = await withOrganizationContext(app.prisma, organizationId, (db) =>
          listActiveCopilotTurns(
            db,
            organizationId,
            userId,
            query.conversationId,
            query.limit,
            query.surface ?? "inbox",
          ),
        );
        return { turns };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/copilot/turns`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const payload = recordCopilotTurnSchema.parse(request.body);
      if (payload.conversationId) {
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          assertWorkspaceConversationAccess(
            db,
            organizationId,
            userId,
            payload.conversationId!,
            request.userRole,
          ),
        );
      }
      const turn = await withOrganizationContext(app.prisma, organizationId, (db) =>
        recordCopilotTurn(
          db,
          organizationId,
          userId,
          request.userRole ?? "agent",
          payload,
        ),
      );
      if (turn.stale) {
        throw app.httpErrors.conflict("Copilot suggestion is stale; refresh and try again");
      }
      return { turn };
    });

    scoped.post(`${prefix}/conversations/:id/messages`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = replySchema.parse(request.body);
        const message = await withOrganizationContext(app.prisma, organizationId, (db) =>
          sendAgentReply(db, organizationId, userId, id, payload.body),
        );
        emitMessageCreated(organizationId, id, message);

        scheduleConversationMessageSentiment(
          app.prisma,
          organizationId,
          id,
          message.id,
          "agent",
          message.body,
        );

        void withOrganizationContext(
          app.prisma,
          organizationId,
          async (db) => {
          if (payload.copilotTurnId) {
            await linkCopilotTurnToMessage(
              db,
              organizationId,
              userId,
              payload.copilotTurnId,
              message.id,
              message.body,
            );
          }
          const receiptConversation = await getConversation(db, organizationId, id);
          const visitorRef = receiptConversation?.visitorId ?? "";
          const sentReceipt = await recordMessageReceipt(db, organizationId, id, {
            messageId: message.id,
            recipientType: "visitor",
            recipientRef: visitorRef,
            status: "sent",
          });
          emitMessageReceiptUpdated(organizationId, id, sentReceipt);

          let delivered = false;
          if (receiptConversation?.channel === "email") {
            const inboundRows = await db.$queryRaw<
              { rfc_message_id: string | null; references_header: string | null }[]
            >`
              SELECT rfc_message_id, references_header
              FROM ccass.conversation_messages
              WHERE organization_id = ${organizationId}::bigint
                AND conversation_id = ${id}::bigint
                AND sender_type = 'customer'
                AND direction = 'inbound'
              ORDER BY created_at DESC
              LIMIT 1
            `;
            delivered = receiptConversation.mailboxConnectionId
              ? await deliverPersistedMessageToEmail(db, {
                  organizationId,
                  conversationId: id,
                  body: message.body,
                  messageId: message.id,
                  threadId:
                    receiptConversation.providerThreadId ??
                    receiptConversation.externalThreadId,
                  subject: receiptConversation.subject ?? "Support request",
                  recipientEmail: visitorRef,
                  connectionId: receiptConversation.mailboxConnectionId,
                  inReplyTo: inboundRows[0]?.rfc_message_id ?? null,
                  references:
                    inboundRows[0]?.references_header ??
                    inboundRows[0]?.rfc_message_id ??
                    null,
                })
              : false;
          } else if (receiptConversation?.channel === "whatsapp") {
            delivered = receiptConversation.channelConfigId
              ? await deliverPersistedMessageToWhatsApp(db, {
                  organizationId,
                  conversationId: id,
                  body: message.body,
                  messageId: message.id,
                  channelConfigId: receiptConversation.channelConfigId,
                  recipientPhone: visitorRef,
                })
              : false;
          } else if (
            receiptConversation?.channel === "instagram" ||
            receiptConversation?.channel === "facebook"
          ) {
            delivered = receiptConversation.channelConfigId
              ? await deliverPersistedMessageToSocial(db, {
                  organizationId,
                  conversationId: id,
                  body: message.body,
                  messageId: message.id,
                  channel: receiptConversation.channel,
                  channelConfigId: receiptConversation.channelConfigId,
                  recipientRef: visitorRef,
                })
              : false;
          } else {
            delivered = await deliverPersistedMessageToWebchat(db, {
              organizationId,
              conversationId: id,
              body: message.body,
              messageId: message.id,
              senderType: "agent",
              webchatId: receiptConversation?.webchatId ?? null,
              visitorId: receiptConversation?.visitorId ?? null,
            });
          }
          if (delivered) {
            const deliveredReceipt = await recordMessageReceipt(db, organizationId, id, {
              messageId: message.id,
              recipientType: "visitor",
              recipientRef: visitorRef,
              status: "delivered",
            });
            emitMessageReceiptUpdated(organizationId, id, deliveredReceipt);
          }
        },
          { timeoutMs: 25_000 },
        ).catch((error) => {
          app.log.warn(
            { error, conversationId: id, messageId: message.id },
            "Deferred agent reply delivery failed",
          );
        });

        return {
          message: {
            ...message,
            deliveryState: "sent",
          },
        };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/receipts`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const parsed = messageReceiptSchema
          .pick({ messageId: true, status: true, occurredAt: true })
          .parse(request.body);
        if (parsed.status !== "read" && parsed.status !== "delivered") {
          throw Object.assign(new Error("Workspace receipts must be delivered or read"), {
            status: 400,
          });
        }
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          assertWorkspaceConversationAccess(db, organizationId, userId, id, request.userRole),
        );
        const receipt = await withOrganizationContext(app.prisma, organizationId, (db) =>
          recordMessageReceipt(db, organizationId, id, {
            ...parsed,
            recipientType: "agent",
            recipientRef: userId,
          }),
        );
        emitMessageReceiptUpdated(organizationId, id, receipt);
        await deliverRealtimeEventToWebchat({
          organizationId,
          conversationId: id,
          type: parsed.status === "read" ? "receipt.read" : "receipt.delivered",
          messageId: parsed.messageId,
          occurredAt: receipt.updatedAt,
        });
        return { receipt };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/typing`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = z.object({ active: z.boolean() }).parse(request.body);
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          assertWorkspaceConversationAccess(db, organizationId, userId, id, request.userRole),
        );
        emitTypingUpdated(organizationId, id, "agent", payload.active);
        await deliverRealtimeEventToWebchat({
          organizationId,
          conversationId: id,
          type: payload.active ? "typing.started" : "typing.stopped",
        });
        return { accepted: true };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/messages/:messageId/attachments`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id, messageId } = request.params as { id: string; messageId: string };
        const payload = attachmentMetadataSchema.parse(request.body);
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          assertWorkspaceConversationAccess(db, organizationId, userId, id, request.userRole),
        );
        const attachment = await withOrganizationContext(app.prisma, organizationId, (db) =>
          addMessageAttachmentMetadata(db, organizationId, id, messageId, payload),
        );
        return { attachment };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/call-control`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = z
          .object({
            action: z.enum(["hold", "unhold", "mute", "unmute"]),
          })
          .parse(request.body);
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          assertWorkspaceConversationAccess(db, organizationId, userId, id, request.userRole),
        );
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          publishVoiceCallControlForConversation(db, organizationId, id, payload.action),
        );
        return { ok: true, action: payload.action };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/voice/supervisor-listen`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          assertWorkspaceConversationAccess(db, organizationId, userId, id, request.userRole),
        );
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          publishSupervisorListen(db, organizationId, userId, id),
        );
        return result;
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/voice/supervisor-listen/cancel`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          assertWorkspaceConversationAccess(db, organizationId, userId, id, request.userRole),
        );
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          publishSupervisorListenCancel(db, organizationId, userId, id),
        );
        return result;
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/voice/supervisor-listen/switch`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = z
          .object({ switchType: z.union([z.literal(1), z.literal(2), z.literal(3)]) })
          .parse(request.body);
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          assertWorkspaceConversationAccess(db, organizationId, userId, id, request.userRole),
        );
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          publishSupervisorMonitorSwitch(db, organizationId, userId, id, payload.switchType),
        );
        return result;
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/voice/transfer-invite`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = voiceTransferInviteSchema.parse(request.body);
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          inviteVoiceConsultTransfer(db, organizationId, userId, id, payload),
        );
        return result;
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/voice/transfer-action`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = voiceTransferActionSchema.parse(request.body);
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          publishVoiceTransferAction(db, organizationId, userId, id, payload),
        );
        return result;
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/voice/consult-reject`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        return await withOrganizationContext(app.prisma, organizationId, (db) =>
          rejectVoiceConsultTransfer(db, organizationId, userId, id),
        );
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/voice/consult-answered`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        return await withOrganizationContext(app.prisma, organizationId, (db) =>
          markVoiceConsultAnswered(db, organizationId, userId, id),
        );
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.get(`${prefix}/voice-call/active`, async (request) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const call = await withOrganizationContext(app.prisma, organizationId, (db) =>
        getActiveVoiceCallForUser(db, organizationId, userId),
      );
      return call ?? { conversation: null, sessionId: null };
    });

    scoped.post(`${prefix}/voice-call/ensure`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const input = z
          .object({
            sessionId: z.string().trim().max(128).nullable().optional(),
            destination: z.string().trim().max(64).nullable().optional(),
          })
          .parse(request.body ?? {});
        request.log.info(
          {
            event: "voice.workspace.ensure.requested",
            organizationId,
            userId,
            sessionId: input.sessionId ?? null,
            hasDestination: Boolean(input.destination),
          },
          "Exact-session voice workspace recovery requested",
        );
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          ensureVoiceCallForUser(app, db, organizationId, userId, input),
        );
        request.log.info(
          {
            event: "voice.workspace.ensure.succeeded",
            organizationId,
            userId,
            requestedSessionId: input.sessionId ?? null,
            linkedSessionId: result.sessionId,
            conversationId: result.conversation.id,
          },
          "Exact-session voice workspace recovery succeeded",
        );
        return result;
      } catch (error) {
        request.log.warn(
          {
            event: "voice.workspace.ensure.failed",
            err: error,
          },
          "Exact-session voice workspace recovery failed",
        );
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/voice-call/finalize`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const input = z
          .object({
            conversationId: z.string().trim().max(64).nullable().optional(),
            sessionId: z.string().trim().max(128).nullable().optional(),
            reason: z.enum([
              "agent_declined",
              "browser_disconnected",
              "customer_disconnected",
              "stale_voice_call_closed",
              "abandoned",
              "rejected",
            ]),
          })
          .parse(request.body ?? {});
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          finalizeVoiceCallForUser(app, db, organizationId, userId, input),
        );
        return result;
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/voice-call/browser-disconnected`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const input = z
          .object({
            conversationId: z.string().trim().max(64).nullable().optional(),
            sessionId: z.string().trim().max(128).nullable().optional(),
          })
          .parse(request.body ?? {});
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          finalizeVoiceCallForUser(app, db, organizationId, userId, {
            conversationId: input.conversationId,
            sessionId: input.sessionId,
            reason: "browser_disconnected",
          }),
        );
        return result;
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/accept`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          acceptConversationOffer(db, organizationId, userId, id),
        );
        await clearPendingOfferExpiration(app, organizationId, id);
        emitConversationAccepted(organizationId, result.conversation, userId);
        if (result.transfer) {
          emitConversationTransferred(organizationId, result.conversation, result.transfer);
          emitTransferAccepted(organizationId, result.transfer, result.conversation);
        } else if (result.transferFromUserId) {
          emitConversationTransferAccepted(
            organizationId,
            result.conversation,
            result.transferFromUserId,
          );
        }
        if (result.systemMessage) {
          emitMessageCreated(organizationId, id, result.systemMessage);
          // Delivery HTTP must not block accept or hold the request path on provider latency.
          void withOrganizationContext(
            app.prisma,
            organizationId,
            async (db) => {
              if (result.conversation.channel === "webchat") {
                await deliverPersistedMessageToWebchat(db, {
                  organizationId,
                  conversationId: id,
                  body: result.systemMessage!.body,
                  messageId: result.systemMessage!.id,
                  senderType: "system",
                  webchatId: result.conversation.webchatId,
                  visitorId: result.conversation.visitorId,
                });
              } else if (
                result.conversation.channel === "whatsapp" &&
                result.conversation.channelConfigId &&
                result.conversation.visitorId
              ) {
                await deliverPersistedMessageToWhatsApp(db, {
                  organizationId,
                  conversationId: id,
                  body: result.systemMessage!.body,
                  messageId: result.systemMessage!.id,
                  channelConfigId: result.conversation.channelConfigId,
                  recipientPhone: result.conversation.visitorId,
                });
              } else if (
                (result.conversation.channel === "instagram" ||
                  result.conversation.channel === "facebook") &&
                result.conversation.channelConfigId &&
                result.conversation.visitorId
              ) {
                await deliverPersistedMessageToSocial(db, {
                  organizationId,
                  conversationId: id,
                  body: result.systemMessage!.body,
                  messageId: result.systemMessage!.id,
                  channel: result.conversation.channel,
                  channelConfigId: result.conversation.channelConfigId,
                  recipientRef: result.conversation.visitorId,
                });
              }
            },
            { timeoutMs: 25_000 },
          ).catch((error) => {
            app.log.warn(
              { error, conversationId: id, messageId: result.systemMessage!.id },
              "Accept connected message delivery failed",
            );
          });
        }
        const presence = await withOrganizationContext(app.prisma, organizationId, (db) =>
          getAgentPresenceForUser(db, organizationId, userId),
        );
        if (presence) {
          emitPresenceUpdatedForAgent(organizationId, userId, presence);
        }
        return { conversation: result.conversation };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/resolve`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const result = await withOrganizationContext(
          app.prisma,
          organizationId,
          (db) => resolveConversation(db, organizationId, userId, id),
        );
        emitConversationResolved(organizationId, result.conversation, userId);
        if (result.drained) {
          notifyConversationRouted(
            app,
            organizationId,
            result.drained.conversation,
            result.drained.userId,
          );
        }
        const presence = await withOrganizationContext(app.prisma, organizationId, (db) =>
          getAgentPresenceForUser(db, organizationId, userId),
        );
        if (presence) {
          emitPresenceUpdatedForAgent(organizationId, userId, presence);
        }
        return { conversation: result.conversation };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/disposition`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = saveDispositionSchema.parse(request.body);
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          assertWorkspaceConversationAccess(db, organizationId, userId, id, request.userRole),
        );
        const saved = await withOrganizationContext(app.prisma, organizationId, (db) =>
          saveConversationDisposition(db, organizationId, id, userId, payload),
        );
        const { contactId, ...disposition } = saved;
        scheduleOmniChannelSummaryRefresh(organizationId, contactId);
        scheduleSessionSentimentOnDisposition(app.prisma, organizationId, id);
        emitConversationDispositionSaved(organizationId, id, disposition);
        return { disposition };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/transfer`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = transferConversationSchema.parse(request.body);
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          transferConversation(db, organizationId, userId, id, payload),
        );
        await clearPendingOfferExpiration(app, organizationId, id);
        // BigInt-safe clone so HTTP + socket payloads never throw on serialize.
        const safeResult = JSON.parse(jsonStringifyEntityPayload(result)) as typeof result;
        const explicitWarm =
          Boolean(safeResult.transfer.requestedAgentId) &&
          safeResult.conversation.channel !== "email" &&
          safeResult.transfer.state === "offered";
        if (explicitWarm && safeResult.assignment) {
          emitTransferOffered(
            organizationId,
            safeResult.transfer,
            safeResult.assignment.userId,
            safeResult.conversation,
          );
        } else {
          emitConversationTransferred(organizationId, safeResult.conversation, safeResult.transfer);
        }
        if (safeResult.assignment) {
          notifyConversationRouted(
            app,
            organizationId,
            explicitWarm
              ? { ...safeResult.conversation, pendingOffer: true }
              : safeResult.conversation,
            safeResult.assignment.userId,
          );
          // Email / direct-assign handoffs complete without a separate accept step.
          // Warm transfers stay "active" on the sender while ringing — do not emit
          // accepted here or the sender UI jumps to wrap-up before the target accepts.
          if (!explicitWarm && safeResult.conversation.status === "active") {
            emitConversationTransferAccepted(organizationId, safeResult.conversation, userId);
          }
        } else {
          emitConversationQueued(organizationId, safeResult.conversation);
        }
        if (safeResult.drained) {
          notifyConversationRouted(
            app,
            organizationId,
            safeResult.drained.conversation,
            safeResult.drained.userId,
          );
        }
        return safeResult;
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.get(`${prefix}/conversations/:id/transfer-targets`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const query = transferTargetsQuerySchema.parse(request.query);
        return await withOrganizationContext(app.prisma, organizationId, (db) =>
          listConversationTransferTargets(db, organizationId, userId, id, query),
        );
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/transfer/cancel`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          cancelWarmTransfer(db, organizationId, userId, id),
        );
        await clearPendingOfferExpiration(app, organizationId, id);
        emitTransferCancelled(
          organizationId,
          result.transfer,
          result.targetUserId,
          result.conversation,
        );
        return { conversation: result.conversation, transfer: result.transfer };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/transfer/complete`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = completeTransferSchema.parse(request.body);
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          completeWarmTransfer(db, organizationId, userId, id, payload),
        );
        emitTransferCompleted(organizationId, result.transfer);
        return result;
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/end`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const body = endConversationSchema.omit({ actor: true }).parse(request.body);
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          endConversation(db, organizationId, userId, id, { ...body, actor: "agent" }),
        );
        if (body.disposition) {
          scheduleSessionSentimentOnDisposition(app.prisma, organizationId, id);
        }
        await clearPendingOfferExpiration(app, organizationId, id);
        emitConversationEnded(organizationId, result.conversation);
        if (result.cancelledTransfer) {
          emitTransferCancelled(
            organizationId,
            result.cancelledTransfer,
            result.releasedOfferUserIds[0] ?? null,
            result.conversation,
          );
        }
        if (result.drained) {
          notifyConversationRouted(
            app,
            organizationId,
            result.drained.conversation,
            result.drained.userId,
          );
        }
        const presence = await withOrganizationContext(app.prisma, organizationId, (db) =>
          getAgentPresenceForUser(db, organizationId, userId),
        );
        if (presence) {
          emitPresenceUpdatedForAgent(organizationId, userId, presence);
        }
        await deliverRealtimeEventToWebchat({
          organizationId,
          conversationId: id,
          type: "session.ended",
          reason: body.reason,
        });
        scheduleFollowUpExtractionOnConversationEnd(app.prisma, organizationId, id, userId);
        return { conversation: result.conversation };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/supervisor/takeover`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = supervisorActionSchema.parse(request.body);
        const conversation = await withOrganizationContext(app.prisma, organizationId, (db) =>
          supervisorTakeover(db, organizationId, userId, id, payload),
        );
        await clearPendingOfferExpiration(app, organizationId, id);
        emitConversationAccepted(organizationId, conversation, userId);
        return { conversation };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/supervisor/reassign`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = supervisorActionSchema.parse(request.body);
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          supervisorReassign(db, organizationId, userId, id, payload),
        );
        await clearPendingOfferExpiration(app, organizationId, id);
        if (result.nextUserId) {
          notifyConversationRouted(app, organizationId, result.conversation, result.nextUserId);
        } else {
          emitConversationQueued(organizationId, result.conversation);
        }
        return result;
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/supervisor/force-close`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = supervisorActionSchema.parse(request.body);
        const conversation = await withOrganizationContext(app.prisma, organizationId, (db) =>
          supervisorForceClose(db, organizationId, userId, id, payload),
        );
        await clearPendingOfferExpiration(app, organizationId, id);
        emitConversationEnded(organizationId, conversation);
        await deliverRealtimeEventToWebchat({
          organizationId,
          conversationId: id,
          type: "session.ended",
          reason: `supervisor_force_close:${payload.reason}`,
        });
        return { conversation };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.get(`${prefix}/visitors/:visitorId/notes`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { visitorId } = request.params as { visitorId: string };
        const contactId = (request.query as { contactId?: string }).contactId?.trim() || null;
        const notes = await withOrganizationContext(app.prisma, organizationId, (db) =>
          listVisitorNotes(db, organizationId, visitorId, userId, 50, contactId),
        );
        return { notes };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.get(`${prefix}/common-notes`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const notes = await withOrganizationContext(app.prisma, organizationId, (db) =>
          listCommonNotes(db, organizationId, userId),
        );
        return { notes };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/common-notes`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const payload = createWorkspaceNoteSchema.parse(request.body);
        const note = await withOrganizationContext(app.prisma, organizationId, (db) =>
          createCommonNote(db, organizationId, userId, payload.title, payload.body),
        );
        return { note };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/notes`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const payload = createWorkspaceNoteSchema.parse(request.body);
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          assertWorkspaceConversationAccess(db, organizationId, userId, id, request.userRole),
        );
        const note = await withOrganizationContext(app.prisma, organizationId, (db) =>
          createConversationNote(db, organizationId, id, userId, payload.title, payload.body),
        );
        return { note };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/conversations/:id/reject`, async (request) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { id } = request.params as { id: string };
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          rejectConversationOffer(db, organizationId, userId, id),
        );
        await clearPendingOfferExpiration(app, organizationId, id);
        emitConversationRejected(organizationId, result.conversation, userId);
        if (result.transfer) {
          emitTransferRejected(organizationId, result.transfer, userId, result.conversation);
        }
        const presence = await withOrganizationContext(app.prisma, organizationId, (db) =>
          getAgentPresenceForUser(db, organizationId, userId),
        );
        if (presence) {
          emitPresenceUpdatedForAgent(organizationId, userId, presence);
        }
        if (result.rerouted && result.nextUserId) {
          const offered = await withOrganizationContext(app.prisma, organizationId, (db) =>
            getConversation(db, organizationId, id),
          );
          if (offered) {
            notifyConversationRouted(app, organizationId, offered, result.nextUserId);
          }
        } else if (result.systemMessage) {
          emitMessageCreated(organizationId, id, result.systemMessage);
          void withOrganizationContext(
            app.prisma,
            organizationId,
            async (db) => {
              if (result.conversation.channel === "webchat") {
                await deliverPersistedMessageToWebchat(db, {
                  organizationId,
                  conversationId: id,
                  body: result.systemMessage!.body,
                  messageId: result.systemMessage!.id,
                  senderType: "system",
                  webchatId: result.conversation.webchatId,
                  visitorId: result.conversation.visitorId,
                });
              } else if (
                result.conversation.channel === "whatsapp" &&
                result.conversation.channelConfigId &&
                result.conversation.visitorId
              ) {
                await deliverPersistedMessageToWhatsApp(db, {
                  organizationId,
                  conversationId: id,
                  body: result.systemMessage!.body,
                  messageId: result.systemMessage!.id,
                  channelConfigId: result.conversation.channelConfigId,
                  recipientPhone: result.conversation.visitorId,
                });
              } else if (
                (result.conversation.channel === "instagram" ||
                  result.conversation.channel === "facebook") &&
                result.conversation.channelConfigId &&
                result.conversation.visitorId
              ) {
                await deliverPersistedMessageToSocial(db, {
                  organizationId,
                  conversationId: id,
                  body: result.systemMessage!.body,
                  messageId: result.systemMessage!.id,
                  channel: result.conversation.channel,
                  channelConfigId: result.conversation.channelConfigId,
                  recipientRef: result.conversation.visitorId,
                });
              }
            },
            { timeoutMs: 25_000 },
          ).catch((error) => {
            app.log.warn(
              { error, conversationId: id, messageId: result.systemMessage!.id },
              "Rejected-offer fallback delivery failed",
            );
          });
        } else if (result.conversation.status === "queued") {
          emitConversationQueued(organizationId, result.conversation);
        }
        return result;
      } catch (error) {
        handleRouteError(app, error);
      }
    });
  });
}
