import type { Logger } from "pino";

import type { EmailProcessLog } from "@ai-contact-center/observability";

import type { GmailRuntimeCredentials } from "./credential-store.js";
import { EmailSender } from "./email-sender.js";
import type { GmailMessageMetadata } from "./gmail-client.js";
import {
  commitEmailBotDecision,
  type IngestEmailConversationResult,
  updateEmailDelivery,
} from "../services/cc-core-email-client.js";
import {
  getConversation,
  initiateHandoff,
  recordNlpTurn,
} from "../services/cc-core-client.js";
import { captureContactFromCustomerMessage } from "../services/contact-capture.js";
import {
  runEmailNlpTurn,
  type NlpEmailTurn,
} from "../services/nlp-client.js";

export function selectAllowedEmailQueue(
  candidate: string | null,
  profiles: IngestEmailConversationResult["automation"]["queueProfiles"],
  _defaultQueueId: string | null = null,
): string | null {
  if (candidate) {
    const needle = candidate.trim().toLowerCase();
    const match = profiles.find(
      (profile) =>
        profile.key === candidate ||
        profile.queueId === candidate ||
        profile.name.trim().toLowerCase() === needle,
    );
    if (match) return match.queueId;
  }
  return profiles[0]?.queueId ?? null;
}

export function requiresEmailHandoff(decision: NlpEmailTurn | null): boolean {
  return Boolean(decision?.handoffRecommended);
}

export class EmailOrchestrator {
  private readonly sender = new EmailSender();

  constructor(private readonly logger: Logger) {}

