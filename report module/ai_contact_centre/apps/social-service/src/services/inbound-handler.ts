import { randomUUID } from "node:crypto";

import type { Logger } from "pino";

import type {
  AutoReplyButtonConfig,
  AutoReplyTemplateConfig,
} from "../config.js";
import type { MetaWhatsAppClient } from "../providers/meta-whatsapp.js";
import type { WhatsAppRuntimeCredentials } from "../types/accounts-contract.js";
import type {
  MetaInboundMessage,
  MetaWebhookPayload,
  NormalizedWhatsAppInbound,
} from "../types/meta-whatsapp.js";
import type { WhatsAppCredentialManager } from "./credential-manager.js";
import { ingestInboundSocialConversation } from "./cc-core-social-client.js";
import { handleWhatsAppBotTurn } from "./whatsapp-orchestrator.js";

/** Meta drops the indicator after 25s; refresh before that while the bot is still generating. */
const TYPING_REFRESH_MS = 20_000;

async function showBotTyping(input: {
  credentials: WhatsAppCredentialManager;
  client: MetaWhatsAppClient;
  logger: Logger;
  channelConfigId: string;
  messageId: string;
}): Promise<void> {
  try {
    await input.credentials.executeByChannel(
      input.channelConfigId,
      (credentials) => input.client.showTypingIndicator(credentials, input.messageId),
    );
  } catch (error) {
    input.logger.warn(
      { err: error, externalMessageId: input.messageId },
      "failed to send whatsapp typing indicator",
    );
  }
}

function extractMessageBody(message: MetaInboundMessage): string {
  switch (message.type) {
    case "text":
      return message.text?.body ?? "";
    case "button":
      return message.button?.text ?? message.button?.payload ?? "";
    case "interactive":
      return (
        message.interactive?.button_reply?.title ??
        message.interactive?.list_reply?.title ??
        ""
      );
    case "image":
      return message.image?.caption ?? "[image]";
    case "audio":
      return "[audio]";
    case "video":
      return message.video?.caption ?? "[video]";
    case "document":
      return message.document?.caption ?? message.document?.filename ?? "[document]";
    case "sticker":
      return "[sticker]";
    case "location":
      if (message.location?.name) return message.location.name;
      if (message.location?.address) return message.location.address;
      return `[location: ${message.location?.latitude}, ${message.location?.longitude}]`;
    default:
      return `[${message.type}]`;
  }
}

function normalizeInboundMessage(input: {
  message: MetaInboundMessage;
  customerName: string | null;
  credentials: WhatsAppRuntimeCredentials;
}): NormalizedWhatsAppInbound {
  const occurredAt = new Date(Number(input.message.timestamp) * 1000).toISOString();

  return {
    eventId: randomUUID(),
    tenantId: input.credentials.organizationId,
    channelConfigId: input.credentials.channelConfigId,
    channelType: "whatsapp",
    externalThreadId: input.message.from,
    externalMessageId: input.message.id,
    customerRef: input.message.from,
    customerName: input.customerName,
    body: extractMessageBody(input.message),
    messageType: input.message.type,
    phoneNumberId: input.credentials.phoneNumberId,
    occurredAt,
    metadata: {
      context: input.message.context ?? null,
      rawType: input.message.type,
    },
  };
}

export type InboundHandlerResult = {
  accepted: number;
  messages: NormalizedWhatsAppInbound[];
  statuses: number;
  unresolved: number;
  repliesSent: number;
  templateRepliesSent: number;
  buttonRepliesSent: number;
};

