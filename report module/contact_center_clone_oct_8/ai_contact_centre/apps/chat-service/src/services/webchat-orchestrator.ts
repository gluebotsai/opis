import type { WebchatSession } from "./webchat-session-store.js";
import {
  addAttachmentMetadata,
  appendMessage,
  fetchWebchatContext,
  getConversationState,
  initiateHandoff,
  recordNlpTurn,
  startConversation,
  type WebchatContext,
} from "./cc-core-client.js";
import { captureContactFromCustomerMessage } from "./contact-capture.js";
import {
  runWebchatNlpTurn as callNlp,
  type NlpWebchatTurn,
} from "./nlp-client.js";

export type BotReply = {
  text: string | null;
  messageId?: string;
  stub: boolean;
  conversationId?: string;
  handoff?: {
    queueId: string;
    agentUserId?: string;
  };
  /** Bot wrote the first line because the webchat greeting was empty. */
  generatedOpening?: boolean;
};

export interface BotResponder {
  onSessionStart(
    webchatId: string,
    visitorId: string,
    conversationId: string,
    options?: {
      pageUrl?: string;
      consent?: Record<string, unknown>;
      prechatAnswers?: Record<string, unknown>;
      /** Hub already supplied the first bot line. Do not write the webchat greeting. */
      skipOpening?: boolean;
    },
  ): Promise<BotReply | null>;
  onMessage(
    session: WebchatSession,
    userText: string,
    attachments?: Array<{
      externalId?: string;
      storageKey: string;
      fileName: string;
      contentType: string;
      byteSize: number;
      checksumSha256?: string;
      downloadUrl?: string;
    }>,
  ): Promise<BotReply>;
}

const MAX_TRANSCRIPT_MESSAGES = 12;
const MAX_TRANSCRIPT_MESSAGE_CHARS = 1_200;
const CUSTOM_LOLA_WORKTUAL_ORG_IDS = new Set(
  (process.env.CUSTOM_LOLA_WORKTUAL_ORG_IDS ?? "1003")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

export function shouldGeneratePersonalizedOpening(
  context: Pick<WebchatContext, "organizationId" | "nlpEnabled"> | null | undefined,
  skipOpening = false,
): boolean {
  return Boolean(
    !skipOpening &&
      context?.nlpEnabled &&
      CUSTOM_LOLA_WORKTUAL_ORG_IDS.has(String(context.organizationId)),
  );
}

function webchatTenantContext(
  context: WebchatContext,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    companyName: context.companyName,
    title: context.title,
    aliasTitle: context.aliasTitle,
    description: context.description,
    industryType: context.industryType,
    businessType: context.businessType,
    websiteUrl: context.websiteUrl,
    publicEmail: context.publicEmail,
    publicPhone: context.publicPhone,
    primaryLocation: context.primaryLocation,
    locations: context.locations,
    businessHours: context.businessHours,
    routingQueueName: context.routingQueueName,
    capabilities: context.capabilities,
    queue_profiles: (context.chatQueues ?? []).map((queue) => ({
      key: queue.id,
      name: queue.name,
      description: queue.description ?? queue.name,
      intents: queue.intents,
      skills: queue.skills,
    })),
    ...extras,
  };
}

function boundedTranscript(session: WebchatSession): { role: string; content: string }[] {
  return session.messages.slice(-MAX_TRANSCRIPT_MESSAGES).map((message) => ({
    role: message.from,
    content: message.text.slice(0, MAX_TRANSCRIPT_MESSAGE_CHARS),
  }));
}

/** Keep in-memory handoff flag aligned with cc-core after timeout/reject fallbacks. */
export function syncHandoffSessionFromConversation(
  session: Pick<WebchatSession, "handoffStarted">,
  conversation: { botActive?: boolean; status?: string } | null | undefined,
): void {
  if (!conversation) return;
  if (conversation.botActive === true && conversation.status === "bot_active") {
    session.handoffStarted = false;
    return;
  }
  if (
    conversation.botActive === false &&
    conversation.status !== "resolved" &&
    conversation.status !== "closed"
  ) {
    session.handoffStarted = true;
  }
}