  async handleInbound(input: {
    credentials: GmailRuntimeCredentials;
    metadata: GmailMessageMetadata;
    ingest: IngestEmailConversationResult;
    processLog?: EmailProcessLog;
  }): Promise<void> {
    const { credentials, metadata, ingest, processLog } = input;
    const policy = ingest.automation.policy;
    if (!policy?.botEnabled) {
      if (!ingest.duplicate) {
        await captureContactFromCustomerMessage({
          organizationId: credentials.organizationId,
          conversationId: ingest.conversationId,
          message: metadata.body,
          sourceMessageId: ingest.messageId,
          channel: "email",
        });
      }
      processLog?.step("bot_skipped", { reason: "bot_disabled" });
      return;
    }
    if (policy.shadowMode && ingest.duplicate) {
      processLog?.step("bot_skipped", { reason: "shadow_duplicate" });
      return;
    }
    if (ingest.duplicate && ingest.conversation.status !== "bot_active") {
      processLog?.step("bot_skipped", {
        reason: "duplicate_already_processed",
        status: ingest.conversation.status,
      });
      return;
    }

    processLog?.step("bot_automation_started", {
      shadowMode: policy.shadowMode,
      autoSendEnabled: policy.autoSendEnabled,
    });

    const canonical = await getConversation(credentials.organizationId, ingest.conversationId);
    const transcript = (canonical?.messages ?? []).slice(-10).map((message) => ({
      role: message.senderType === "customer" ? "customer" : message.senderType,
      content: message.body.slice(0, 4_000),
    }));
    const attachmentPaths = [
      ...new Set(
        (canonical?.messages ?? []).flatMap((message) =>
          (message.attachments ?? [])
            .filter(
              (attachment) =>
                attachment.status === "available" &&
                attachment.storageKey.startsWith("Ticketing/attachments/"),
            )
            .map((attachment) => attachment.storageKey),
        ),
      ),
    ];
    const queueProfiles = ingest.automation.queueProfiles.map((profile) => ({
      key: profile.key,
      name: profile.name,
      description: profile.description,
      intents: profile.intents,
      skills: profile.skills,
    }));

    const nlpStartedAt = Date.now();
    processLog?.step("nlp_turn_started");
    const nlp = await runEmailNlpTurn({
      organizationId: credentials.organizationId,
      conversationId: ingest.conversationId,
      subject: metadata.subject,
      message: metadata.body,
      tenantContext: {
        ...ingest.automation.tenantContext,
        visitor_id: metadata.senderEmail,
        sender_email: metadata.senderEmail,
        sender_name: metadata.from,
        mailbox_email: credentials.accountEmail,
        attachment_paths: attachmentPaths,
      },
      transcript,
      queueProfiles,
      confidenceThreshold: policy.confidenceThreshold,
    });
    const nlpLatencyMs = Date.now() - nlpStartedAt;
    processLog?.step("nlp_turn_complete", {
      latencyMs: nlpLatencyMs,
      intent: nlp?.intent ?? null,
      confidence: nlp?.confidence ?? 0,
      urgency: nlp?.urgency ?? "normal",
      handoffRecommended: nlp?.handoffRecommended ?? true,
    });

    await captureContactFromCustomerMessage({
      organizationId: credentials.organizationId,
      conversationId: ingest.conversationId,
      message: metadata.body,
      sourceMessageId: ingest.messageId,
      channel: "email",
      nlpEntities: nlp?.contactEntities,
      importantFacts: nlp?.importantFacts,
    });

    if (policy.shadowMode) {
      await this.recordShadowDecision(input, nlp, nlpLatencyMs);
      processLog?.step("shadow_decision_recorded");
      return;
    }

    const decision = nlp ?? this.providerFailureDecision();
    const selectedQueueId = selectAllowedEmailQueue(
      decision.selectedQueueKey,
      ingest.automation.queueProfiles,
      policy.defaultQueueId,
    );
    const mustHandoff = requiresEmailHandoff(nlp);
    processLog?.step("reply_gate_evaluated", {
      mustHandoff,
      grounded: decision.grounded,
      guardPassed: decision.guardPassed,
      confidence: decision.confidence,
      threshold: policy.confidenceThreshold,
    });
    const delivery = mustHandoff
      ? null
      : {
          connectionId: credentials.connectionId,
          recipientEmail: metadata.replyTo ?? metadata.senderEmail,
          subject: metadata.subject || "(no subject)",
          providerThreadId: metadata.threadId,
          inReplyTo: metadata.messageHeaderId,
          references: metadata.references ?? metadata.messageHeaderId,
        };

    const committed = await commitEmailBotDecision(
      credentials.organizationId,
      ingest.conversationId,
      {
        customerMessageId: ingest.messageId,
        customerText: metadata.body,
        reply: decision.reply,
        confidence: decision.confidence,
        grounded: decision.grounded,
        intent: decision.intent,
        selectedQueueKey: selectedQueueId,
        candidateSkills: decision.candidateSkills,
        summary: decision.summary,
        sentiment: decision.sentiment,
        importantFacts: decision.importantFacts,
        knowledgeUsed: decision.knowledgeUsed,
        contactEntities: decision.contactEntities,
        handoffRecommended: mustHandoff,
        handoffReason:
          decision.handoffReason ?? (!nlp ? "nlp_provider_failure" : mustHandoff ? "reply_guard" : null),
        guardPassed: decision.guardPassed,
        guardReasons: decision.guardReasons,
        urgency: decision.urgency ?? "normal",
        traceId: decision.traceId,
        modelName: decision.modelName,
        latencyMs: nlpLatencyMs,
        queueProfileVersion:
          ingest.automation.queueProfiles.find((profile) => profile.queueId === selectedQueueId)
            ?.classifierVersion ?? null,
        delivery,
      },
    );

    if (!committed) {
      processLog?.fail("bot_decision_commit", "commit returned null");
      throw new Error("Failed to commit email automation decision");
    }
    processLog?.step("bot_decision_committed", {
      acceptedForDelivery: committed.acceptedForDelivery,
      deliveryId: committed.deliveryId,
      deliveryStatus: committed.deliveryStatus,
    });
    if (!committed.acceptedForDelivery || !committed.deliveryId || !decision.reply) {
      if (mustHandoff) {
        processLog?.step("live_agent_handoff", {
          reason: decision.handoffReason ?? "email_bot_handoff",
          queueId: selectedQueueId,
        });
        await this.handoff(input, selectedQueueId, decision, "email_bot_handoff");
      } else {
        processLog?.step("bot_reply_skipped", {
          reason: decision.handoffReason ?? "auto_send_gate",
          grounded: decision.grounded,
          guardPassed: decision.guardPassed,
          confidence: decision.confidence,
        });
      }
      return;
    }
    if (committed.deliveryStatus === "sent") {
      processLog?.step("bot_reply_already_sent");
      return;
    }

    const state = await getConversation(credentials.organizationId, ingest.conversationId);
    if (!state?.conversation.botActive) {
      processLog?.step("bot_send_cancelled", { reason: "conversation_left_bot_mode" });
      await updateEmailDelivery(credentials.organizationId, committed.deliveryId, {
        status: "failed",
        error: "Conversation left bot mode before provider send",
      });
      return;
    }

    try {
      processLog?.step("gmail_send_started", { deliveryId: committed.deliveryId });
      const sent = await this.sender.send({
        credentials,
        to: metadata.replyTo ?? metadata.senderEmail,
        subject: metadata.subject || "(no subject)",
        body: decision.reply,
        threadId: metadata.threadId,
        inReplyTo: metadata.messageHeaderId,
        references: metadata.references ?? metadata.messageHeaderId,
      });
      await updateEmailDelivery(credentials.organizationId, committed.deliveryId, {
        status: "sent",
        providerMessageId: sent.providerMessageId,
        providerRfcMessageId: sent.rfcMessageId,
      });
      processLog?.step("gmail_send_complete", {
        deliveryId: committed.deliveryId,
        providerMessageId: sent.providerMessageId,
      });
      this.logger.info(
        {
          organizationId: credentials.organizationId,
          conversationId: ingest.conversationId,
          deliveryId: committed.deliveryId,
          intent: decision.intent,
          confidence: decision.confidence,
        },
        "grounded email bot reply delivered",
      );
    } catch (error) {
      processLog?.fail("gmail_send", error, { deliveryId: committed.deliveryId });
      await updateEmailDelivery(credentials.organizationId, committed.deliveryId, {
        status: "failed",
        error: error instanceof Error ? error.message : "Gmail delivery failed",
      });
      await this.handoff(input, selectedQueueId, decision, "email_provider_failure");
    }
  }