export async function handleMetaWhatsAppWebhook(
  payload: MetaWebhookPayload,
  input: {
    credentials: WhatsAppCredentialManager;
    client: MetaWhatsAppClient;
    logger: Logger;
    messagesLogger?: Logger;
    markRead?: boolean;
    autoReply?: boolean;
    autoReplyMessage?: string;
    autoReplyTemplate?: AutoReplyTemplateConfig | null;
    autoReplyButtons?: boolean;
    autoReplyButtonBody?: string;
    autoReplyButtonList?: [AutoReplyButtonConfig, AutoReplyButtonConfig];
  },
): Promise<InboundHandlerResult> {
  const messages: NormalizedWhatsAppInbound[] = [];
  let statusCount = 0;
  let unresolved = 0;
  let repliesSent = 0;
  let templateRepliesSent = 0;
  let buttonRepliesSent = 0;

  if (payload.object !== "whatsapp_business_account") {
    input.logger.warn({ object: payload.object }, "ignored non-whatsapp webhook payload");
    return {
      accepted: 0,
      messages,
      statuses: 0,
      unresolved: 0,
      repliesSent: 0,
      templateRepliesSent: 0,
      buttonRepliesSent: 0,
    };
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") {
        continue;
      }

      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id ?? null;
      if (!phoneNumberId) {
        unresolved += 1;
        input.logger.warn("ignored whatsapp webhook change without phone_number_id");
        continue;
      }

      let runtimeCredentials: WhatsAppRuntimeCredentials;
      try {
        runtimeCredentials = await input.credentials.getByPhoneNumberId(phoneNumberId);
      } catch (error) {
        unresolved += 1;
        input.logger.error(
          { err: error, phoneNumberId },
          "could not resolve whatsapp webhook connection",
        );
        continue;
      }

      const contactNameByWaId = new Map(
        (value.contacts ?? []).map((contact) => [contact.wa_id, contact.profile?.name ?? null]),
      );

      for (const message of value.messages ?? []) {
        const normalized = normalizeInboundMessage({
          message,
          customerName: contactNameByWaId.get(message.from) ?? null,
          credentials: runtimeCredentials,
        });

        messages.push(normalized);

        input.logger.info(
          {
            eventId: normalized.eventId,
            externalMessageId: normalized.externalMessageId,
            customerRef: normalized.customerRef,
            messageType: normalized.messageType,
            tenantId: normalized.tenantId,
            channelConfigId: normalized.channelConfigId,
          },
          "whatsapp inbound message received",
        );

        if (!input.autoReply) {
          const ingestResult = await ingestInboundSocialConversation({
            organizationId: normalized.tenantId,
            channelConfigId: normalized.channelConfigId,
            channelType: "whatsapp",
            externalThreadId: normalized.externalThreadId,
            externalMessageId: normalized.externalMessageId,
            customerRef: normalized.customerRef,
            customerName: normalized.customerName,
            body: normalized.body,
            messageType: normalized.messageType,
            phoneNumberId: normalized.phoneNumberId,
            occurredAt: normalized.occurredAt,
            metadata: normalized.metadata,
          });
          if (!ingestResult) {
            input.logger.error(
              {
                channelConfigId: normalized.channelConfigId,
                externalMessageId: normalized.externalMessageId,
              },
              "failed to forward whatsapp inbound message to cc-core",
            );
          } else {
            input.logger.info(
              {
                conversationId: ingestResult.conversationId,
                messageId: ingestResult.messageId,
                created: ingestResult.created,
                duplicate: ingestResult.duplicate,
                botEligible: ingestResult.botEligible,
              },
              "whatsapp inbound message forwarded to cc-core",
            );
            if (ingestResult.botEligible && !ingestResult.duplicate) {
              await showBotTyping({
                credentials: input.credentials,
                client: input.client,
                logger: input.logger,
                channelConfigId: runtimeCredentials.channelConfigId,
                messageId: message.id,
              });
              const typingTimer = setInterval(() => {
                void showBotTyping({
                  credentials: input.credentials,
                  client: input.client,
                  logger: input.logger,
                  channelConfigId: runtimeCredentials.channelConfigId,
                  messageId: message.id,
                });
              }, TYPING_REFRESH_MS);
              try {
                await handleWhatsAppBotTurn({
                  normalized,
                  ingest: ingestResult,
                  credentials: runtimeCredentials,
                  client: input.client,
                  logger: input.logger,
                  confidenceThreshold: ingestResult.policy?.confidenceThreshold,
                  handoffMessage: ingestResult.policy?.handoffMessage,
                  liveAgentEnabled: ingestResult.policy?.liveAgentEnabled,
                });
              } finally {
                clearInterval(typingTimer);
              }
            }
            // Non-bot paths: cc-core appendConversationMessage enriches contact from
            // inbound customer text when bot_active is false (agent / post-handoff).
          }
        }

        if (input.markRead) {
          try {
            await input.credentials.executeByChannel(
              runtimeCredentials.channelConfigId,
              (credentials) => input.client.markMessageAsRead(credentials, message.id),
            );
          } catch (error) {
            input.logger.warn(
              { err: error, externalMessageId: message.id },
              "failed to mark whatsapp message as read",
            );
          }
        }

        if (input.autoReply) {
          const replyBody =
            input.autoReplyMessage ??
            "Hello! This is a test auto-reply from Worktual social-service.";
          try {
            const result = await input.credentials.executeByChannel(
              runtimeCredentials.channelConfigId,
              (credentials) =>
                input.client.sendTextMessage(
                  credentials,
                  normalized.customerRef,
                  replyBody,
                ),
            );
            repliesSent += 1;
            input.messagesLogger?.info(
              {
                channelConfigId: normalized.channelConfigId,
                customerRef: normalized.customerRef,
                inboundMessageId: normalized.externalMessageId,
                providerMessageId: result.messages[0]?.id ?? null,
              },
              "whatsapp auto-reply sent",
            );
          } catch (error) {
            input.logger.error(
              {
                err: error,
                channelConfigId: normalized.channelConfigId,
                customerRef: normalized.customerRef,
              },
              "failed to send whatsapp auto-reply",
            );
          }

          if (input.autoReplyTemplate) {
            try {
              const result = await input.credentials.executeByChannel(
                runtimeCredentials.channelConfigId,
                (credentials) =>
                  input.client.sendTemplateMessage(credentials, {
                    to: normalized.customerRef,
                    templateName: input.autoReplyTemplate!.name,
                    languageCode: input.autoReplyTemplate!.languageCode,
                  }),
              );
              templateRepliesSent += 1;
              input.messagesLogger?.info(
                {
                  channelConfigId: normalized.channelConfigId,
                  customerRef: normalized.customerRef,
                  inboundMessageId: normalized.externalMessageId,
                  templateName: input.autoReplyTemplate.name,
                  providerMessageId: result.messages[0]?.id ?? null,
                },
                "whatsapp auto-reply template sent",
              );
            } catch (error) {
              input.logger.error(
                {
                  err: error,
                  channelConfigId: normalized.channelConfigId,
                  customerRef: normalized.customerRef,
                  templateName: input.autoReplyTemplate.name,
                },
                "failed to send whatsapp auto-reply template",
              );
            }
          }

          if (input.autoReplyButtons) {
            const buttonBody =
              input.autoReplyButtonBody ??
              "Please choose an option to test button replies:";
            const buttons =
              input.autoReplyButtonList ??
              ([
                { id: "btn_option_1", title: "Option 1" },
                { id: "btn_option_2", title: "Option 2" },
              ] as [AutoReplyButtonConfig, AutoReplyButtonConfig]);

            try {
              const result = await input.credentials.executeByChannel(
                runtimeCredentials.channelConfigId,
                (credentials) =>
                  input.client.sendInteractiveButtonMessage(
                    credentials,
                    normalized.customerRef,
                    { body: buttonBody, buttons },
                  ),
              );
              buttonRepliesSent += 1;
              input.messagesLogger?.info(
                {
                  channelConfigId: normalized.channelConfigId,
                  customerRef: normalized.customerRef,
                  inboundMessageId: normalized.externalMessageId,
                  buttonIds: buttons.map((button) => button.id),
                  providerMessageId: result.messages[0]?.id ?? null,
                },
                "whatsapp auto-reply buttons sent",
              );
            } catch (error) {
              input.logger.error(
                {
                  err: error,
                  channelConfigId: normalized.channelConfigId,
                  customerRef: normalized.customerRef,
                },
                "failed to send whatsapp auto-reply buttons",
              );
            }
          }
        }
      }

      for (const status of value.statuses ?? []) {
        statusCount += 1;
        input.logger.info(
          {
            externalMessageId: status.id,
            status: status.status,
            recipientId: status.recipient_id,
            errors: status.errors,
          },
          "whatsapp message status update",
        );
      }
    }
  }

  return {
    accepted: messages.length,
    messages,
    statuses: statusCount,
    unresolved,
    repliesSent,
    templateRepliesSent,
    buttonRepliesSent,
  };
}
