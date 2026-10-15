import type { Logger } from "pino";

import type { MetaWhatsAppClient } from "../providers/meta-whatsapp.js";
import type { WhatsAppRuntimeCredentials } from "../types/accounts-contract.js";
import type { NormalizedWhatsAppInbound } from "../types/meta-whatsapp.js";
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
  runWhatsAppNlpTurn,
} from "./nlp-client.js";
import { resolveSocialHandoffReply } from "./social-handoff-reply.js";
import {
  loadSocialBotMemoryContext,
  persistSocialBotTurnMemory,
  queueProfilesFromIngest,
} from "./social-bot-memory.js";

export async function handleWhatsAppBotTurn(input: {
  normalized: NormalizedWhatsAppInbound;
  ingest: IngestSocialConversationResult;
  credentials: WhatsAppRuntimeCredentials;
  client: MetaWhatsAppClient;
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
    channel: "whatsapp",
    phoneNumberId: credentials.phoneNumberId,
    queue_profiles: queueProfilesFromIngest(ingest),
  });

  const nlpResult = await runWhatsAppNlpTurn({
    organizationId,
    conversationId,
    message: normalized.body,
    tenantContext: memoryContext.tenantContext,
    transcript: input.transcript ?? memoryContext.transcript,
  });

  if (!nlpResult) {
    logger.warn({ conversationId }, "whatsapp bot nlp turn failed");
    const text =
      "I'm sorry, I'm having trouble right now. Please try again in a moment.";
    const systemMessage = await appendSocialMessage(organizationId, conversationId, {
      senderType: "system",
      body: text,
    });
    try {
      await client.sendTextMessage(credentials, normalized.customerRef, text);
    } catch (error) {
      logger.warn({ err: error, conversationId }, "failed to send whatsapp nlp-failure reply");
    }
    if (systemMessage) {
      await recordSocialNlpTurn(organizationId, conversationId, {
        customerText: normalized.body,
        botReply: text,
        customerMessageId: ingest.messageId,
        botMessageId: systemMessage.id,
        handoffRecommended: false,
        handoffReason: "nlp_provider_failure",
        runtimeType: "whatsapp_bot",
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
      channel: "whatsapp",
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
        { err: error, conversationId },
        routed ? "failed to send whatsapp handoff message" : "failed to send whatsapp agents-busy message",
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
      runtimeType: "whatsapp_bot",
    });
    await persistSocialBotTurnMemory(organizationId, conversationId, {
      importantFacts: nlpResult.importantFacts,
    });

    if (routed) {
      logger.info(
        {
          conversationId,
          confidence: nlpResult.confidence,
          reason: nlpResult.handoffReason ?? "bot_handoff",
          queued: handoff?.queued ?? false,
          assignedUserId: handoff?.assignment?.userId ?? null,
        },
        "whatsapp conversation handed off to agent",
      );
    } else {
      logger.warn(
        {
          conversationId,
          queueId: ingest.conversation?.queueId ?? null,
          reason: nlpResult.handoffReason ?? "bot_handoff",
        },
        "whatsapp live agents unavailable; sent busy message",
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
    logger.error({ conversationId }, "failed to persist whatsapp bot message before send");
    return;
  }

  try {
    await client.sendTextMessage(credentials, normalized.customerRef, nlpResult.reply);
  } catch (error) {
    logger.error({ err: error, conversationId, messageId: botMessage.id }, "failed to send whatsapp bot reply");
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
    runtimeType: "whatsapp_bot",
  });
  await persistSocialBotTurnMemory(organizationId, conversationId, {
    importantFacts: nlpResult.importantFacts,
  });
}