  private async recordShadowDecision(
    input: {
      credentials: GmailRuntimeCredentials;
      metadata: GmailMessageMetadata;
      ingest: IngestEmailConversationResult;
    },
    decision: NlpEmailTurn | null,
    latencyMs: number,
  ): Promise<void> {
    await recordNlpTurn(input.credentials.organizationId, input.ingest.conversationId, {
      customerText: input.metadata.body,
      customerMessageId: input.ingest.messageId,
      confidence: decision?.confidence ?? 0,
      intent: decision?.intent,
      candidateSkills: decision?.candidateSkills ?? [],
      summary: decision?.summary,
      sentiment: decision?.sentiment,
      importantFacts: decision?.importantFacts ?? [],
      knowledgeUsed: decision?.knowledgeUsed ?? [],
      contactEntities: decision?.contactEntities,
      handoffRecommended: decision?.handoffRecommended ?? true,
      handoffReason: decision?.handoffReason ?? "shadow_provider_failure",
      modelName: decision?.modelName ?? "unavailable",
      traceId: decision?.traceId,
      runtimeType: "email_bot",
      selectedQueueKey: decision?.selectedQueueKey,
      grounded: decision?.grounded ?? false,
      guardPassed: decision?.guardPassed ?? false,
      guardReasons: decision?.guardReasons ?? ["provider_failure"],
      knowledgeReferences: decision?.knowledgeUsed ?? [],
      latencyMs,
    });
  }

  private async handoff(
    input: {
      credentials: GmailRuntimeCredentials;
      ingest: IngestEmailConversationResult;
    },
    queueId: string | null,
    decision: NlpEmailTurn,
    fallbackReason: string,
  ): Promise<void> {
    const policy = input.ingest.automation.policy;
    if (!policy?.liveAgentEnabled) return;
    const result = await initiateHandoff(
      input.credentials.organizationId,
      input.ingest.conversationId,
      {
        reason: decision.handoffReason ?? fallbackReason,
        selectedQueueKey: decision.selectedQueueKey ?? queueId ?? policy.defaultQueueId,
        candidateSkills: decision.candidateSkills,
        intent: decision.intent,
      },
    );
    if (!result) throw new Error("Email live-agent handoff failed");
  }

  private providerFailureDecision(): NlpEmailTurn {
    return {
      reply: "Thank you for your message. We're reviewing it and will get back to you shortly.",
      confidence: 0,
      grounded: false,
      intent: null,
      selectedQueueKey: null,
      candidateSkills: [],
      summary: null,
      sentiment: null,
      importantFacts: [],
      knowledgeUsed: [],
      handoffRecommended: false,
      handoffReason: "nlp_provider_failure",
      guardPassed: false,
      guardReasons: ["provider_failure"],
      urgency: "normal",
      traceId: null,
      modelName: "unavailable",
    };
  }
}