async function recordUnansweredNlpTurn(input: {
  organizationId: string;
  conversationId: string;
  customerMessageId?: string;
  customerText: string;
  result: NlpWebchatTurn;
}): Promise<void> {
  await recordNlpTurn(input.organizationId, input.conversationId, {
    customerText: input.customerText,
    customerMessageId: input.customerMessageId,
    confidence: input.result.confidence,
    intent: input.result.intent,
    candidateSkills: input.result.candidateSkills,
    selectedQueueKey: input.result.selectedQueueKey,
    handoffRecommended: input.result.handoffRecommended,
    handoffReason: input.result.handoffReason,
    summary: input.result.summary,
    sentiment: input.result.sentiment,
    importantFacts: input.result.importantFacts,
    knowledgeUsed: input.result.knowledgeUsed,
    contactEntities: input.result.contactEntities,
    modelName: input.result.modelName,
    traceId: input.result.traceId,
  });
}

export class OrchestratedBotResponder implements BotResponder {
  private readonly contextCache = new Map<string, WebchatContext>();

  primeContext(webchatId: string, context: WebchatContext): void {
    this.contextCache.set(webchatId, context);
  }

  private async getContext(
    webchatId: string,
    options: { refresh?: boolean } = {},
  ): Promise<WebchatContext | null> {
    if (!options.refresh) {
      const cached = this.contextCache.get(webchatId);
      if (cached) return cached;
    }
    const context = await fetchWebchatContext(webchatId);
    if (context) this.contextCache.set(webchatId, context);
    return context;
  }

  async onSessionStart(
    webchatId: string,
    visitorId: string,
    conversationId: string,
    options?: {
      pageUrl?: string;
      consent?: Record<string, unknown>;
      prechatAnswers?: Record<string, unknown>;
      skipOpening?: boolean;
    },
  ): Promise<(BotReply & { conversationId: string }) | null> {
    const context = await this.getContext(webchatId);
    const generatedOpening = shouldGeneratePersonalizedOpening(context, options?.skipOpening);
    const greeting =
      options?.skipOpening || generatedOpening ? "" : (context?.greetingMessage?.trim() ?? "");

    const started = await startConversation({
      webchatId,
      visitorId,
      conversationId,
      externalThreadId: conversationId,
      pageUrl: options?.pageUrl,
      consent: options?.consent,
      prechatAnswers: options?.prechatAnswers,
      ...(greeting ? { greetingBody: greeting } : {}),
    });

    if (options?.skipOpening || greeting || !context?.nlpEnabled) {
      return {
        text: greeting || null,
        messageId: started.greetingMessage?.id,
        stub: false,
        conversationId: started.conversation.id,
      };
    }

    const persistedConversation = generatedOpening
      ? await getConversationState(started.organizationId, started.conversation.id)
      : null;
    const nlpResult = await callNlp({
      organizationId: started.organizationId,
      conversationId: started.conversation.id,
      message: "The visitor opened the chat.",
      tenantContext: webchatTenantContext(context, {
        visitor_id: visitorId,
        visitorId,
        session_opening: true,
        contact_profile: persistedConversation?.contactProfile ?? undefined,
      }),
      transcript: [],
    });
    const opening = nlpResult?.reply?.trim() ?? "";
    if (!opening) {
      return {
        text: null,
        stub: false,
        conversationId: started.conversation.id,
      };
    }

    const saved = await appendMessage(started.organizationId, started.conversation.id, {
      senderType: "bot",
      body: opening,
      direction: "outbound",
    });
    return {
      text: opening,
      messageId: saved?.id,
      stub: false,
      conversationId: started.conversation.id,
      generatedOpening: true,
    };
  }

