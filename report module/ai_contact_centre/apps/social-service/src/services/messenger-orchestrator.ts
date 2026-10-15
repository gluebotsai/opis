import type { Logger } from "pino";

import type { MetaMessengerClient } from "../providers/meta-messenger.js";
import type { MessengerRuntimeCredentials } from "../types/accounts-contract.js";
import type { NormalizedMessengerInbound } from "../types/meta-messenger.js";
import {
  appendSocialMessage,
  enrichSocialConversationContact,
  initiateSocialHandoff,
  recordSocialNlpTurn,
  type IngestSocialConversationResult,
} from "./cc-core-social-client.js";
import {
  extractContactEntities,
  hasContactEntities,
  runSocialNlpTurn,
} from "./nlp-client.js";
import { resolveSocialHandoffReply } from "./social-handoff-reply.js";
import {
  loadSocialBotMemoryContext,
  persistSocialBotTurnMemory,
  queueProfilesFromIngest,
} from "./social-bot-memory.js";

export async function handleMessengerBotTurn(input: {
  normalized: NormalizedMessengerInbound;
  ingest: IngestSocialConversationResult;
  credentials: MessengerRuntimeCredentials;
  client: MetaMessengerClient;
  logger: Logger;
  confidenceThreshold?: number;
  handoffMessage?: string | null;
  liveAgentEnabled?: boolean;
  transcript?: Array<{ role: string; content: string }>;
}): Promise<void> {
  const { normalized, ingest, credentials, client, logger } = input;
  if (!ingest.botEligible) return;

  const organizationId = normalized.tenantId;
  const conversationId = ingest.conversationId;
  const liveAgentEnabled = input.liveAgentEnabled ?? true;

  const memoryContext = await loadSocialBotMemoryContext(organizationId, conversationId, {
    channel: normalized.channelType,
    pageId: credentials.pageId,
    igBusinessAccountId: credentials.igBusinessAccountId ?? null,
    queue_profiles: queueProfilesFromIngest(ingest),
  });

  const nlpResult = await runSocialNlpTurn({
    organizationId,
    conversationId,
    message: normalized.body,
    channel: normalized.channelType,
    tenantContext: memoryContext.tenantContext,
    transcript: input.transcript ?? memoryContext.transcript,
  });

  if (!nlpResult) {
    logger.warn({ conversationId, channel: normalized.channelType }, "messenger bot nlp turn failed");
    const text =
      "I'm sorry, I'm having trouble right now. Please try again in a moment.";
    const systemMessage = await appendSocialMessage(organizationId, conversationId, {
      senderType: "system",
      body: text,
    });
    try {
      await client.sendTextMessage(credentials, normalized.customerRef, text);
    } catch (error) {
      logger.warn(
        { err: error, conversationId, channel: normalized.channelType },
        "failed to send messenger nlp-failure reply",
      );
    }
    if (systemMessage) {
      await recordSocialNlpTurn(organizationId, conversationId, {
        customerText: normalized.body,
        botReply: text,
        customerMessageId: ingest.messageId,
        botMessageId: systemMessage.id,
        handoffRecommended: false,
        handoffReason: "nlp_provider_failure",
        runtimeType: `${normalized.channelType}_bot`,
      });
    }
    return;
  }

  await enrichSocialConversationContact(
    organizationId,
    conversationId,
    nlpResult.contactEntities ?? {},
    ingest.messageId,
    normalized.body,
    nlpResult.importantFacts,
  );

  const shouldHandoff = liveAgentEnabled && nlpResult.handoffRecommended === true;

  if (shouldHandoff && !hasContactEntities(nlpResult.contactEntities)) {
    const entities = await extractContactEntities({
      organizationId,
      conversationId,
      message: normalized.body,
      channel: normalized.channelType,
    });
    if (hasContactEntities(entities)) {
      await enrichSocialConversationContact(
        organizationId,
        conversationId,
        entities,
        ingest.messageId,
        normalized.body,
      );
    }
  }

  if (shouldHandoff) {
    const handoff = await initiateSocialHandoff(organizationId, conversationId, {
      reason: nlpResult.handoffReason ?? "bot_handoff",
      selectedQueueKey: nlpResult.selectedQueueKey,
      candidateSkills: nlpResult.candidateSkills,
      intent: nlpResult.intent,
      message: normalized.body,
    });
    const { text, routed } = resolveSocialHandoffReply({
      handoff,
      handoffMessage: input.handoffMessage,
    });

    // cc-core already persisted the busy message when routing failed; avoid a duplicate.
    const persistedByCore = !routed && handoff?.systemMessage?.body === text;
    const systemMessage = persistedByCore
      ? (handoff?.systemMessage?.id ? { id: handoff.systemMessage.id } : null)
      : await appendSocialMessage(organizationId, conversationId, {
          senderType: "system",
          body: text,
        });

    try {
      await client.sendTextMessage(credentials, normalized.customerRef, text);
    } catch (error) {
      logger.warn(
        { err: error, conversationId, channel: normalized.channelType },
        routed
          ? "failed to send messenger handoff message"
          : "failed to send messenger agents-busy message",
      );
    }

    await recordSocialNlpTurn(organizationId, conversationId, {
      customerText: normalized.body,
      botReply: text,
      customerMessageId: ingest.messageId,
      botMessageId: systemMessage?.id,
      confidence: nlpResult.confidence,
      intent: nlpResult.intent,
      handoffRecommended: true,
      handoffReason: nlpResult.handoffReason ?? "bot_handoff",
      importantFacts: nlpResult.importantFacts,
      contactEntities: nlpResult.contactEntities,
      modelName: nlpResult.modelName,
      traceId: nlpResult.traceId,
      runtimeType: `${normalized.channelType}_bot`,
    });
    await persistSocialBotTurnMemory(organizationId, conversationId, {
      importantFacts: nlpResult.importantFacts,
    });

    if (routed) {
      logger.info(
        {
          conversationId,
          channel: normalized.channelType,
          confidence: nlpResult.confidence,
          reason: nlpResult.handoffReason ?? "bot_handoff",
          queued: handoff?.queued ?? false,
          assignedUserId: handoff?.assignment?.userId ?? null,
        },
        "messenger conversation handed off to agent",
      );
    } else {
      logger.warn(
        {
          conversationId,
          channel: normalized.channelType,
          queueId: ingest.conversation?.queueId ?? null,
          reason: nlpResult.handoffReason ?? "bot_handoff",
        },
        "messenger live agents unavailable; sent busy message",
      );
    }
    return;
  }

  const botMessage = await appendSocialMessage(organizationId, conversationId, {
    senderType: "bot",
    body: nlpResult.reply,
    modelMetadata: {
      confidence: nlpResult.confidence,
      intent: nlpResult.intent,
      modelName: nlpResult.modelName,
      traceId: nlpResult.traceId,
    },
  });

  if (!botMessage) {
    logger.error(
      { conversationId, channel: normalized.channelType },
      "failed to persist messenger bot message before send",
    );
    return;
  }

  try {
    await client.sendTextMessage(credentials, normalized.customerRef, nlpResult.reply);
  } catch (error) {
    logger.error(
      { err: error, conversationId, messageId: botMessage.id, channel: normalized.channelType },
      "failed to send messenger bot reply",
    );
    return;
  }

  await recordSocialNlpTurn(organizationId, conversationId, {
    customerText: normalized.body,
    botReply: nlpResult.reply,
    customerMessageId: ingest.messageId,
    botMessageId: botMessage.id,
    confidence: nlpResult.confidence,
    intent: nlpResult.intent,
    candidateSkills: nlpResult.candidateSkills,
    handoffRecommended: nlpResult.handoffRecommended,
    handoffReason: nlpResult.handoffReason,
    summary: nlpResult.summary,
    sentiment: nlpResult.sentiment,
    importantFacts: nlpResult.importantFacts,
    knowledgeUsed: nlpResult.knowledgeUsed,
    contactEntities: nlpResult.contactEntities,
    modelName: nlpResult.modelName,
    traceId: nlpResult.traceId,
    runtimeType: `${normalized.channelType}_bot`,
  });
  await persistSocialBotTurnMemory(organizationId, conversationId, {
    importantFacts: nlpResult.importantFacts,
  });
  logger.info(
    {
      conversationId,
      channel: normalized.channelType,
      messageId: botMessage.id,
      confidence: nlpResult.confidence,
      intent: nlpResult.intent,
    },
    "messenger bot reply sent",
  );
}
