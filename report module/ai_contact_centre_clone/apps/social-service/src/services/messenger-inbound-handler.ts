import { randomUUID } from "node:crypto";

import type { Logger } from "pino";

import type { AutoReplyButtonConfig } from "../config.js";
import type { MetaMessengerClient } from "../providers/meta-messenger.js";
import type { MessengerRuntimeCredentials } from "../types/accounts-contract.js";
import type {
  MetaMessengerMessagingEvent,
  MetaMessengerWebhookPayload,
  NormalizedMessengerInbound,
} from "../types/meta-messenger.js";
import { ingestInboundSocialConversation } from "./cc-core-social-client.js";
import type { MessengerCredentialManager } from "./messenger-credential-manager.js";
import { handleMessengerBotTurn } from "./messenger-orchestrator.js";

function extractMessengerBody(event: MetaMessengerMessagingEvent): {
  body: string;
  messageType: string;
  externalMessageId: string;
} {
  if (event.message) {
    if (event.message.quick_reply?.payload) {
      return {
        body: event.message.quick_reply.payload,
        messageType: "quick_reply",
        externalMessageId: event.message.mid ?? randomUUID(),
      };
    }
    if (event.message.text) {
      return {
        body: event.message.text,
        messageType: "text",
        externalMessageId: event.message.mid ?? randomUUID(),
      };
    }
    if (event.message.attachments?.length) {
      const type = event.message.attachments[0]?.type ?? "attachment";
      return {
        body: `[${type}]`,
        messageType: type,
        externalMessageId: event.message.mid ?? randomUUID(),
      };
    }
  }
  if (event.message_edit?.text) {
    return {
      body: event.message_edit.text,
      messageType: "text",
      externalMessageId: event.message_edit.mid ?? randomUUID(),
    };
  }
  if (event.postback) {
    return {
      body: event.postback.title ?? event.postback.payload ?? "[postback]",
      messageType: "postback",
      externalMessageId: event.postback.mid ?? randomUUID(),
    };
  }
  return {
    body: "[unsupported]",
    messageType: "unknown",
    externalMessageId: randomUUID(),
  };
}

function normalizeMessengerEvent(input: {
  event: MetaMessengerMessagingEvent;
  credentials: MessengerRuntimeCredentials;
  channelType: "facebook" | "instagram";
}): NormalizedMessengerInbound | null {
  const senderId = input.event.sender?.id;
  if (!senderId) return null;
  if (input.event.message?.is_echo) return null;

  const extracted = extractMessengerBody(input.event);
  if (!extracted.body || extracted.body === "[unsupported]") return null;

  const occurredAt = input.event.timestamp
    ? new Date(input.event.timestamp).toISOString()
    : new Date().toISOString();

  return {
    eventId: randomUUID(),
    tenantId: input.credentials.organizationId,
    channelConfigId: input.credentials.channelConfigId,
    channelType: input.channelType,
    externalThreadId: senderId,
    externalMessageId: extracted.externalMessageId,
    customerRef: senderId,
    customerName: null,
    body: extracted.body,
    messageType: extracted.messageType,
    pageId: input.credentials.pageId,
    igBusinessAccountId: input.credentials.igBusinessAccountId ?? null,
    occurredAt,
    metadata: {
      recipientId: input.event.recipient?.id ?? null,
      raw: input.event,
    },
  };
}

async function enrichInstagramMessageEditEvent(input: {
  event: MetaMessengerMessagingEvent;
  credentials: MessengerRuntimeCredentials;
  client: MetaMessengerClient;
  logger: Logger;
}): Promise<MetaMessengerMessagingEvent> {
  const mid = input.event.message_edit?.mid;
  if (!mid) return input.event;
  if (input.event.message?.text && input.event.sender?.id) return input.event;
  if (input.event.message_edit?.text && input.event.sender?.id) return input.event;

  const lookedUp = await input.client.fetchInstagramMessageByMid(input.credentials, mid);
  if (!lookedUp?.message && !lookedUp?.from?.id) {
    input.logger.warn(
      {
        mid,
        channelConfigId: input.credentials.channelConfigId,
        numEdit: input.event.message_edit?.num_edit ?? null,
      },
      "instagram message_edit could not be enriched from Graph API",
    );
    return input.event;
  }

  input.logger.info(
    {
      mid,
      channelConfigId: input.credentials.channelConfigId,
      hasText: Boolean(lookedUp.message),
      hasSender: Boolean(lookedUp.from?.id),
    },
    "instagram message_edit enriched from Graph API",
  );

  return {
    ...input.event,
    sender: input.event.sender?.id
      ? input.event.sender
      : lookedUp.from?.id
        ? { id: lookedUp.from.id }
        : input.event.sender,
    message: {
      mid,
      text: lookedUp.message ?? input.event.message_edit?.text,
    },
  };
}