  async onMessage(
    session: WebchatSession,
    userText: string,
    attachments: Array<{
      externalId?: string;
      storageKey: string;
      fileName: string;
      contentType: string;
      byteSize: number;
      checksumSha256?: string;
      downloadUrl?: string;
    }> = [],
  ): Promise<BotReply> {
    const context = await this.getContext(session.webchatId);
    const organizationId = session.organizationId ?? context?.organizationId;

    const customerMessage = organizationId
      ? await appendMessage(organizationId, session.conversationId, {
          senderType: "customer",
          body: userText,
          direction: "inbound",
        })
      : null;
    session.lastCustomerMessageId = customerMessage?.id;

    if (organizationId && customerMessage && attachments.length > 0) {
      await Promise.all(
        attachments.map((attachment) =>
          addAttachmentMetadata(
            organizationId,
            session.conversationId,
            customerMessage.id,
            attachment,
          ),
        ),
      );
    }

    if (customerMessage?.reopened) {
      session.handoffStarted = false;
    }

    const persistedConversation = organizationId
      ? await getConversationState(organizationId, session.conversationId)
      : null;
    syncHandoffSessionFromConversation(session, persistedConversation);

    const handoffActive =
      session.handoffStarted ||
      (persistedConversation?.botActive === false &&
        persistedConversation.status !== "resolved" &&
        persistedConversation.status !== "closed");
    const routedToAgent =
      persistedConversation?.status === "queued" ||
      persistedConversation?.status === "assigned" ||
      persistedConversation?.status === "active";

    // After handoff, capture customer details through the server-side enrichment path.
    // While the bot is active, NLP owns enrichment so confirmation rules and tool
    // results stay visible to the model.
    if (organizationId && customerMessage && (handoffActive || routedToAgent)) {
      await captureContactFromCustomerMessage({
        organizationId,
        conversationId: session.conversationId,
        message: userText,
        sourceMessageId: customerMessage.id,
        channel: "webchat",
      });
    }

    if (handoffActive) {
      session.handoffStarted = true;
      return {
        text: null,
        stub: false,
      };
    }

    if (routedToAgent) {
      session.handoffStarted = true;
      return { text: null, stub: false };
    }

    if (!organizationId || !context || !customerMessage) {
      return { text: null, stub: false };
    }

    if (!context?.nlpEnabled) {
      await captureContactFromCustomerMessage({
        organizationId,
        conversationId: session.conversationId,
        message: userText,
        sourceMessageId: customerMessage.id,
        channel: "webchat",
      });
      if (context.liveAgentEnabled) {
        const handoff = await initiateHandoff(organizationId, session.conversationId, {
          reason: "nlp_disabled",
        });
        if (handoff) {
          session.handoffStarted = true;
          const handoffText =
            handoff.systemMessage?.body ??
            context.approvedServiceMessage ??
            "Please hold while we connect you with an agent.";
          return {
            // cc-core persists and delivers the system message directly.
            text: handoff.systemMessage ? null : handoffText,
            messageId: handoff.systemMessage?.id,
            stub: false,
            handoff: {
              queueId: persistedConversation?.queueId ?? context.chatQueues?.[0]?.id ?? "",
              agentUserId: handoff.assignedUserId,
            },
          };
        }
      }
      return { text: context.approvedServiceMessage, stub: false };
    }

    const nlpResult = await callNlp({
      organizationId,
      conversationId: session.conversationId,
      message: userText,
      tenantContext: webchatTenantContext(context, {
        visitor_id: session.visitorId,
        visitorId: session.visitorId,
        contact_profile: persistedConversation?.contactProfile ?? undefined,
      }),
      transcript: boundedTranscript(session),
    });

    const stateAfterNlp = organizationId
      ? await getConversationState(organizationId, session.conversationId)
      : null;
    syncHandoffSessionFromConversation(session, stateAfterNlp);
    if (session.handoffStarted || stateAfterNlp?.botActive === false) {
      if (nlpResult) {
        await recordUnansweredNlpTurn({
          organizationId,
          conversationId: session.conversationId,
          customerMessageId: customerMessage.id,
          customerText: userText,
          result: nlpResult,
        });
      }
      session.handoffStarted = stateAfterNlp?.botActive === false || session.handoffStarted;
      return { text: null, stub: false };
    }

    if (!nlpResult) {
      return {
        text:
          context.approvedServiceMessage ??
          "I'm sorry, I'm having trouble right now. Please try again in a moment.",
        stub: false,
      };
    }

    const shouldHandoff = context.liveAgentEnabled && nlpResult.handoffRecommended === true;

    if (
      shouldHandoff &&
      (persistedConversation?.status === "queued" ||
        persistedConversation?.status === "assigned" ||
        persistedConversation?.botActive === false)
    ) {
      if (nlpResult) {
        await recordUnansweredNlpTurn({
          organizationId,
          conversationId: session.conversationId,
          customerMessageId: customerMessage.id,
          customerText: userText,
          result: nlpResult,
        });
      }
      session.handoffStarted = true;
      return { text: null, stub: false };
    }

    if (shouldHandoff && organizationId) {
      const refreshed =
        (context.chatQueues?.length ?? 0) > 0
          ? context
          : await this.getContext(session.webchatId, { refresh: true });
      if (refreshed) {
        session.routingQueueId = refreshed.chatQueues[0]?.id ?? refreshed.routingQueueId;
      }

      const handoff = await initiateHandoff(organizationId, session.conversationId, {
        reason: nlpResult.handoffReason ?? "explicit_request",
        selectedQueueKey: nlpResult.selectedQueueKey,
        intent: nlpResult.intent,
        message: userText,
        candidateSkills: nlpResult.candidateSkills,
      });

      if (!handoff) {
        const afterFailed = await getConversationState(organizationId, session.conversationId);
        // Keep the bot available unless the conversation actually left bot control.
        session.handoffStarted =
          afterFailed?.botActive === false ||
          afterFailed?.status === "queued" ||
          afterFailed?.status === "assigned" ||
          afterFailed?.status === "active";
        return {
          text:
            context.approvedServiceMessage ??
            "I'm sorry — I couldn't connect you to a live agent right now. Please try again shortly.",
          stub: false,
        };
      }

      session.handoffStarted = true;
      const handoffText =
        handoff.systemMessage?.body ??
        context.approvedServiceMessage ??
        "Please hold while we connect you with an agent.";

      const stateAfterHandoff = await getConversationState(
        organizationId,
        session.conversationId,
      );
      if (stateAfterHandoff?.botActive !== false) {
        session.handoffStarted = false;
      }

      await recordNlpTurn(organizationId, session.conversationId, {
        customerText: userText,
        botReply: handoffText,
        customerMessageId: customerMessage?.id,
        botMessageId: handoff.systemMessage?.id,
        confidence: nlpResult?.confidence,
        intent: nlpResult?.intent,
        candidateSkills: nlpResult?.candidateSkills,
        selectedQueueKey: nlpResult.selectedQueueKey,
        handoffRecommended: true,
        handoffReason: nlpResult.handoffReason ?? "explicit_request",
        summary: nlpResult?.summary,
        sentiment: nlpResult?.sentiment,
        importantFacts: nlpResult?.importantFacts,
        knowledgeUsed: nlpResult?.knowledgeUsed,
        contactEntities: nlpResult?.contactEntities,
        modelName: nlpResult?.modelName,
        traceId: nlpResult?.traceId,
      });

      return {
        // cc-core persists and delivers the system message directly.
        text: handoff.systemMessage ? null : handoffText,
        messageId: handoff.systemMessage?.id,
        stub: false,
        handoff: {
          queueId:
            nlpResult.selectedQueueKey ??
            stateAfterHandoff?.queueId ??
            refreshed?.chatQueues[0]?.id ??
            "",
          agentUserId: handoff?.assignedUserId,
        },
      };
    }

    const replyText = nlpResult?.reply ?? context.approvedServiceMessage;
    if (!replyText) return { text: null, stub: false };

    if (organizationId) {
      const botMessage = await appendMessage(organizationId, session.conversationId, {
        senderType: "bot",
        body: replyText,
        direction: "outbound",
        modelMetadata: nlpResult
          ? {
              confidence: nlpResult.confidence,
              intent: nlpResult.intent,
              summary: nlpResult.summary,
              sentiment: nlpResult.sentiment,
              importantFacts: nlpResult.importantFacts,
              knowledgeUsed: nlpResult.knowledgeUsed,
              modelName: nlpResult.modelName,
              traceId: nlpResult.traceId,
            }
          : undefined,
      });
      if (!botMessage) {
        return { text: context.approvedServiceMessage, stub: false };
      }

      await recordNlpTurn(organizationId, session.conversationId, {
        customerText: userText,
        botReply: replyText,
        customerMessageId: customerMessage?.id,
        botMessageId: botMessage.id,
        confidence: nlpResult?.confidence,
        intent: nlpResult?.intent,
        candidateSkills: nlpResult?.candidateSkills,
        handoffRecommended: nlpResult?.handoffRecommended ?? false,
        handoffReason: nlpResult?.handoffReason,
        summary: nlpResult?.summary,
        sentiment: nlpResult?.sentiment,
        importantFacts: nlpResult?.importantFacts,
        knowledgeUsed: nlpResult?.knowledgeUsed,
        contactEntities: nlpResult?.contactEntities,
        modelName: nlpResult?.modelName,
        traceId: nlpResult?.traceId,
      });

      return { text: replyText, messageId: botMessage.id, stub: false };
    }

    return { text: replyText, stub: false };
  }
}