export type MessengerInboundHandlerResult = {
  accepted: number;
  messages: NormalizedMessengerInbound[];
  unresolved: number;
  repliesSent: number;
  buttonRepliesSent: number;
};

export async function handleMetaMessengerWebhook(
  payload: MetaMessengerWebhookPayload,
  input: {
    channelType: "facebook" | "instagram";
    credentials: MessengerCredentialManager;
    client: MetaMessengerClient;
    logger: Logger;
    messagesLogger?: Logger;
    autoReply?: boolean;
    autoReplyMessage?: string;
    autoReplyButtons?: boolean;
    autoReplyButtonBody?: string;
    autoReplyButtonList?: [AutoReplyButtonConfig, AutoReplyButtonConfig];
  },
): Promise<MessengerInboundHandlerResult> {
  const messages: NormalizedMessengerInbound[] = [];
  let unresolved = 0;
  let repliesSent = 0;
  let buttonRepliesSent = 0;

  if (payload.object !== "page" && payload.object !== "instagram") {
    input.logger.warn(
      { object: payload.object, channelType: input.channelType },
      "ignored non-page messenger webhook payload",
    );
    return { accepted: 0, messages, unresolved: 0, repliesSent: 0, buttonRepliesSent: 0 };
  }

  for (const entry of payload.entry ?? []) {
    const pageOrIgId = entry.id;
    if (!pageOrIgId) {
      unresolved += 1;
      continue;
    }

    // Meta console "Test" payloads often use entry.id = "0" (not a real Page/IG id).
    if (pageOrIgId === "0") {
      unresolved += 1;
      input.logger.warn(
        { entryId: pageOrIgId, channelType: input.channelType },
        "ignored meta webhook test placeholder entry id",
      );
      continue;
    }

    let runtimeCredentials: MessengerRuntimeCredentials;
    try {
      runtimeCredentials =
        input.channelType === "instagram"
          ? await input.credentials.resolveInstagramWebhookEntry(pageOrIgId, (credentials) =>
              input.client.fetchInstagramIdentity(credentials),
            )
          : await input.credentials.getByPageId(pageOrIgId, "facebook");
      if (runtimeCredentials.provider !== input.channelType) {
        input.logger.info(
          {
            channelType: input.channelType,
            provider: runtimeCredentials.provider,
            entryId: pageOrIgId,
          },
          "skipped messenger event for mismatched channel endpoint",
        );
        continue;
      }
    } catch (error) {
      unresolved += 1;
      input.logger.error(
        { err: error, entryId: pageOrIgId, channelType: input.channelType },
        "could not resolve messenger webhook connection",
      );
      continue;
    }

    const events = [...(entry.messaging ?? []), ...(entry.standby ?? [])];
    for (const rawEvent of events) {
      const event =
        input.channelType === "instagram" && rawEvent.message_edit
          ? await enrichInstagramMessageEditEvent({
              event: rawEvent,
              credentials: runtimeCredentials,
              client: input.client,
              logger: input.logger,
            })
          : rawEvent;

      const normalized = normalizeMessengerEvent({
        event,
        credentials: runtimeCredentials,
        channelType: input.channelType,
      });
      if (!normalized) {
        if (rawEvent.message_edit && !rawEvent.message) {
          input.logger.warn(
            {
              entryId: pageOrIgId,
              mid: rawEvent.message_edit.mid,
              numEdit: rawEvent.message_edit.num_edit ?? null,
              channelType: input.channelType,
            },
            "ignored instagram message_edit without recoverable message content",
          );
        }
        continue;
      }

      messages.push(normalized);
      input.logger.info(
        {
          eventId: normalized.eventId,
          externalMessageId: normalized.externalMessageId,
          customerRef: normalized.customerRef,
          messageType: normalized.messageType,
          channelType: normalized.channelType,
          tenantId: normalized.tenantId,
          channelConfigId: normalized.channelConfigId,
        },
        "messenger inbound message received",
      );

      if (input.autoReply) {
        const replyBody =
          input.autoReplyMessage ??
          "Hello! This is a test auto-reply from Worktual social-service.";
        try {
          await input.credentials.executeByChannel(
            runtimeCredentials.channelConfigId,
            input.channelType,
            (credentials) =>
              input.client.sendTextMessage(credentials, normalized.customerRef, replyBody),
          );
          repliesSent += 1;
          input.messagesLogger?.info(
            {
              channelConfigId: normalized.channelConfigId,
              customerRef: normalized.customerRef,
              channelType: normalized.channelType,
              inboundMessageId: normalized.externalMessageId,
            },
            "messenger auto-reply sent",
          );
        } catch (error) {
          input.logger.error(
            {
              err: error,
              channelConfigId: normalized.channelConfigId,
              customerRef: normalized.customerRef,
              channelType: normalized.channelType,
            },
            "failed to send messenger auto-reply",
          );
        }

        if (input.autoReplyButtons) {
          const buttonBody =
            input.autoReplyButtonBody ??
            "Please choose an option to test quick replies:";
          const buttons =
            input.autoReplyButtonList ??
            ([
              { id: "btn_option_1", title: "Option 1" },
              { id: "btn_option_2", title: "Option 2" },
            ] as [AutoReplyButtonConfig, AutoReplyButtonConfig]);
          try {
            await input.credentials.executeByChannel(
              runtimeCredentials.channelConfigId,
              input.channelType,
              (credentials) =>
                input.client.sendQuickReplyMessage(credentials, normalized.customerRef, {
                  body: buttonBody,
                  buttons: buttons.map((button) => ({
                    title: button.title,
                    payload: button.id,
                  })),
                }),
            );
            buttonRepliesSent += 1;
            input.messagesLogger?.info(
              {
                channelConfigId: normalized.channelConfigId,
                customerRef: normalized.customerRef,
                channelType: normalized.channelType,
                buttonIds: buttons.map((button) => button.id),
              },
              "messenger auto-reply buttons sent",
            );
          } catch (error) {
            input.logger.error(
              {
                err: error,
                channelConfigId: normalized.channelConfigId,
                customerRef: normalized.customerRef,
                channelType: normalized.channelType,
              },
              "failed to send messenger auto-reply buttons",
            );
          }
        }
        continue;
      }

      const ingest = await ingestInboundSocialConversation({
        organizationId: normalized.tenantId,
        channelConfigId: normalized.channelConfigId,
        channelType: normalized.channelType,
        externalThreadId: normalized.externalThreadId,
        externalMessageId: normalized.externalMessageId,
        customerRef: normalized.customerRef,
        customerName: normalized.customerName,
        body: normalized.body,
        messageType: normalized.messageType,
        pageId: normalized.pageId,
        igBusinessAccountId: normalized.igBusinessAccountId ?? undefined,
        occurredAt: normalized.occurredAt,
        metadata: normalized.metadata,
      });

      if (!ingest) {
        input.logger.error(
          {
            channelConfigId: normalized.channelConfigId,
            externalMessageId: normalized.externalMessageId,
            channelType: normalized.channelType,
          },
          "failed to ingest messenger conversation into cc-core",
        );
        continue;
      }

      input.logger.info(
        {
          channelConfigId: normalized.channelConfigId,
          externalMessageId: normalized.externalMessageId,
          channelType: normalized.channelType,
          conversationId: ingest.conversationId,
          messageId: ingest.messageId,
          created: ingest.created,
          duplicate: ingest.duplicate,
          botEligible: ingest.botEligible,
        },
        "messenger inbound message forwarded to cc-core",
      );

      if (!ingest.duplicate && ingest.botEligible) {
        await handleMessengerBotTurn({
          normalized,
          ingest,
          credentials: runtimeCredentials,
          client: input.client,
          logger: input.logger,
          confidenceThreshold: ingest.policy?.confidenceThreshold,
          handoffMessage: ingest.policy?.handoffMessage,
          liveAgentEnabled: ingest.policy?.liveAgentEnabled,
        });
      }
      // Non-bot: cc-core enriches on inbound customer append when bot_active is false.
    }
  }

  return {
    accepted: messages.length,
    messages,
    unresolved,
    repliesSent,
    buttonRepliesSent,
  };
}
